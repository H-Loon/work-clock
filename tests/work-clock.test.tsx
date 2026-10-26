import { expect, mock, test } from 'claude-code/testing'

const pad = (n: number) => String(n).padStart(2, '0')
const dayOf = (at: number) => {
  const d = new Date(at)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const TODAY = dayOf(Date.now())
const YESTERDAY = dayOf(Date.now() - 86_400_000)

const STORE = {
  labels: { 'aaaa1111-session': 'Refaire le tableau de bord', 'bbbb2222-session': 'Corriger la migration' },
  titles: { 'aaaa1111-session': 'Dashboard temps de travail' },
  [`turns:${TODAY}`]: { 'aaaa1111-session': { count: 3, longest: 20 * 60_000 } },
  [`day:${TODAY}`]: { 'aaaa1111-session': 41 * 60_000 },
  [`day:${YESTERDAY}`]: { 'bbbb2222-session': 95 * 60_000 },
}

const PANE = {
  plugin: 'work-clock',
  component: 'Pane',
  requestId: 'work-clock',
  props: {
    title: 'Heures de travail',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'work-clock',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const engine = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  mock.store(on, STORE)
  on('command.register', () => ({ value: { command: 'work-clock' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'aaaa1111-session' }))
}

test('the dashboard shows today, and a click on a day shows its chats', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /41m$/ }))?.text).toMatch(/41m/)
    expect(await ui.find({ type: 'Text', text: /Aucune activité/ })).toBeUndefined()

    await ui.press({ key: `day-${YESTERDAY}` })
    expect((await ui.find({ type: 'Text', text: /1h 35m/ }))?.text).toMatch(/1h 35m/)
    if (surface === 'terminal') {
      expect((await ui.find({ type: 'Text', text: /Corriger la migration/ }))?.text).toMatch(/Corriger/)
    }

    await ui.press({ key: 'prev' })
    if (surface === 'terminal') {
      expect((await ui.find({ type: 'Text', text: /Aucune activité/ }))?.text).toMatch(/Aucune/)
    } else {
      expect((await ui.find({ type: 'Text', text: /^0m$/ }))?.text).toBe('0m')
    }
    await ui.press({ key: 'next' })
    await ui.unmount()
  }
})

test('the band sums up today in this chat, under the name the app gives it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await terminal.find({ type: 'Text', text: /Dashboard temps de travail/ }))?.text).toBeDefined()
  expect((await terminal.find({ type: 'Text', text: /3 tours/ }))?.text).toMatch(/le plus long 20m/)
  expect((await terminal.find({ type: 'Text', text: /^41m$/ }))?.text).toBe('41m')
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await desktop.find({ type: 'Svg' }))?.props?.alt).toMatch(/^Dashboard temps de travail : 41m/)
  await desktop.press({ key: 'open' })
  await desktop.unmount()
})
