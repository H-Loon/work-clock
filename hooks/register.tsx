import type { Engine, Register } from 'claude-code'

// Totals are kept per local day: `day:YYYY-MM-DD` maps each session id to milliseconds.
// `labels` maps each session id to the first prompt of that chat, so the dashboard
// can say which chat the time belongs to. Both live in the mod's own store, which
// every session shares.
const PANE = 'work-clock'
const DAYS_SHOWN = 7

type Totals = Record<string, number>
type Labels = Record<string, string>

// The main loop's turns in flight: turnId -> when it started and which chat it runs in.
const running = new Map<string, { at: number; sessionId: string }>()

const pad = (n: number) => String(n).padStart(2, '0')

const dayOf = (at: number) => {
  const d = new Date(at)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const formatTime = (ms: number) => {
  const minutes = Math.round(ms / 60000)
  const hours = Math.floor(minutes / 60)

  return hours > 0 ? `${hours}h ${pad(minutes % 60)}m` : `${minutes % 60}m`
}

const sumOf = (totals: Totals) => Object.values(totals).reduce((a, b) => a + b, 0)

const readDay = async ($: Engine, day: string) =>
  ((await $.store.get(`day:${day}`)) ?? {}) as Totals

const readLabels = async ($: Engine) => ((await $.store.get('labels')) ?? {}) as Labels

const addTime = async ($: Engine, day: string, sessionId: string, ms: number) => {
  const totals = await readDay($, day)

  await $.store.set(`day:${day}`, { ...totals, [sessionId]: (totals[sessionId] ?? 0) + ms })
}

// Mini Claude: a 12 x 8 pixel sprite. Each pixel is one letter: O orange, K eye, . empty.
const SPRITE_COLS = 12
const SPRITE_ROWS = 4
const BODY = [
  '...OOOOOO...',
  '..OOOOOOOO..',
  '.OOKOOOOKOO.',
  '.OOOOOOOOOO.',
  '.OOOOOOOOOO.',
  '..OOOOOOOO..',
]
const LEG_A = ['..OO....OO..', '..OO....OO..']
const LEG_B = ['..OO....OO..', '.OO......OO.']
const ORANGE = 0x00d97757
const DARK = 0x001f1f1f
const DEFAULT_COLOR = 0x01000000

const colorOf = (pixel: string) => (pixel === 'O' ? ORANGE : pixel === 'K' ? DARK : null)

// Eight frames: the body bobs on two of every four, the legs step on odd frames, the eyes blink on frame 5.
const frameRows = (frame: number) => {
  const legs = frame % 2 === 1 ? LEG_B : LEG_A
  const blink = frame === 5
  const rows = [...BODY, ...legs].map(row => (blink ? row.replaceAll('K', 'O') : row))

  return frame % 4 >= 2 ? ['............', ...rows.slice(0, -1)] : rows
}

// One terminal cell holds two pixels: a half block whose foreground is the top and background the bottom.
const cellFor = (top: number | null, bottom: number | null): [number, number, number] => {
  if (top === null && bottom === null) return [0x20, DEFAULT_COLOR, DEFAULT_COLOR]
  if (top === null) return [0x2584, bottom!, DEFAULT_COLOR]
  if (bottom === null) return [0x2580, top, DEFAULT_COLOR]
  if (top === bottom) return [0x2588, top, top]

  return [0x2580, top, bottom]
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const toBase64 = (bytes: Uint8Array) => {
  let out = ''

  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)

    out +=
      BASE64[(n >> 18) & 63] +
      BASE64[(n >> 12) & 63] +
      (i + 1 < bytes.length ? BASE64[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? BASE64[n & 63] : '=')
  }

  return out
}

// The Raster's cells for one frame: a code point, a foreground and a background per cell.
const encodeFrame = (rows: string[]) => {
  const words = new Uint32Array(SPRITE_COLS * SPRITE_ROWS * 3)

  for (let y = 0; y < SPRITE_ROWS; y++) {
    for (let x = 0; x < SPRITE_COLS; x++) {
      const top = colorOf(rows[2 * y]![x]!)
      const bottom = colorOf(rows[2 * y + 1]![x]!)
      const [glyph, fg, bg] = cellFor(top, bottom)
      const at = (y * SPRITE_COLS + x) * 3

      words[at] = glyph
      words[at + 1] = fg
      words[at + 2] = bg
    }
  }

  return toBase64(new Uint8Array(words.buffer))
}

const FRAMES = Array.from({ length: 8 }, (_, frame) => encodeFrame(frameRows(frame)))

// The desktop draws the same sprite as SVG, animated by SMIL: the body bobs, the eyes blink.
const rects = (rows: string[], char: string, fill: string) =>
  rows
    .flatMap((row, y) =>
      [...row].flatMap((pixel, x) =>
        pixel === char ? [`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`] : [],
      ),
    )
    .join('')

const SPRITE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1 ${SPRITE_COLS} ${SPRITE_ROWS * 2 + 1}" shape-rendering="crispEdges">` +
  `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -1;0 0;0 -1;0 0" keyTimes="0;0.25;0.5;0.75;1" dur="1.6s" repeatCount="indefinite"/>` +
  rects([...BODY, ...LEG_A], 'O', '#d97757') +
  `<g><animate attributeName="opacity" values="1;1;1;0;1;1" keyTimes="0;0.6;0.7;0.75;0.8;1" dur="3.2s" repeatCount="indefinite"/>` +
  rects([...BODY, ...LEG_A], 'K', '#1f1f1f') +
  `</g></g></svg>`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'work-clock',
      description: 'Ouvrir le tableau de bord des heures de travail de Claude',
    })
    if (e.isInteractive) void $.ui.open({ id: PANE, title: 'Heures de travail' })

    // The terminal's mini Claude is repainted in place: one frame every 200 ms.
    let frame = 0

    $.clock.every(200, () => {
      frame = (frame + 1) % FRAMES.length
      void $.ui.blit({ requestId: PANE, key: 'mini-claude', cells: FRAMES[frame]! })
    })

    return next(e)
  })

  on('command.run', { command: 'work-clock' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Heures de travail' })
    const total = sumOf(await readDay($, dayOf(Date.now())))

    return { text: `Aujourd'hui : ${formatTime(total)} de travail de Claude.` }
  })

  on('turn.start', async ($, e, next) => {
    // Subagents run inside the main turn; only the main loop is counted, so no time is counted twice.
    if (e.agentId === undefined) {
      const sessionId = await $.session.id()

      running.set(e.turnId, { at: Date.now(), sessionId })

      const labels = await readLabels($)
      const text = e.text.replace(/\s+/g, ' ').trim()

      // Skip automated messages (task notifications, hook output): they are not the chat's own prompt.
      if (!labels[sessionId] && text !== '' && !text.startsWith('<')) {
        await $.store.set('labels', { ...labels, [sessionId]: text.slice(0, 40) })
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const turn = running.get(e.turnId)

    running.delete(e.turnId)
    if (turn !== undefined) {
      await addTime($, dayOf(turn.at), turn.sessionId, Date.now() - turn.at)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const labels = await readLabels($)
    const today = dayOf(Date.now())
    const working = running.size > 0
    const barMax = Math.max(4, Math.min(24, e.props.bodyColumns - 42))
    const bar = (ms: number, max: number) =>
      '█'.repeat(ms > 0 ? Math.max(1, Math.round((ms / max) * barMax)) : 0)

    const days = (await $.store.keys())
      .filter(key => key.startsWith('day:'))
      .map(key => key.slice('day:'.length))
      .sort()
      .reverse()
      .slice(0, DAYS_SHOWN)

    if (!days.includes(today)) days.unshift(today)

    const totals = await Promise.all(days.map(day => readDay($, day)))
    const todayTotals = totals[days.indexOf(today)] ?? {}
    const todayRows = Object.entries(todayTotals).sort(([, a], [, b]) => b - a)
    const todayMax = Math.max(1, ...Object.values(todayTotals))
    const dayMax = Math.max(1, ...totals.map(sumOf))

    // The terminal draws the sprite as cells; the desktop and the other surfaces draw it as SVG.
    const mascot =
      e.surface === 'terminal'
        ? (() => {
            const { Raster } = $.ui.resolve(e)

            return <Raster key="mini-claude" columns={SPRITE_COLS} rows={SPRITE_ROWS} cells={FRAMES[0]!} />
          })()
        : (() => {
            const { Svg } = $.ui.resolve(e)

            return <Svg source={SPRITE_SVG} alt="Claude" width={96} height={64} isInteractive />
          })()

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          {mascot}
          <Box flexDirection="column">
            <Text bold>Aujourd'hui · {formatTime(sumOf(todayTotals))}</Text>
            <Text dimColor>{working ? 'Claude travaille…' : 'Claude se repose.'}</Text>
          </Box>
        </Box>
        {todayRows.length === 0 && <Text dimColor>Aucune session aujourd'hui.</Text>}
        {todayRows.map(([sessionId, ms]) => (
          <Text>
            {(labels[sessionId] ?? 'Chat').slice(0, 20).padEnd(20)} {sessionId.slice(0, 4)} {bar(ms, todayMax)} {formatTime(ms)}
          </Text>
        ))}
        <Text bold>7 derniers jours</Text>
        {days.map((day, i) => (
          <Text dimColor={day !== today}>
            {day.slice(5).replace('-', '/')} {bar(sumOf(totals[i] ?? {}), dayMax)} {formatTime(sumOf(totals[i] ?? {}))}
          </Text>
        ))}
        <Text dimColor>Compté tour par tour, sous-agents exclus.</Text>
      </Box>
    )
  })
}
