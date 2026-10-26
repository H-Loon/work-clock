import type { Engine, Register } from 'claude-code'

import { BAND_BUTTON, BAND_HEIGHT, HERO_HEIGHT, WEEK_HEIGHT, bandSvg, chatsHeight, chatsSvg, heroSvg, weekSvg } from './art.ts'
import type { BandMode, ChartDay } from './art.ts'

// Totals are kept per local day: `day:YYYY-MM-DD` maps each session id to milliseconds,
// and `turns:YYYY-MM-DD` each session id to its turns that day (count, longest).
// `titles` maps each session id to the chat's name as the app shows it; `labels` to its
// first prompt, the fallback where no name is found. `settings` holds the person's choices.
// All live in the mod's own store, which every session shares.
const PANE = 'work-clock'
const TITLE = 'Heures de travail'
const DAY_MS = 86_400_000
// Roughly how many pixels one cell spans on the desktop, to size drawings to the pane.
const CELL_PX = 7.6

type Totals = Record<string, number>
type Labels = Record<string, string>
type Turns = Record<string, { count: number; longest: number }>
type Settings = { pill: boolean }

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

const shortTime = (ms: number) => {
  const minutes = Math.round(ms / 60000)

  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${pad(minutes % 60)}` : `${minutes}m`
}

const sumOf = (totals: Totals) => Object.values(totals).reduce((a, b) => a + b, 0)

const readDay = async ($: Engine, day: string) =>
  ((await $.store.get(`day:${day}`)) ?? {}) as Totals

const readLabels = async ($: Engine) => ((await $.store.get('labels')) ?? {}) as Labels

const readSettings = async ($: Engine) =>
  ({ pill: true, ...(((await $.store.get('settings')) ?? {}) as Partial<Settings>) }) as Settings

const readTitles = async ($: Engine) => ((await $.store.get('titles')) ?? {}) as Labels

const readTurns = async ($: Engine, day: string) => ((await $.store.get(`turns:${day}`)) ?? {}) as Turns

const addTime = async ($: Engine, day: string, sessionId: string, ms: number) => {
  const totals = await readDay($, day)
  const turns = await readTurns($, day)
  const mine = turns[sessionId] ?? { count: 0, longest: 0 }

  await $.store.set(`day:${day}`, { ...totals, [sessionId]: (totals[sessionId] ?? 0) + ms })
  await $.store.set(`turns:${day}`, { ...turns, [sessionId]: { count: mine.count + 1, longest: Math.max(mine.longest, ms) } })
}

const nameOf = (id: string, titles: Labels, labels: Labels) => titles[id] ?? labels[id] ?? 'Chat sans titre'

const fit = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

// The app keeps a chat's name in its transcript, `~/.claude/projects/<folder>/<id>.jsonl`, as
// `{"type":"custom-title",...}` rows, the last one current. Transcripts outgrow `$.fs.read`, so
// the system's own line filter picks the rows out (the pattern is quote-free for findstr's sake).
const claudeDir = ($: Engine) => {
  const root = $.plugin.root.replace(/\\/g, '/')
  const at = root.lastIndexOf('/.claude/')

  return at < 0 ? undefined : root.slice(0, at + 8)
}

const findTitle = async ($: Engine, sessionId: string) => {
  const dir = claudeDir($)

  if (dir === undefined) return undefined
  try {
    for (const folder of await $.fs.list(`${dir}/projects`)) {
      const file = `${dir}/projects/${folder.name}/${sessionId}.jsonl`

      if (folder.kind !== 'dir' || !(await $.fs.exists(file))) continue
      const argv = /^[a-z]:/i.test(dir)
        ? ['findstr', '/R', '/B', '/C:{.type.:.custom-title', file.replace(/\//g, '\\')]
        : ['grep', '-E', '^\\{.type.:.custom-title', file]
      const last = (await $.process.run(argv, { timeoutMs: 20_000 })).stdout.trim().split(/\r?\n/).at(-1)
      const title = last ? (JSON.parse(last) as { customTitle?: unknown }).customTitle : undefined

      return typeof title === 'string' && title.trim() !== '' ? title.trim() : undefined
    }
  } catch {
    // No transcript folder, no filter, or a row cut short: the first prompt stands in.
  }

  return undefined
}

// Looks the names up one chat at a time, in the background, and redraws when one changed.
const learnTitles = async ($: Engine, ids: string[]) => {
  for (const id of ids) {
    const title = await findTitle($, id)
    const titles = await readTitles($)

    if (title !== undefined && titles[id] !== title) {
      await $.store.set('titles', { ...titles, [id]: title })
      $.ui.invalidate('ui.render')
    }
  }
}

const WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
const WEEKDAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

const dateOf = (day: string) => new Date(`${day}T12:00:00`)

const longDate = (day: string) => {
  const d = dateOf(day)

  return `${WEEKDAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

// What the dashboard and the band draw from; the module's own, so a reload starts them afresh.
let selectedDay: string | undefined
let weekOffset = 0
let done: { text: string; timer: { cancel: () => void } } | undefined
let todayMs = 0
let showPill = true
let ticker: { cancel: () => void } | undefined

const liveMs = (sessionId?: string) => {
  const now = Date.now()

  return [...running.values()]
    .filter(turn => sessionId === undefined || turn.sessionId === sessionId)
    .reduce((ms, turn) => ms + (now - turn.at), 0)
}

// While a turn runs, the band and the pane redraw every 15 s so the times move.
const tick = ($: Engine) => {
  ticker?.cancel()
  ticker = $.clock.after(15_000, () => {
    ticker = undefined
    if (running.size === 0) return
    $.ui.invalidate('ui.render')
    tick($)
  })
}

const refresh = async ($: Engine) => {
  todayMs = sumOf(await readDay($, dayOf(Date.now())))
  showPill = (await readSettings($)).pill
}

const openPane = ($: Engine) => $.ui.open({ id: PANE, title: TITLE })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'work-clock',
      description: 'Tableau de bord des heures de Claude',
      argumentHint: '[cacher|afficher]',
    })
    await refresh($)

    const ids = new Set([await $.session.id()])

    for (const key of await $.store.keys()) {
      if (key.startsWith('day:')) for (const id of Object.keys(await readDay($, key.slice(4)))) ids.add(id)
    }
    void learnTitles($, [...ids])

    return next(e)
  })

  on('command.run', { command: 'work-clock' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'cacher' || arg === 'afficher') {
      await $.store.set('settings', { ...(await readSettings($)), pill: arg === 'afficher' })
      await refresh($)
      $.ui.invalidate('ui.render')

      return { text: arg === 'afficher' ? 'Le widget est affiché.' : 'Le widget est caché.' }
    }

    selectedDay = undefined
    weekOffset = 0
    await openPane($)
    await refresh($)

    return { text: `Aujourd'hui : ${formatTime(todayMs)} de travail de Claude.` }
  })

  on('turn.start', async ($, e, next) => {
    // Subagents run inside the main turn; only the main loop is counted, so no time is counted twice.
    if (e.agentId === undefined) {
      const sessionId = await $.session.id()

      running.set(e.turnId, { at: Date.now(), sessionId })
      done?.timer.cancel()
      done = undefined
      tick($)
      $.ui.invalidate('ui.render')

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
      const ms = Date.now() - turn.at

      await addTime($, dayOf(turn.at), turn.sessionId, ms)
      await refresh($)
      // The app names a chat after its first turn, and the person may rename it since.
      void learnTitles($, [turn.sessionId])
      // A long turn earns the mascot a little dance.
      if (ms > 30_000) {
        done?.timer.cancel()
        done = {
          text: `Fini · +${formatTime(ms)}`,
          timer: $.clock.after(6000, () => {
            done = undefined
            $.ui.invalidate('ui.render')
          }),
        }
      }
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  // The band above the prompt: today in this chat, across the band, unless hidden.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !showPill) return next(e)

    const now = Date.now()
    const today = dayOf(now)
    const sessionId = await $.session.id()
    const totals = await readDay($, today)
    const mine = (await readTurns($, today))[sessionId]
    const title = nameOf(sessionId, await readTitles($), await readLabels($))
    const chatMs = (totals[sessionId] ?? 0) + liveMs(sessionId)
    const dayMs = sumOf(totals) + liveMs()
    const turnAt = [...running.values()].find(turn => turn.sessionId === sessionId)?.at

    const working = running.size > 0 || e.props.isWorking
    const mode: BandMode = working ? 'working' : done !== undefined ? 'done' : 'idle'
    const detail =
      mode === 'working'
        ? `Claude travaille${turnAt === undefined ? '…' : ` · ${formatTime(now - turnAt)} sur ce tour`}`
        : mode === 'done'
          ? done!.text
          : mine !== undefined
            ? `${mine.count} tour${mine.count > 1 ? 's' : ''} aujourd'hui · le plus long ${formatTime(mine.longest)}`
            : chatMs > 0
              ? "Aujourd'hui dans ce chat"
              : "Pas encore de travail aujourd'hui dans ce chat"
    const open = () => openPane($)

    if (e.surface === 'terminal') {
      const { Box, Button, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text wrap="truncate-end">
            <Text color="claude">{mode === 'working' ? '● ' : '◆ '}</Text>
            <Text bold>{title}</Text>
            <Text dimColor>{` · ${detail}`}</Text>
          </Text>
          <Box flexDirection="row" gap={1} flexShrink={0}>
            <Text>
              <Text color="claude" bold>
                {formatTime(chatMs)}
              </Text>
              <Text dimColor>{` / ${formatTime(dayMs)}`}</Text>
            </Text>
            <Button key="open" plain dimColor label="Tableau" onPress={open} />
          </Box>
        </Box>
      )
    }

    const { Box, Button, Svg } = $.ui.resolve(e)
    const width = Math.max(240, Math.round(e.props.bodyColumns * CELL_PX))
    const band = { mode, title, detail, chat: formatTime(chatMs), day: formatTime(dayMs), share: dayMs > 0 ? chatMs / dayMs : 0 }

    // A press never leaves the SVG's frame, so the button lies over the room the drawing
    // keeps free at its right edge.
    return (
      <Box>
        <Svg
          source={bandSvg(width, band)}
          alt={`${title} : ${band.chat} aujourd'hui dans ce chat, ${band.day} en tout. ${detail}`}
          width={width}
          height={BAND_HEIGHT}
          isInteractive
        />
        <Box
          position="absolute"
          top={0}
          bottom={0}
          right={1}
          width={Math.round(BAND_BUTTON / CELL_PX) - 1}
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
        >
          <Button key="open" plain dimColor label="Tableau ↗" onPress={open} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const now = Date.now()
    const today = dayOf(now)
    const working = running.size > 0
    const labels = await readLabels($)
    const titles = await readTitles($)

    const days = (await $.store.keys()).filter(key => key.startsWith('day:')).map(key => key.slice(4))
    const byDay = new Map(await Promise.all(days.map(async day => [day, await readDay($, day)] as const)))
    const totalOf = (day: string) => sumOf(byDay.get(day) ?? {}) + (day === today ? liveMs() : 0)

    const lastOfWeek = now - weekOffset * 7 * DAY_MS
    const week = Array.from({ length: 7 }, (_, i) => dayOf(lastOfWeek - (6 - i) * DAY_MS))
    const selected = selectedDay !== undefined && week.includes(selectedDay) ? selectedDay : week[6]!
    const weekMs = week.reduce((ms, day) => ms + totalOf(day), 0)
    const record = days.reduce((best, day) => Math.max(best, totalOf(day)), totalOf(today))

    let streak = 0

    for (let i = totalOf(today) > 0 ? 0 : 1; totalOf(dayOf(now - i * DAY_MS)) > 0; i++) streak++

    const chats = Object.entries(byDay.get(selected) ?? {})
      .sort(([, a], [, b]) => b - a)
      .map(([id, ms]) => ({ label: nameOf(id, titles, labels), code: id.slice(0, 4), ms }))

    const chart: ChartDay[] = week.map(day => ({
      day,
      weekday: WEEKDAYS[dateOf(day).getDay()]!,
      date: String(dateOf(day).getDate()),
      ms: totalOf(day),
      isToday: day === today,
    }))

    const range = `${dateOf(week[0]!).getDate()} ${MONTHS[dateOf(week[0]!).getMonth()]} – ${longDate(week[6]!).split(' ').slice(1).join(' ')}`
    const select = (day: string) => () => {
      selectedDay = day
      $.ui.invalidate('ui.render')
    }
    const shift = (by: number) => () => {
      weekOffset = Math.max(0, weekOffset + by)
      selectedDay = undefined
      $.ui.invalidate('ui.render')
    }
    const status = working ? 'Claude travaille' : 'Au repos'
    const summary = `Semaine ${formatTime(weekMs)} · Série ${streak} jour${streak > 1 ? 's' : ''} · Record ${formatTime(record)}`

    if (e.surface === 'terminal') {
      const { Box, Button, Text } = $.ui.resolve(e)
      const max = Math.max(1, ...week.map(totalOf))
      const width = Math.max(6, Math.min(24, e.props.bodyColumns - 22))

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold color="claude">
              ◆ {formatTime(totalOf(today))} aujourd'hui
            </Text>
            <Text dimColor>{summary}</Text>
            <Text dimColor>{status}</Text>
          </Box>
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Button key="prev" plain label="‹" onPress={shift(1)} />
              <Text bold>{range}</Text>
              {weekOffset > 0 && <Button key="next" plain label="›" onPress={shift(-1)} />}
            </Box>
            {week.map(day => (
              <Button key={`day-${day}`} plain dimColor={day !== selected} onPress={select(day)}>
                {`${day === selected ? '▸' : ' '} ${WEEKDAYS[dateOf(day).getDay()]} ${pad(dateOf(day).getDate())} `}
                <Text color="claude">{'█'.repeat(Math.round((totalOf(day) / max) * width)).padEnd(width)}</Text>
                {` ${formatTime(totalOf(day))}`}
              </Button>
            ))}
          </Box>
          <Box flexDirection="column">
            <Text bold>
              {longDate(selected)} · {formatTime(totalOf(selected))}
            </Text>
            {chats.length === 0 && <Text dimColor>Aucune activité ce jour-là.</Text>}
            {chats.map(chat => (
              <Text>
                <Text color="claude">● </Text>
                {chat.label} <Text dimColor>{chat.code}</Text> · {formatTime(chat.ms)}
              </Text>
            ))}
          </Box>
        </Box>
      )
    }

    const { Box, Button, Svg, Text } = $.ui.resolve(e)
    // One column of one width, centred: the drawings are sized in pixels, the rows in cells.
    const width = Math.max(320, Math.min(760, Math.round(e.props.bodyColumns * CELL_PX)))
    const stats = [
      { label: 'Semaine', value: formatTime(weekMs) },
      { label: 'Série', value: `${streak} jour${streak > 1 ? 's' : ''}` },
      { label: 'Record', value: formatTime(record) },
      { label: 'Moyenne', value: formatTime(weekMs / 7) },
    ]

    return (
      <Box flexDirection="column" alignItems="center">
        <Box flexDirection="column" gap={1} width={Math.round(width / CELL_PX)}>
          <Svg
            source={heroSvg(width, formatTime(totalOf(today)), status, working, stats)}
            alt={`Aujourd'hui ${formatTime(totalOf(today))}. ${summary}`}
            width={width}
            height={HERO_HEIGHT}
            isInteractive
          />
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
            <Button key="prev" plain dimColor label="‹" onPress={shift(1)} />
            <Text bold>{range}</Text>
            {weekOffset > 0 ? <Button key="next" plain dimColor label="›" onPress={shift(-1)} /> : <Text dimColor>›</Text>}
          </Box>
          <Box flexDirection="column">
            <Svg source={weekSvg(width, chart, selected, shortTime)} alt={`Semaine du ${range}`} width={width} height={WEEK_HEIGHT} isInteractive />
            {/* The day buttons are the chart's axis: one seventh of the width each, under their bar. */}
            <Box flexDirection="row">
              {week.map(day => (
                <Box width={0} flexGrow={1} justifyContent="center">
                  <Button
                    key={`day-${day}`}
                    plain
                    dimColor={day !== selected}
                    label={`${WEEKDAYS[dateOf(day).getDay()]} ${dateOf(day).getDate()}`}
                    onPress={select(day)}
                  />
                </Box>
              ))}
            </Box>
          </Box>
          <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
            <Text bold>{longDate(selected)}</Text>
            <Text bold color="claude">
              {formatTime(totalOf(selected))}
            </Text>
          </Box>
          <Svg
            source={chatsSvg(width, chats.map(chat => ({ ...chat, label: fit(chat.label, Math.floor((width - 130) / 7.4)) })), formatTime)}
            alt={chats.length === 0 ? 'Aucune activité ce jour-là' : chats.map(c => `${c.label} ${formatTime(c.ms)}`).join(', ')}
            width={width}
            height={chatsHeight(chats.length)}
            isInteractive
          />
          <Text dimColor>Clique un jour pour voir ses chats · /work-clock cacher masque le widget</Text>
        </Box>
      </Box>
    )
  })
}
