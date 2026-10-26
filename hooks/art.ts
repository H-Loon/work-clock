// The mod's drawings, as SVG documents animated by SMIL: the band above the prompt and
// the dashboard's cards. Pure functions of their data, so the hooks module and the
// preview script draw the same thing.
//
// The desktop draws an interactive Svg in a sandboxed frame of the size it is given,
// and sets the app's font and text color on the root when the markup names none: so the
// text here names no font, and neutral ink is `currentColor`, which follows the theme.

export type ChartDay = { day: string; ms: number; isToday: boolean }

export type ChatRow = { label: string; code: string; ms: number }

export type Stat = { label: string; value: string }

const ACCENT = '#d97757'
const ACCENT_DEEP = '#c45f3a'
const EASE = '0.45 0 0.55 1'

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const svg = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`

// One SMIL track: values at keyTimes, eased between each pair.
const track = (attribute: string, times: readonly number[], values: readonly string[], seconds: number) => {
  const head = attribute.startsWith('transform:')
    ? `<animateTransform attributeName="transform" type="${attribute.slice(10)}"`
    : `<animate attributeName="${attribute}"`

  return (
    `${head} values="${values.join(';')}" keyTimes="${times.join(';')}" calcMode="spline" ` +
    `keySplines="${values.slice(1).map(() => EASE).join(';')}" dur="${seconds}s" repeatCount="indefinite"/>`
  )
}

const loop = (attribute: string, values: string[], seconds: number) =>
  track(attribute, values.map((_, i) => i / (values.length - 1)), values, seconds)

// Grows an attribute from `from` once, as the drawing appears.
const grow = (attribute: string, from: number, to: number) =>
  `<animate attributeName="${attribute}" from="${from}" to="${to}" dur=".6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.3 1"/>`

// ── The mascot ─────────────────────────────────────────────────────────────
// Drawn around (0, 0): body from y -10 to 8, feet to 11, arms out to x ±14.

type Choreography = {
  seconds: number
  orbit: [number, string][]
  hop?: [number, number][]
  wiggle?: [number, number][]
  wave?: [number, number][]
  look?: [number, string][]
  bob: number
}

const split = <T,>(steps: [number, T][]) => [steps.map(([t]) => t), steps.map(([, v]) => v)] as const

const mascot = (c: Choreography, opacity = '', scale = 1) => {
  const s = c.seconds
  const [orbitTimes, orbitValues] = split(c.orbit)
  const part = (steps: [number, number][] | undefined, kind: 'translate' | 'rotate', around: string) => {
    if (steps === undefined) return ''
    const [times, values] = split(steps)

    return track(`transform:${kind}`, times, values.map(v => (kind === 'rotate' ? `${v} ${around}` : `0 ${v}`)), s)
  }
  const look = c.look === undefined ? '' : track('transform:translate', ...split(c.look), s)
  const blink = track('ry', [0, 0.9, 0.94, 1], ['3.3', '3.3', '0.4', '3.3'], 4.3)

  return (
    // The orbit's animation replaces its group's transform, so the scale sits one group in.
    `<g transform="translate(${orbitValues[0]})">${track('transform:translate', orbitTimes, orbitValues, s)}${opacity}` +
    `<g transform="scale(${scale})">` +
    `<ellipse cx="0" cy="12" rx="8" ry="1.5" fill="#5a2312" opacity=".2"/>` +
    `<g>${part(c.hop, 'translate', '')}` +
    `<g>${part(c.wiggle, 'rotate', '0 10')}` +
    `<g>${loop('transform:translate', ['0 0', '0 -1.3', '0 0'], c.bob)}` +
    `<rect x="-6.5" y="5" width="4.2" height="6" rx="2.1" fill="#a8482a"/>` +
    `<rect x="2.3" y="5" width="4.2" height="6" rx="2.1" fill="#a8482a"/>` +
    `<rect x="-14" y="-2" width="5.5" height="3.4" rx="1.7" fill="${ACCENT_DEEP}"/>` +
    `<g>${part(c.wave, 'rotate', '9 0')}<rect x="8.5" y="-2" width="5.5" height="3.4" rx="1.7" fill="${ACCENT_DEEP}"/></g>` +
    `<rect x="-10" y="-10" width="20" height="18" rx="7" fill="url(#claude-body)" stroke="#fff4ec" stroke-width="1.3"/>` +
    `<ellipse cx="-4" cy="-2" rx="3" ry="3.3" fill="#fff">${blink}</ellipse>` +
    `<ellipse cx="4" cy="-2" rx="3" ry="3.3" fill="#fff">${blink}</ellipse>` +
    `<g>${look}<circle cx="-3.6" cy="-1.6" r="1.55" fill="#2a1810"/><circle cx="4.4" cy="-1.6" r="1.55" fill="#2a1810"/></g>` +
    `<ellipse cx="-6.6" cy="3" rx="1.8" ry="1" fill="#f7ab92" opacity=".85"/>` +
    `<ellipse cx="6.6" cy="3" rx="1.8" ry="1" fill="#f7ab92" opacity=".85"/>` +
    `</g></g></g></g></g>`
  )
}

const MASCOT_DEFS =
  `<linearGradient id="claude-body" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#e98f69"/><stop offset="1" stop-color="#c85f3a"/></linearGradient>`

// ── The orange surface: a gradient under slow waves and a gloss ───────────

type Layer = [at: number, amp: number, fill: string, opacity: number, seconds: number]

const wave = (x: number, y: number, amp: number, period: number, length: number, bottom: number) => {
  let d = `M${x},${y} q${period / 4},${-amp} ${period / 2},0`

  for (let at = period / 2; at < length; at += period / 2) d += ` t${period / 2},0`

  return `${d} V${bottom} H${x} Z`
}

const waves = (x: number, top: number, height: number, width: number, layers: Layer[], period = 56) =>
  layers
    .map(
      ([at, amp, fill, opacity, seconds]) =>
        `<path d="${wave(x - period, top + height * at, amp, period, width + period * 3, top + height + 4)}" fill="${fill}" opacity="${opacity}">` +
        `<animateTransform attributeName="transform" type="translate" values="0 0;${-period} 0" dur="${seconds}s" repeatCount="indefinite"/></path>`,
    )
    .join('')

const surfaceDefs = (id: string) =>
  `<linearGradient id="${id}-base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9532f"/>` +
  `<stop offset=".55" stop-color="${ACCENT}"/><stop offset="1" stop-color="#ea956d"/></linearGradient>` +
  `<linearGradient id="${id}-gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/>` +
  `<stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>`

const surface = (id: string, x: number, y: number, w: number, h: number, r: number, layers: Layer[], period?: number) =>
  `<clipPath id="${id}-clip"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>` +
  `<g clip-path="url(#${id}-clip)"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}-base)"/>` +
  `${waves(x, y, h, w, layers, period)}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}-gloss)"/></g>` +
  `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${r - 0.5}" fill="none" stroke="#fff" stroke-opacity=".22"/>`

// Slow deep swells at rest, a choppier sea while Claude works.
const calm = (scale: number): Layer[] => [
  [0.45, 2.2 * scale, '#c4623e', 0.55, 16],
  [0.62, 2 * scale, '#f0a27c', 0.45, 23],
  [0.8, 1.8 * scale, '#a9472a', 0.5, 31],
]
const choppy = (scale: number): Layer[] => [
  [0.38, 3.8 * scale, '#c4623e', 0.6, 3.4],
  [0.58, 3.4 * scale, '#f3ab85', 0.5, 4.6],
  [0.78, 3 * scale, '#a9472a', 0.55, 6.1],
]

// ── The band above the prompt: today in this chat ──────────────────────────
// One card across the band: the mascot on its orange tile, the chat's title, and
// on the right this chat's time today against the whole day's. The band's own
// Button sits over the space kept free at the right edge.

export type BandMode = 'idle' | 'working' | 'done'

export type Band = {
  mode: BandMode
  title: string
  detail: string
  chat: string
  day: string
  share: number
}

export const BAND_HEIGHT = 64
// The room kept at the right edge for the button the band lays over the drawing.
export const BAND_BUTTON = 112

const TILE = { x: 10, y: 9, size: 46 }
const SPOT = `${TILE.x + TILE.size / 2} ${TILE.y + 25}`

const BAND_DANCE: Record<BandMode, Choreography> = {
  // At rest it looks about, waves now and then, and breaks into a little dance.
  idle: {
    seconds: 16,
    orbit: [[0, SPOT], [1, SPOT]],
    hop: [[0, 0], [0.6, 0], [0.64, -5], [0.68, 0], [0.72, -5], [0.76, 0], [1, 0]],
    wiggle: [[0, 0], [0.6, 0], [0.62, -12], [0.65, 12], [0.68, -12], [0.71, 12], [0.74, -12], [0.77, 0], [1, 0]],
    wave: [[0, 0], [0.25, 0], [0.28, -70], [0.31, -25], [0.34, -70], [0.37, 0], [1, 0]],
    look: [[0, '0 0'], [0.08, '-1.3 0'], [0.16, '1.3 0'], [0.22, '0 0'], [0.42, '0 -1.3'], [0.5, '0 0'], [1, '0 0']],
    bob: 1.4,
  },
  // While Claude works it reads along, eyes going left to right.
  working: {
    seconds: 3,
    orbit: [[0, SPOT], [1, SPOT]],
    look: [[0, '-1.3 0.3'], [0.45, '1.3 0.3'], [0.55, '1.3 0.3'], [1, '-1.3 0.3']],
    bob: 0.7,
  },
  // A long turn just ended: it dances.
  done: {
    seconds: 6,
    orbit: [[0, SPOT], [1, SPOT]],
    hop: [[0, 0], [0.1, -6], [0.2, 0], [0.3, -6], [0.4, 0], [0.5, -6], [0.6, 0], [1, 0]],
    wiggle: [[0, 0], [0.1, -14], [0.2, 14], [0.3, -14], [0.4, 14], [0.5, -14], [0.6, 0], [1, 0]],
    wave: [[0, 0], [0.65, 0], [0.72, -70], [0.79, -25], [0.86, -70], [0.93, 0], [1, 0]],
    bob: 0.9,
  },
}

const fit = (text: string, room: number, charPx: number) => {
  const max = Math.max(4, Math.floor(room / charPx))

  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export const bandSvg = (width: number, band: Band) => {
  const h = BAND_HEIGHT
  const working = band.mode === 'working'
  // Stat blocks from the right, as many as the width allows.
  const blocks = width >= 560 ? 2 : width >= 400 ? 1 : 0
  const blockW = 92
  const statsX = width - BAND_BUTTON - blocks * blockW
  const textX = TILE.x + TILE.size + 14
  const stat = (x: number, label: string, value: string, color: string) =>
    `<text x="${x}" y="25" font-size="9.5" font-weight="700" letter-spacing="1" fill="currentColor" opacity=".55">${escape(label)}</text>` +
    `<text x="${x}" y="45" font-size="17" font-weight="700" fill="${color}">${escape(value)}</text>`
  const shareW = blocks * blockW - 16
  const stats =
    blocks === 0
      ? ''
      : `<line x1="${statsX - 14.5}" y1="14" x2="${statsX - 14.5}" y2="${h - 14}" stroke="currentColor" stroke-opacity=".12"/>` +
        stat(statsX, 'CE CHAT', band.chat, ACCENT_DEEP) +
        (blocks === 2 ? stat(statsX + blockW, "AUJOURD'HUI", band.day, 'currentColor') : '') +
        `<rect x="${statsX}" y="52" width="${shareW}" height="3.5" rx="1.75" fill="currentColor" fill-opacity=".1"/>` +
        `<rect x="${statsX}" y="52" width="${Math.max(3.5, shareW * Math.min(1, band.share))}" height="3.5" rx="1.75" fill="${ACCENT}">` +
        `${grow('width', 0, Math.max(3.5, shareW * Math.min(1, band.share)))}</rect>`
  const room = (blocks === 0 ? width - BAND_BUTTON : statsX - 14) - textX - 12
  const dot = working
    ? `<circle cx="${textX + 3}" cy="${42}" r="3" fill="${ACCENT}">${loop('opacity', ['1', '.3', '1'], 1.2)}</circle>`
    : ''

  return svg(
    width,
    h,
    `<defs>${MASCOT_DEFS}${surfaceDefs('tile')}` +
      `<clipPath id="band-clip"><rect x="0.5" y="0.5" width="${width - 1}" height="${h - 1}" rx="14"/></clipPath></defs>` +
      card(0.5, 0.5, width - 1, h - 1) +
      // A faint orange sea along the card's foot: slow at rest, choppy while Claude works.
      `<g clip-path="url(#band-clip)" opacity="${working ? 0.2 : 0.12}">${waves(0, 22, h - 22, width, working ? choppy(1.2) : calm(1.2), 90)}</g>` +
      surface('tile', TILE.x, TILE.y, TILE.size, TILE.size, 13, working ? choppy(1) : calm(1)) +
      mascot(BAND_DANCE[band.mode], '', 1.05) +
      `<text x="${textX}" y="28" font-size="13.5" font-weight="650" fill="currentColor">${escape(fit(band.title, room, 7.6))}</text>` +
      dot +
      `<text x="${textX + (working ? 11 : 0)}" y="46" font-size="11.5" fill="currentColor" opacity=".6">${escape(fit(band.detail, room - (working ? 11 : 0), 6.4))}</text>` +
      stats,
  )
}

// ── The dashboard ──────────────────────────────────────────────────────────
// Cards share one look: a faint wash of the theme's ink, rounded, on any background.

const card = (x: number, y: number, w: number, h: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="currentColor" fill-opacity=".045" stroke="currentColor" stroke-opacity=".09"/>`

export const HERO_HEIGHT = 176

export const heroSvg = (width: number, total: string, status: string, working: boolean, stats: Stat[]) => {
  const h = HERO_HEIGHT
  const hero: Choreography = {
    seconds: 12,
    orbit: [[0, `${width - 64} 72`], [1, `${width - 64} 72`]],
    hop: [[0, 0], [0.7, 0], [0.74, -8], [0.78, 0], [0.82, -8], [0.86, 0], [1, 0]],
    wiggle: [[0, 0], [0.7, 0], [0.73, -12], [0.76, 12], [0.79, -12], [0.82, 12], [0.85, 0], [1, 0]],
    wave: [[0, 0], [0.25, 0], [0.28, -70], [0.31, -25], [0.34, -70], [0.37, 0], [1, 0]],
    look: [[0, '0 0'], [0.45, '0 -1.3'], [0.5, '-1.3 -1.3'], [0.55, '1.3 -1.3'], [0.6, '0 0'], [1, '0 0']],
    bob: working ? 0.7 : 1.4,
  }
  // Stat chips along the bottom: as many as fit, each the same width.
  const shown = stats.slice(0, Math.max(2, Math.min(stats.length, Math.floor((width - 24) / 120))))
  const chipW = (width - 24 - (shown.length - 1) * 8) / shown.length
  const chips = shown
    .map((s, i) => {
      const x = 12 + i * (chipW + 8)

      return (
        `<rect x="${x}" y="${h - 52}" width="${chipW}" height="40" rx="10" fill="#fff" fill-opacity=".16"/>` +
        `<text x="${x + 12}" y="${h - 36}" font-size="10" font-weight="600" fill="#fff" opacity=".8">${escape(s.label.toUpperCase())}</text>` +
        `<text x="${x + 12}" y="${h - 19}" font-size="13.5" font-weight="700" fill="#fff">${escape(s.value)}</text>`
      )
    })
    .join('')

  return svg(
    width,
    h,
    `<defs>${MASCOT_DEFS}${surfaceDefs('hero')}</defs>` +
      surface('hero', 0, 0, width, h, 18, working ? choppy(1.8) : calm(1.8), 90) +
      `<text x="20" y="30" font-size="10.5" font-weight="700" letter-spacing="1.2" fill="#fff" opacity=".85">AUJOURD'HUI</text>` +
      `<text x="19" y="70" font-size="36" font-weight="700" fill="#fff">${escape(total)}</text>` +
      `<circle cx="${width - 120}" cy="26" r="3.5" fill="#fff">${working ? loop('opacity', ['1', '.3', '1'], 1.2) : ''}</circle>` +
      `<text x="${width - 110}" y="30" font-size="11.5" font-weight="600" fill="#fff">${escape(status)}</text>` +
      chips +
      mascot(hero, '', 2),
  )
}

export const WEEK_HEIGHT = 156

// The week's bars; the day buttons drawn under it are its axis, one per seventh of the width.
export const weekSvg = (width: number, days: ChartDay[], selected: string, time: (ms: number) => string) => {
  const h = WEEK_HEIGHT
  const base = h - 14
  const tall = h - 52
  const slot = width / days.length
  const max = Math.max(1, ...days.map(d => d.ms))
  const bars = days
    .map((d, i) => {
      const cx = slot * (i + 0.5)
      const bw = Math.min(34, slot * 0.46)
      const bh = d.ms > 0 ? Math.max(6, (d.ms / max) * tall) : 3
      const on = d.day === selected
      const fill = on ? 'url(#bar-on)' : d.ms === 0 ? 'currentColor' : d.isToday ? '#eaa486' : ACCENT
      const opacity = on ? 1 : d.ms === 0 ? 0.12 : d.isToday ? 0.9 : 0.42

      return (
        (on ? `<rect x="${cx - slot / 2 + 4}" y="8" width="${slot - 8}" height="${h - 16}" rx="12" fill="${ACCENT}" fill-opacity=".1"/>` : '') +
        `<rect x="${cx - bw / 2}" y="${base - bh}" width="${bw}" height="${bh}" rx="${Math.min(8, bw / 3)}" fill="${fill}" fill-opacity="${opacity}">` +
        `${grow('height', 0, bh)}${grow('y', base, base - bh)}</rect>` +
        (d.ms > 0
          ? `<text x="${cx}" y="${base - bh - 8}" text-anchor="middle" font-size="10.5" font-weight="${on ? 700 : 500}" fill="${on ? ACCENT_DEEP : 'currentColor'}" opacity="${on ? 1 : 0.6}">${escape(time(d.ms))}</text>`
          : '') +
        (d.isToday ? `<circle cx="${cx}" cy="${base + 8}" r="2.2" fill="${ACCENT}"/>` : '')
      )
    })
    .join('')

  return svg(
    width,
    h,
    `<defs><linearGradient id="bar-on" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e98f69"/><stop offset="1" stop-color="${ACCENT_DEEP}"/></linearGradient></defs>` +
      card(0.5, 0.5, width - 1, h - 1) +
      `<line x1="14" y1="${base + 0.5}" x2="${width - 14}" y2="${base + 0.5}" stroke="currentColor" stroke-opacity=".12"/>` +
      bars,
  )
}

export const chatsHeight = (rows: number) => Math.max(1, rows) * 46 + 16

export const chatsSvg = (width: number, rows: ChatRow[], time: (ms: number) => string) => {
  const h = chatsHeight(rows.length)
  const max = Math.max(1, ...rows.map(r => r.ms))
  const full = width - 36
  const body =
    rows.length === 0
      ? `<text x="${width / 2}" y="${h / 2 + 4}" text-anchor="middle" font-size="12.5" fill="currentColor" opacity=".55">Aucune activité ce jour-là</text>`
      : rows
          .map((r, i) => {
            const y = 14 + i * 46
            const bw = Math.max(5, (r.ms / max) * full)

            return (
              `<text x="18" y="${y + 14}" font-size="13" font-weight="600" fill="currentColor">${escape(r.label)}` +
              `<tspan dx="7" font-size="10.5" font-weight="400" opacity=".5">${escape(r.code)}</tspan></text>` +
              `<text x="${width - 18}" y="${y + 14}" text-anchor="end" font-size="12.5" font-weight="700" fill="${ACCENT_DEEP}">${escape(time(r.ms))}</text>` +
              `<rect x="18" y="${y + 23}" width="${full}" height="6" rx="3" fill="currentColor" fill-opacity=".08"/>` +
              `<rect x="18" y="${y + 23}" width="${bw}" height="6" rx="3" fill="url(#chat-bar)">${grow('width', 0, bw)}</rect>`
            )
          })
          .join('')

  return svg(
    width,
    h,
    `<defs><linearGradient id="chat-bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ACCENT_DEEP}"/><stop offset="1" stop-color="#ea956d"/></linearGradient></defs>` +
      card(0.5, 0.5, width - 1, h - 1) +
      body,
  )
}
