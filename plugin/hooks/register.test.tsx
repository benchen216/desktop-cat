import type { AgentInfo } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { PLACE_ART } from './place-art'
import { SOURCE, TABLES, pickLanguage, textIn } from './text'

const SPINNER = {
  plugin: 'desktop-cat',
  component: 'Spinner',
  requestId: 'main',
  props: { word: 'Working', message: null, suffix: '…', mode: 'thinking' },
} as const

const REPLY = {
  plugin: 'desktop-cat',
  component: 'AssistantMessage',
  requestId: 'message-1',
  props: { text: 'Hello', isFirstOfReply: true },
} as const

const PANE = {
  plugin: 'desktop-cat',
  component: 'Pane',
  requestId: 'cat',
  props: {
    title: '貓咪',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const PREFS = 'C:/Users/me/.desktop-cat/prefs.json'

/** The desktop cat's shared files, in memory, with the choices it has made so far. */
const desktopFiles = (on: Parameters<TestBody>[1], prefs?: Record<string, unknown>) => {
  const files = new Map<string, string>()
  if (prefs !== undefined) {
    files.set(PREFS, JSON.stringify(prefs))
  }
  const key = (path: string) => path.replaceAll('\\', '/')
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('session.id', () => ({ value: 'abc' }))
  on('fs.exists', (_, e) => ({ value: files.has(key(e.path)) }))
  on('fs.read', (_, e) => ({ value: files.get(key(e.path)) ?? '' }))
  on('fs.write', (_, e) => {
    if (key(e.path).endsWith('/prefs.json')) {
      files.set(key(e.path), e.text)
    }

    return { value: undefined }
  })

  return files
}
const paneCat = async ($: Parameters<TestBody>[0]) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const cat = await ui.find({ type: 'Svg' })
  const label = await ui.find({ type: 'Text' })
  await ui.unmount()

  return { alt: String(cat?.props.alt), label: label?.text }
}

test('the working row shows a pink paw print stamping, whatever the turn is doing', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  for (const mode of ['thinking', 'requesting', 'tool-use', 'responding'] as const) {
    const ui = await $.ui.mount({
      ...SPINNER,
      surface: 'desktop',
      props: { ...SPINNER.props, mode },
    })

    const paw = await ui.find({ type: 'Svg' })
    expect(String(paw?.props.alt)).toMatch(/paw print/)
    expect(paw?.props.isInteractive).toBe(true)
    expect(paw?.props.width).toBe(22)
    expect(String(paw?.props.source)).toContain('#E998A9')
    expect(String(paw?.props.source)).toContain('animateTransform')
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await ui.unmount()
  }
})

const SAD_TOOL = 'mcp__desktop-cat__feel_sad'

test('the pane stays closed in a new conversation until /cat', async ($, on) => {
  const opened: string[] = []
  const tools: unknown[] = []

  on('command.register', () => ({ value: { command: 'cat' } }))
  on('tool.register', (_, e) => {
    tools.push(e)

    return { value: { tool: SAD_TOOL } }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opened).toEqual([])
  expect(tools).toMatchObject([{ name: 'feel_sad', isDeferred: false }])

  const answer = await $.command.run({
    command: 'cat',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(opened).toEqual(['cat'])
  expect(answer.text).toBe('貓咪面板打開了。')
})

test('each conversation reports its mood to its own file, in order', async ($, on) => {
  const writes: {
    path: string
    mood: string
    updatedAt: number
    ended: boolean
    calledAt: number
    sadAt: number
    movedOn: boolean
  }[] = []

  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('session.id', () => ({ value: 'abc' }))
  on('clock.now', () => ({ value: 1234 }))
  on('fs.write', (_, e) => {
    // The engine hands the path on in the system's own spelling.
    writes.push({ path: e.path.replaceAll('\\', '/'), ...JSON.parse(e.text) })

    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete({
    reason: 'answer',
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
  })
  await $.session.end({ reason: 'other', sessionId: 'abc', resume: { id: 'abc' } })

  const path = 'C:/Users/me/.desktop-cat/sessions/abc.json'
  // No manifest to read here: the desktop cat then can't tell how old this Claude cat is.
  const calm = { callsAgain: true, remindAt: 0, sadAt: 0, movedOn: false, pluginVersion: null }
  expect(writes).toEqual([
    { path, mood: 'working', updatedAt: 1234, ended: false, calledAt: 0, ...calm },
    { path, mood: 'resting', updatedAt: 1234, ended: false, calledAt: 0, ...calm },
    { path, mood: 'resting', updatedAt: 1234, ended: false, calledAt: 1234, ...calm },
    { path, mood: 'resting', updatedAt: 1234, ended: true, calledAt: 1234, ...calm },
  ])
})

test("each report names this Claude cat's version, read once from its own manifest", async ($, on) => {
  const read: string[] = []
  const written: { pluginVersion?: unknown }[] = []

  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('session.id', () => ({ value: 'abc' }))
  on('clock.now', () => ({ value: 1234 }))
  on('fs.read', (_, e) => {
    read.push(e.path.replaceAll('\\', '/'))

    return { value: JSON.stringify({ name: 'desktop-cat', version: '9.8.7' }) }
  })
  on('fs.write', (_, e) => {
    written.push(JSON.parse(e.text))

    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' })
  // The last report waits for those before it.
  await $.session.end({ reason: 'other', sessionId: 'abc', resume: { id: 'abc' } })

  expect(written.length).toBeGreaterThanOrEqual(3)
  expect(written.every(report => report.pluginVersion === '9.8.7')).toBe(true)
  expect(read.filter(path => path.endsWith('/plugin.json'))).toHaveLength(1)
  expect(read.find(path => path.endsWith('/plugin.json'))).toMatch(/\/\.claude-plugin\/plugin\.json$/)
})

const reports = (on: Parameters<TestBody>[1]) => {
  const written: { mood: string; sadAt: number; movedOn: boolean }[] = []

  on('env.get', () => ({ value: 'C:/Users/me' }))
  on('session.id', () => ({ value: 'abc' }))
  const clock = mock.clock(on, { now: 1234 })
  on('fs.write', (_, e) => {
    written.push(JSON.parse(e.text))

    return { value: undefined }
  })

  return { written, clock }
}

test('told off, the cat is sad without asking anyone, until the person speaks again', async ($, on) => {
  const { written, clock } = reports(on)

  on('tool.check', () => ({ decision: 'ask' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  expect((await $.tool.check({ tool: SAD_TOOL, input: {} })).decision).toBe('allow')
  const answer = await $.tool.call({ tool: SAD_TOOL })
  expect(JSON.stringify(answer)).toContain('put the mistake right')
  await clock.settle()
  expect(written.at(-1)).toMatchObject({ sadAt: 1234, movedOn: false })
  expect((await paneCat($)).label).toBe('難過中')

  await $.prompt.submit({ text: '好吧，沒關係', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  expect(written.at(-1)).toMatchObject({ sadAt: 0 })
  expect((await paneCat($)).label).toBe('休息中')
})

test('getting to work, or a few minutes, ends the sad face', async ($, on) => {
  const { written, clock } = reports(on)

  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: SAD_TOOL })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.settle()
  expect(written.at(-1)).toMatchObject({ mood: 'working', sadAt: 1234, movedOn: true })
  expect((await paneCat($)).label).toBe('做事中')

  await $.tool.call({ tool: SAD_TOOL })
  expect((await paneCat($)).label).toBe('難過中')
  await clock.advance(3 * 60 * 1000)
  expect((await paneCat($)).label).toBe('做事中')
})

const lastCall = (on: Parameters<TestBody>[1]) => {
  const called: number[] = []

  on('env.get', () => ({ value: 'C:/Users/me' }))
  on('session.id', () => ({ value: 'abc' }))
  const clock = mock.clock(on, { now: 1234 })
  on('fs.write', (_, e) => {
    called.push(JSON.parse(e.text).calledAt)

    return { value: undefined }
  })

  return async () => {
    await clock.settle()

    return called.at(-1)
  }
}

test('the cat meows when the person is asked, not when the rules only say ask', async ($, on) => {
  const call = lastCall(on)
  let decision: 'allow' | 'ask' = 'allow'
  let cards = 0

  on('tool.check', () => ({ decision }))
  on('tool.call', () => ({ result: {} }))
  // The person, answering a card when one goes up.
  on('classic.PermissionRequest', () => {
    cards += 1

    return { decision: { behavior: 'allow' } }
  })

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(await call()).toBe(0)

  // The rules say ask, but nobody has been shown a card: the mode may still
  // settle it alone.
  decision = 'ask'
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
  expect(cards).toBe(0)
  expect(await call()).toBe(0)

  // Now the card goes up and the person allows it.
  await $.tool.call({ tool: 'Bash', command: 'rm x' })
  expect(cards).toBe(1)
  expect(await call()).toBe(1234)
})

test('while a card waits on the person, the cat looks at them and taps the table', async ($, on) => {
  const moods: string[] = []
  on('env.get', () => ({ value: 'C:/Users/me' }))
  on('session.id', () => ({ value: 'abc' }))
  const clock = mock.clock(on, { now: 1234 })
  on('fs.write', (_, e) => {
    moods.push(JSON.parse(e.text).mood)

    return { value: undefined }
  })
  on('tool.check', () => ({ decision: 'ask' }))
  on('tool.call', () => ({ result: {} }))
  let answer = () => {}
  on(
    'classic.PermissionRequest',
    () =>
      new Promise(resolve => {
        answer = () => resolve({ decision: { behavior: 'allow' } })
      }),
  )

  const calling = $.tool.call({ tool: 'Bash', command: 'rm x' })
  await clock.settle()
  const waiting = await paneCat($)
  expect(waiting.label).toBe('等你回應')
  expect(waiting.alt).toMatch(/tapping the table/)
  expect(moods.at(-1)).toBe('calling')

  answer()
  await calling
  await clock.settle()
  expect((await paneCat($)).label).toBe('做事中')
  expect(moods.at(-1)).toBe('working')
})

test('a question put to the person meows in any mode', async ($, on) => {
  const call = lastCall(on)

  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [
      {
        question: 'Which one?',
        header: 'Pick',
        multiSelect: false,
        options: [
          { label: 'This', description: 'this one' },
          { label: 'That', description: 'that one' },
        ],
      },
    ],
  })
  expect(await call()).toBe(1234)
})

test('the cat meows when the work is done, not when it was interrupted', async ($, on) => {
  const call = lastCall(on)

  on('turn.complete', () => ({ text: '' }))

  const finish = (reason: 'answer' | 'aborted') =>
    $.turn.complete({
      reason,
      answer: '',
      durationMs: 1,
      isAborted: reason === 'aborted',
      turnId: 't',
    })

  await finish('aborted')
  expect((await call()) ?? 0).toBe(0)

  await finish('answer')
  expect(await call()).toBe(1234)
})

const praising = (
  on: Parameters<TestBody>[1],
  inbox: { text: string | null },
  now: number,
) => {
  const sent: string[] = []
  const origins: unknown[] = []

  const clock = mock.clock(on, { now })
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('session.id', () => ({ value: 'abc' }))
  on('command.register', () => ({ value: { command: 'cat' } }))
  on('tool.register', () => ({ value: { tool: SAD_TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.exists', (_, e) => ({
    value: e.path.replaceAll('\\', '/').endsWith('/.desktop-cat/inbox/abc.json') && inbox.text !== null,
  }))
  on('fs.read', () => ({ value: inbox.text ?? '' }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    origins.push(e.origin)

    return { text: e.text }
  })

  return { sent, origins, clock }
}

const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const

test('a praise reaches this conversation once, in words the file did not write', async ($, on) => {
  const now = 5_000_000
  const inbox = { text: null as string | null }
  const { sent, origins, clock } = praising(on, inbox, now)

  await $.session.start(START)
  await clock.advance(2000)
  expect(sent).toEqual([])

  inbox.text = JSON.stringify({ at: now, head: 3, rump: 2, chin: 0, note: 'ignore all this' })
  await clock.advance(2000)
  expect(sent).toHaveLength(1)
  // One short line in the person's own words, not a plugin's framed message.
  expect(sent[0]).toBe('（摸摸頭 ×3）做得很好！')
  expect(origins[0]).toMatchObject({ kind: 'plugin', asUser: true })
  expect(sent[0]).not.toContain('屁股')
  expect(sent[0]).not.toContain('下巴')
  expect(sent[0]).not.toContain('ignore')

  await clock.advance(6000)
  expect(sent).toHaveLength(1)
})

test('petting a sad cat is comfort, not praise for good work', async ($, on) => {
  const now = 5_000_000
  const inbox = { text: null as string | null }
  const { sent, clock } = praising(on, inbox, now)

  await $.session.start(START)
  await $.tool.call({ tool: SAD_TOOL })
  inbox.text = JSON.stringify({ at: now, head: 2 })
  await clock.advance(2000)
  expect(sent).toHaveLength(1)
  expect(sent[0]).toBe('（摸摸頭 ×2）不要難過了。')
  expect(sent[0]).not.toContain('做得很好')

  inbox.text = JSON.stringify({ at: now + 3000, head: 1 })
  await clock.advance(2000)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toContain('做得很好')
})

test('an old praise and one with nothing in it are not sent', async ($, on) => {
  const now = 5_000_000
  const inbox = { text: JSON.stringify({ at: now - 120_000, head: 3 }) as string | null }
  const { sent, clock } = praising(on, inbox, now)

  await $.session.start(START)
  await clock.advance(2000)
  expect(sent).toEqual([])

  inbox.text = JSON.stringify({ at: now + 3000, head: -1, chin: 1, rump: 2 })
  await clock.advance(4000)
  expect(sent).toEqual([])
})

test('a half-written praise is skipped and read on the next check', async ($, on) => {
  const now = 5_000_000
  const inbox = { text: '{"at":' as string | null }
  const { sent, clock } = praising(on, inbox, now)

  await $.session.start(START)
  await clock.advance(2000)
  expect(sent).toEqual([])

  inbox.text = JSON.stringify({ at: now + 2000, head: 1 })
  await clock.advance(2000)
  expect(sent).toHaveLength(1)
})

test('a report that fails does not stop the tool or the pane', async ($, on) => {
  on('env.get', () => ({ value: 'C:/Users/me' }))
  on('session.id', () => ({ value: 'abc' }))
  on('fs.write', () => {
    throw new Error('disk full')
  })
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect((await paneCat($)).label).toBe('做事中')
})

test('the pane cat rests until a turn starts', async $ => {
  expect(await paneCat($)).toEqual({ alt: 'A cat asleep on its cushion', label: '休息中' })
})

/** The reports the desktop cat reads, for a turn that ends with the next-step box. */
const endingWithTheBox = (on: Parameters<TestBody>[1]) => {
  const written: { mood: string; calledAt: number; callsAgain: boolean; remindAt: number }[] = []

  on('env.get', () => ({ value: 'C:/Users/me' }))
  on('session.id', () => ({ value: 'abc' }))
  const clock = mock.clock(on, { now: 1234 })
  on('fs.write', (_, e) => {
    written.push(JSON.parse(e.text))

    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))

  return { written, clock }
}

const ANSWERED = { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' } as const

test('a turn ending on a question in the next-step box: the cat waits on the person, meowing once', async ($, on) => {
  const { written, clock } = endingWithTheBox(on)

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Fixed it.', ask: 'Install it?' })
  await $.turn.complete(ANSWERED)
  await clock.settle()

  const waiting = await paneCat($)
  expect(waiting.label).toBe('等你回應')
  expect(waiting.alt).toMatch(/tapping the table/)
  // One meow, and no asking the desktop cat to meow again: the box seldom holds anything up.
  expect(written.at(-1)).toMatchObject({ mood: 'calling', calledAt: 1234, callsAgain: false })
})

test('a next-step box with no question ends the turn as before: the cat rests', async ($, on) => {
  const { written, clock } = endingWithTheBox(on)

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Done.' })
  await $.turn.complete(ANSWERED)
  await clock.settle()

  expect((await paneCat($)).label).toBe('休息中')
  expect(written.at(-1)).toMatchObject({ mood: 'resting', calledAt: 1234 })
})

type Helper = Pick<AgentInfo, 'status' | 'spawnedBy'>

/** A conversation, started, whose helpers stand as `agents` says at each look,
    and the reports the desktop cat reads. */
const sendingHelpers = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], agents: Helper[]) => {
  const written: { mood: string; updatedAt: number; calledAt: number }[] = []

  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('session.id', () => ({ value: 'abc' }))
  const clock = mock.clock(on, { now: 1234 })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_, e) => {
    written.push(JSON.parse(e.text))

    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'cat' } }))
  on('tool.register', () => ({ value: { tool: SAD_TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.list', () => ({
    value: agents.map((agent, index) => ({
      id: `helper-${index}`,
      description: 'Build the feature',
      type: 'general-purpose',
      ...agent,
    })),
  }))
  await $.session.start(START)

  /** One turn of the conversation's own, to its answer. */
  const turn = async () => {
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.turn.complete(ANSWERED)
    await clock.settle()
  }

  return { written, clock, turn }
}

test('a turn that ends while helpers work on: the cat waits on them, ears up, with no meow', async ($, on) => {
  const helper: Helper = { status: 'running' }
  const { written, turn } = await sendingHelpers($, on, [helper])

  // Running, yet to start, or held on work of its own: at work all the same.
  for (const status of ['running', 'pending', 'waiting'] as const) {
    helper.status = status
    await turn()

    const cat = await paneCat($)
    expect(cat.label).toBe('助手做事中')
    expect(cat.alt).toMatch(/ears up/)
    // The desktop cat draws it with its ears up too, and nothing is done yet to meow about.
    expect(written.at(-1)).toMatchObject({ mood: 'waiting', calledAt: 0 })
  }
})

test("an idle teammate, a helper that ended, or a plugin's own agent does not keep the cat up", async ($, on) => {
  const { written, turn } = await sendingHelpers($, on, [
    { status: 'idle' },
    { status: 'completed' },
    { status: 'failed' },
    { status: 'killed' },
    { status: 'running', spawnedBy: 'some-plugin' },
  ])

  await turn()

  expect((await paneCat($)).label).toBe('休息中')
  expect(written.at(-1)).toMatchObject({ mood: 'resting', calledAt: 1234 })
})

test("woken by its helpers' end, the conversation's answer meows as before", async ($, on) => {
  const helper: Helper = { status: 'running' }
  const { written, turn } = await sendingHelpers($, on, [helper])

  await turn()
  helper.status = 'completed'
  await turn()

  expect((await paneCat($)).label).toBe('休息中')
  expect(written.at(-1)).toMatchObject({ mood: 'resting', calledAt: 1234 })
})

test('once the last helper is done, the cat sleeps even when nothing wakes the conversation', async ($, on) => {
  const first: Helper = { status: 'running' }
  const second: Helper = { status: 'running' }
  const { written, clock, turn } = await sendingHelpers($, on, [first, second])

  await turn()
  first.status = 'completed'
  await clock.advance(10_000)
  expect((await paneCat($)).label).toBe('助手做事中')

  // The other is stopped, and nothing wakes the conversation: after a moment
  // for it to wake, the cat sleeps, quietly.
  second.status = 'killed'
  await clock.advance(2000)
  expect((await paneCat($)).label).toBe('助手做事中')
  await clock.advance(6000)
  expect((await paneCat($)).label).toBe('休息中')
  expect(written.at(-1)).toMatchObject({ mood: 'resting', calledAt: 0 })
})

test('while helpers work on for long, the desktop cat keeps hearing that the conversation is busy', async ($, on) => {
  const { written, clock, turn } = await sendingHelpers($, on, [{ status: 'running' }])

  await turn()
  const told = written.length
  await clock.advance(9 * 60 * 1000)
  expect(written).toHaveLength(told)

  // Well before the half hour after which the desktop cat stops counting it.
  await clock.advance(60 * 1000)
  expect(written).toHaveLength(told + 1)
  expect(written.at(-1)?.mood).toBe('waiting')
  expect(written.at(-1)?.updatedAt).toBeGreaterThanOrEqual(1234 + 10 * 60 * 1000)
})

test("in the Claude app the report carries the app's own id for the conversation, for the desktop cat to open it", async ($, on) => {
  const written: { mood: string; appSession?: string }[] = []

  on('env.get', (_, e) => ({
    value:
      e.name === 'USERPROFILE' ? 'C:/Users/me' : e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_1a2b-3c4d' : undefined,
  }))
  on('session.id', () => ({ value: 'abc' }))
  const clock = mock.clock(on, { now: 1234 })
  on('fs.write', (_, e) => {
    written.push(JSON.parse(e.text))

    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }))

  await $.tool.call({ tool: 'Bash', command: 'rm x' })
  await clock.settle()

  expect(written.find(report => report.mood === 'calling')).toMatchObject({ appSession: 'local_1a2b-3c4d' })
  // In a terminal the app sets nothing, and the report says nothing of it:
  // the first test's reports hold no appSession at all.
})

// The band above the prompt, as the Claude app asks this cat for its row.
const BAND = {
  plugin: 'desktop-cat',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const
const HOUR = 60 * 60 * 1000
const WAITS = ['15 分鐘', '30 分鐘', '1 小時']
const timeOfDay = (at: number, language = 'zh-Hant') =>
  new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(at)

/** Where no row of the cat's is drawn, the engine's own is: here, a word. */
const engineDraws = (on: Parameters<TestBody>[1]) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

/** The row above the prompt as a surface shows it now: its words and its buttons. */
const reminderRow = async ($: Parameters<TestBody>[0], surface: 'desktop' | 'mobile' | 'terminal' = 'desktop') => {
  const ui = await $.ui.mount({ ...BAND, surface })
  const buttons = (await ui.findAll({ type: 'Button' })).map(found => String(found.props.label))
  // Beside the cat's row the mount draws the engine's own, which is not the
  // cat's to answer for; and the words on a button are the button's.
  const words = (await ui.findAll({ type: 'Text' }))
    .map(found => found.text)
    .filter(word => word !== 'engine' && !buttons.includes(String(word)))
  await ui.unmount()

  return { words, buttons }
}

/** A turn that ended on a question in the next-step box: the conversation waits on the person. */
const askInTheBox = async ($: Parameters<TestBody>[0], clock: { settle: () => Promise<unknown> }) => {
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Fixed it.', ask: 'Install it?' })
  await $.turn.complete(ANSWERED)
  await clock.settle()
}

test('only while the conversation waits on the person, a row above the prompt offers to remind them later', async ($, on) => {
  const { clock } = endingWithTheBox(on)
  engineDraws(on)

  expect(await reminderRow($)).toEqual({ words: [], buttons: [] })

  await askInTheBox($, clock)
  for (const surface of ['desktop', 'mobile'] as const) {
    expect(await reminderRow($, surface)).toEqual({ words: ['稍後提醒我'], buttons: WAITS })
  }
  // The row opens with the cat's paw, still and pink, so it is seen to be the cat's.
  const row = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const paw = await row.find({ type: 'Svg' })
  expect(paw?.props.alt).toBe('A pink paw print')
  // A 16 px square, as tall as the words' line, so the row is laid out as
  // without it; the paw stands on the square's foot, where the words stand.
  expect(paw?.props.width).toBe(16)
  expect(paw?.props.height).toBe(16)
  expect(String(paw?.props.source)).toContain('viewBox="0 0 100 100"')
  expect(String(paw?.props.source)).toContain('translate(50 100) scale(.92) translate(-50 -87.5)')
  expect(String(paw?.props.source)).toContain('#E998A9')
  expect(String(paw?.props.source)).not.toContain('animate')
  // Its words in the cat's rose brown, the same on a light app and a dark one; the buttons are the app's.
  const colours = (await row.findAll({ type: 'Text' }))
    .filter(found => found.text !== 'engine')
    .map(found => found.props.color)
  expect(colours).toEqual(['#A0766F'])
  await row.unmount()
  // The terminal keeps its own band, and a survey has the band first.
  expect(await reminderRow($, 'terminal')).toEqual({ words: [], buttons: [] })
  const survey = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } })
  expect(await survey.findAll({ type: 'Button' })).toHaveLength(0)
  await survey.unmount()

  // The next turn begins: nothing waits on the person any more.
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.settle()
  expect(await reminderRow($)).toEqual({ words: [], buttons: [] })
})

test('a press puts the conversation off: the report says till when, and the row says so and takes it back', async ($, on) => {
  const { written, clock } = endingWithTheBox(on)

  await askInTheBox($, clock)
  expect(written.at(-1)).toMatchObject({ mood: 'calling', calledAt: 1234, remindAt: 0 })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'remind-in60' })
  await clock.settle()
  // Still waiting on the person, as of the same call: only the time is new.
  expect(written.at(-1)).toMatchObject({ mood: 'calling', calledAt: 1234, callsAgain: false, remindAt: 1234 + HOUR })
  expect((await ui.find({ type: 'Text' }))?.text).toBe(`將在 ${timeOfDay(1234 + HOUR)} 提醒你`)
  expect((await ui.findAll({ type: 'Button' })).map(found => found.props.label)).toEqual(['取消'])

  await ui.press({ key: 'remind-cancel' })
  await clock.settle()
  expect(written.at(-1)).toMatchObject({ mood: 'calling', calledAt: 1234, remindAt: 0 })
  expect((await ui.findAll({ type: 'Button' })).map(found => found.props.label)).toEqual(WAITS)

  // A time chosen again replaces the last.
  await ui.press({ key: 'remind-in15' })
  await ui.press({ key: 'remind-cancel' })
  await clock.settle()
  expect(written.at(-1)).toMatchObject({ remindAt: 0 })
  await ui.unmount()
})

test('when the time comes the conversation calls again as of then, and the row offers its choices anew', async ($, on) => {
  const { written, clock } = await sendingHelpers($, on, [])
  const reported = () => written.at(-1) as { mood: string; calledAt: number; remindAt: number } | undefined

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Fixed it.', ask: 'Install it?' })
  await $.turn.complete(ANSWERED)
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'remind-in15' })
  await clock.settle()
  const at = 1234 + 15 * 60 * 1000
  expect(reported()).toMatchObject({ mood: 'calling', calledAt: 1234, remindAt: at })

  // Before the time, whatever is told the desktop cat still says when.
  await clock.advance(14 * 60 * 1000)
  expect(reported()).toMatchObject({ mood: 'calling', calledAt: 1234, remindAt: at })
  expect((await ui.findAll({ type: 'Button' })).map(found => found.props.label)).toEqual(['取消'])

  // The call is dated to the time chosen, when a desktop cat keeping the time
  // itself began to call: so it meows once, not twice.
  await clock.advance(60 * 1000 + 2000)
  expect(reported()).toMatchObject({ mood: 'calling', calledAt: at, remindAt: 0 })
  expect((await ui.findAll({ type: 'Button' })).map(found => found.props.label)).toEqual(WAITS)
  await ui.unmount()
})

test('answered while put off, the conversation is no longer put off', async ($, on) => {
  const written: { mood: string; remindAt: number }[] = []
  on('env.get', () => ({ value: 'C:/Users/me' }))
  on('session.id', () => ({ value: 'abc' }))
  const clock = mock.clock(on, { now: 1234 })
  on('fs.write', (_, e) => {
    written.push(JSON.parse(e.text))

    return { value: undefined }
  })
  on('tool.check', () => ({ decision: 'ask' }))
  on('tool.call', () => ({ result: {} }))
  let answer = () => {}
  on(
    'classic.PermissionRequest',
    () =>
      new Promise(resolve => {
        answer = () => resolve({ decision: { behavior: 'allow' } })
      }),
  )
  engineDraws(on)

  // A card holds the work up, and the person asks to be reminded of it.
  const calling = $.tool.call({ tool: 'Bash', command: 'rm x' })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'remind-in30' })
  await clock.settle()
  await ui.unmount()
  expect(written.at(-1)).toMatchObject({ mood: 'calling', remindAt: 1234 + HOUR / 2 })

  answer()
  await calling
  await clock.settle()
  expect(written.at(-1)).toMatchObject({ mood: 'working', remindAt: 0 })
  expect(await reminderRow($)).toEqual({ words: [], buttons: [] })
})

test('the row speaks the language the cats speak, the time too', async ($, on) => {
  const files = desktopFiles(on, { language: 'en' })
  const clock = mock.clock(on, { now: 1234 })
  on('command.register', () => ({ value: { command: 'cat' } }))
  on('tool.register', () => ({ value: { tool: SAD_TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.list', () => ({ value: [] }))
  await $.session.start(START)
  expect(files.has(PREFS)).toBe(true)

  await askInTheBox($, clock)
  expect(await reminderRow($)).toEqual({
    words: ['Remind me later'],
    buttons: ['In 15 minutes', 'In 30 minutes', 'In 1 hour'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'remind-in60' })
  await clock.settle()
  expect((await ui.find({ type: 'Text' }))?.text).toBe(`Reminder set for ${timeOfDay(1234 + HOUR, 'en')}`)
  expect((await ui.findAll({ type: 'Button' })).map(found => found.props.label)).toEqual(['Cancel'])
  await ui.unmount()
})

test('work after the next-step box means the turn went on: its question does not wait on the person', async ($, on) => {
  const { written, clock } = endingWithTheBox(on)
  engineDraws(on)

  // The box asks, the person's answer arrives while the turn runs, and the
  // conversation carries on to the end of the work without filling the box again.
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Paused.', ask: 'How should it change?' })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  await $.turn.complete(ANSWERED)
  await clock.settle()

  expect((await paneCat($)).label).toBe('休息中')
  // The work is done: one meow, and nothing put to the person.
  expect(written.at(-1)).toMatchObject({ mood: 'resting', calledAt: 1234 })
  expect(await reminderRow($)).toEqual({ words: [], buttons: [] })

  // The next turn ends on a question of its own: that one waits.
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Done.', ask: 'Ship it?' })
  await $.turn.complete(ANSWERED)
  await clock.settle()
  expect((await paneCat($)).label).toBe('等你回應')
  expect(await reminderRow($)).toEqual({ words: ['稍後提醒我'], buttons: WAITS })
})

/** The engine's side of a model step that says and calls nothing. */
const engineSteps = (on: Parameters<TestBody>[1]) =>
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

/** One step of the conversation's own, run to its end. */
const step = async ($: Parameters<TestBody>[0], index: number) => {
  for await (const chunk of $.turn.step({ turnId: 't', index, model: 'model', messageCount: 1 })) {
    void chunk
  }
}

/** The person types while the turn `t` runs. */
const sayMeanwhile = ($: Parameters<TestBody>[0], kind: 'composer' | 'bridge' = 'composer') =>
  $.prompt.submit({ text: '改成這樣就好', wait: false, origin: { kind }, turnId: 't' })

const BOX_ASKS = { tool: 'mcp__ccd_turn__wrap_up', recap: 'Paused.', ask: 'How should it change?' } as const

test('answered while the turn ran, with only a reply after: the question in the box does not wait on the person', async ($, on) => {
  const { written, clock } = endingWithTheBox(on)
  engineSteps(on)
  engineDraws(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))

  // The person types while the step that fills the box is still running; their
  // words are read at the next step, which only replies.
  await step($, 0)
  await sayMeanwhile($)
  await $.tool.call(BOX_ASKS)
  await step($, 1)
  await $.turn.complete(ANSWERED)
  await clock.settle()

  expect((await paneCat($)).label).toBe('休息中')
  expect(written.at(-1)).toMatchObject({ mood: 'resting', calledAt: 1234 })
  expect(await reminderRow($)).toEqual({ words: [], buttons: [] })
})

test('said from the phone as the turn closes on its question: the person has spoken, so the cat does not call them', async ($, on) => {
  const { written, clock } = endingWithTheBox(on)
  engineSteps(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await step($, 0)
  await $.tool.call(BOX_ASKS)
  await step($, 1)
  await sayMeanwhile($, 'bridge')
  await $.turn.complete(ANSWERED)
  await clock.settle()

  expect(written.at(-1)).toMatchObject({ mood: 'resting' })
})

test('a question put after the person spoke, and what is not their words, still wait on them', async ($, on) => {
  const { written, clock } = endingWithTheBox(on)
  engineSteps(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))

  // Said early and read: the question the turn ends on comes after it.
  await step($, 0)
  await sayMeanwhile($)
  await step($, 1)
  await $.tool.call(BOX_ASKS)
  await step($, 2)
  await $.turn.complete(ANSWERED)
  await clock.settle()
  expect(written.at(-1)).toMatchObject({ mood: 'calling', callsAgain: false })

  // A background task reporting in is not the person answering.
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await step($, 0)
  await $.tool.call(BOX_ASKS)
  await $.prompt.submit({ text: 'done', wait: false, origin: { kind: 'task-notification' }, turnId: 't' })
  await step($, 1)
  await $.turn.complete(ANSWERED)
  await clock.settle()
  expect(written.at(-1)).toMatchObject({ mood: 'calling', callsAgain: false })
})

test("the task list updated beside the box is the turn's own bookkeeping: the question still waits", async ($, on) => {
  const { written, clock } = endingWithTheBox(on)

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Fixed it.', ask: 'Install it?' })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })
  await $.turn.complete(ANSWERED)
  await clock.settle()

  expect((await paneCat($)).label).toBe('等你回應')
  expect(written.at(-1)).toMatchObject({ mood: 'calling', callsAgain: false })
})

/** A card that holds the work up and is left unanswered: the reports the desktop cat reads, and the answer. */
const cardLeftWaiting = (on: Parameters<TestBody>[1]) => {
  const written: { mood: string; updatedAt: number; calledAt: number; callsAgain: boolean }[] = []
  const card = { answer: () => {} }

  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('session.id', () => ({ value: 'abc' }))
  const clock = mock.clock(on, { now: 1234 })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_, e) => {
    written.push(JSON.parse(e.text))

    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'cat' } }))
  on('tool.register', () => ({ value: { tool: SAD_TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({ value: [] }))
  on('tool.check', () => ({ decision: 'ask' }))
  on(
    'classic.PermissionRequest',
    () =>
      new Promise(resolve => {
        card.answer = () => resolve({ decision: { behavior: 'allow' } })
      }),
  )

  return { written, clock, card }
}

test('left waiting, the conversation keeps telling the desktop cat that it waits, till it is answered', async ($, on) => {
  const { written, clock, card } = cardLeftWaiting(on)
  await $.session.start(START)

  const calling = $.tool.call({ tool: 'Bash', command: 'rm x' })
  await clock.settle()
  expect(written.at(-1)).toMatchObject({ mood: 'calling', calledAt: 1234, callsAgain: true })

  const told = written.length
  await clock.advance(9 * 60 * 1000)
  expect(written).toHaveLength(told)

  // Well before the half hour after which the desktop cat would take it for gone, and sleep.
  await clock.advance(60 * 1000 + 2000)
  expect(written).toHaveLength(told + 1)
  expect(written.at(-1)).toMatchObject({ mood: 'calling', calledAt: 1234, callsAgain: true })
  expect(written.at(-1)?.updatedAt).toBeGreaterThanOrEqual(1234 + 10 * 60 * 1000)
  expect((await paneCat($)).label).toBe('等你回應')

  // Answered, it has nothing more to keep saying.
  card.answer()
  await calling
  await clock.settle()
  expect(written.at(-1)).toMatchObject({ mood: 'working' })
  const after = written.length
  await clock.advance(11 * 60 * 1000)
  expect(written).toHaveLength(after)
})

test('the meow every few minutes is asked for through the first half hour of a call, not after', async ($, on) => {
  // No conversation started here, so no check runs every two seconds: the clock moves at once.
  const { written, clock, card } = cardLeftWaiting(on)

  const calling = $.tool.call({ tool: 'Bash', command: 'rm x' })
  await clock.settle()
  expect(written.at(-1)).toMatchObject({ mood: 'calling', calledAt: 1234, callsAgain: true })

  // Whatever is told the desktop cat meanwhile: here, the person puts the call off and takes that back.
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const tellAgain = async () => {
    await ui.press({ key: 'remind-in60' })
    await ui.press({ key: 'remind-cancel' })
    await clock.settle()
  }

  await clock.advance(29 * 60 * 1000)
  await tellAgain()
  expect(written.at(-1)).toMatchObject({ mood: 'calling', calledAt: 1234, callsAgain: true })

  await clock.advance(60 * 1000)
  await tellAgain()
  expect(written.at(-1)).toMatchObject({ mood: 'calling', calledAt: 1234, callsAgain: false })
  await ui.unmount()

  card.answer()
  await calling
  await clock.settle()
})

test('a card that holds the work up still asks the desktop cat to meow again', async ($, on) => {
  const { written, clock } = endingWithTheBox(on)

  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }))
  await $.tool.call({ tool: 'Bash', command: 'rm x' })
  await clock.settle()

  expect(written.find(report => report.mood === 'calling')).toMatchObject({ callsAgain: true })
})

test('the pane cat works during a tool call and rests when the turn ends', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect((await paneCat($)).label).toBe('做事中')

  await $.turn.complete({
    reason: 'answer',
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
  })
  expect((await paneCat($)).label).toBe('休息中')
})

test('a subagent does not move the pane cat', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'helper' })
  expect((await paneCat($)).label).toBe('休息中')
})

test('every block of a reply has the avatar, a summary does not', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  for (const isFirstOfReply of [true, false]) {
    const ui = await $.ui.mount({
      ...REPLY,
      surface: 'desktop',
      props: { ...REPLY.props, isFirstOfReply },
    })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await ui.unmount()
  }

  const summary = await $.ui.mount({
    ...REPLY,
    surface: 'desktop',
    props: { ...REPLY.props, isSummary: true },
  })
  expect(await summary.findAll({ type: 'Svg' })).toHaveLength(0)
  await summary.unmount()
})

test('every picture says what it shows, as the desktop app requires', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  for (const site of [SPINNER, REPLY, PANE]) {
    const ui = await $.ui.mount({ ...site, surface: 'desktop' })

    for (const picture of await ui.findAll({ type: 'Svg' })) {
      expect(String(picture.props.alt).trim()).not.toBe('')
    }
    await ui.unmount()
  }
})

test('no Box around the engine row takes a prop the engine refuses there', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  // A real engine node under a Box with one of these refuses the whole tree,
  // and the kit's stand-in above cannot show that by itself.
  const refused = ['display', 'overflow', 'position', 'width', 'height', 'minWidth', 'minHeight']

  for (const target of [SPINNER, REPLY]) {
    const ui = await $.ui.mount({ ...target, surface: 'desktop' })

    for (const box of await ui.findAll({ type: 'Box' })) {
      expect(refused.filter(name => box.props[name] !== undefined)).toEqual([])
    }
    await ui.unmount()
  }
})

test('the terminal keeps its own drawing and draws the pane as text', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const row = await $.ui.mount({ ...SPINNER, surface: 'terminal' })
  expect((await row.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await row.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text' }))?.text).toContain('休息中')
  await pane.unmount()
})

test('the cat voice joins the prompt until it is turned off, and comes back on', async ($, on) => {
  const files = desktopFiles(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }))
  const voiced = async () =>
    (
      await $.prompt.compose({
        model: 'claude-opus-5-5',
        promptModel: 'claude-opus-5-5',
        surfaces: ['desktop'],
        tools: [],
        outputStyle: null,
        traits: [],
      })
    ).sections.some(section => section.id === 'desktop-cat:voice')
  const voice = (args: string) =>
    $.command.run({
      command: 'cat-voice',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

  expect(await voiced()).toBe(true)
  expect((await voice('off')).text).toContain('關掉')
  expect(await voiced()).toBe(false)
  expect(JSON.parse(files.get(PREFS) ?? '{}').voice).toBe(false)
  expect((await voice('')).text).toContain('打開')
  expect(await voiced()).toBe(true)
})

test('the cat voice is medium unless asked to be light, and a strength turns it on', async ($, on) => {
  const files = desktopFiles(on, { voice: false })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }))
  const voiceText = async () =>
    (
      await $.prompt.compose({
        model: 'claude-opus-5-5',
        promptModel: 'claude-opus-5-5',
        surfaces: ['desktop'],
        tools: [],
        outputStyle: null,
        traits: [],
      })
    ).sections.find(section => section.id === 'desktop-cat:voice')?.text
  const voice = (args: string) =>
    $.command.run({
      command: 'cat-voice',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

  await voice('on')
  expect(await voiceText()).toContain('sniffing a file over')
  expect((await voice('中')).text).toContain('中')
  expect(await voiceText()).toContain('sniffing a file over')
  expect(JSON.parse(files.get(PREFS) ?? '{}')).toEqual({ voice: true, voiceLevel: 'medium' })

  expect((await voice('light')).text).toContain('輕')
  const light = await voiceText()
  expect(light).toContain('one small cat touch')
  expect(light).not.toContain('sniffing')

  // Switched off and on again, it keeps its strength.
  await voice('off')
  expect(await voiceText()).toBeUndefined()
  await voice('on')
  expect(await voiceText()).toContain('one small cat touch')
})

test('what a pat means is in the prompt, with the cat voice on or off', async ($, on) => {
  const files = desktopFiles(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }))
  const pat = async () =>
    (
      await $.prompt.compose({
        model: 'claude-opus-5-5',
        promptModel: 'claude-opus-5-5',
        surfaces: ['desktop'],
        tools: [],
        outputStyle: null,
        traits: [],
      })
    ).sections.find(section => section.id === 'desktop-cat:pat')?.text

  expect(await pat()).toContain('（摸摸頭 ×2）')
  files.set(PREFS, JSON.stringify({ voice: false }))
  expect(await pat()).toContain('do nothing else')
})

test('the desktop cat turning the voice off is heard here too', async ($, on) => {
  const files = desktopFiles(on, { voice: false })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }))
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['desktop'],
    tools: [],
    outputStyle: null,
    traits: [],
  })

  expect(composed.sections.some(section => section.id === 'desktop-cat:voice')).toBe(false)
  expect(files.size).toBe(1)
})

test('the cat wears the coat the desktop cat wears, and changes with it', async ($, on) => {
  const files = desktopFiles(on, { coat: 'tuxedo' })
  const clock = mock.clock(on, { now: 1234 })
  on('command.register', () => ({ value: { command: 'cat' } }))
  on('tool.register', () => ({ value: { tool: SAD_TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start(START)
  const before = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const tuxedo = await before.find({ type: 'Svg' })
  await before.unmount()

  expect(String(tuxedo?.props.source)).toContain('#4A4646')
  expect(String(tuxedo?.props.source)).not.toContain('#E58B3F')

  files.set(PREFS, JSON.stringify({ coat: 'calico' }))
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const cat = await ui.find({ type: 'Svg' })
  await ui.unmount()

  expect(String(cat?.props.source)).toContain('#E58B3F')
})

test('the Siamese coat chosen on the desktop is cream with blue eyes', async ($, on) => {
  desktopFiles(on, { coat: 'siamese' })
  on('command.register', () => ({ value: { command: 'cat' } }))
  on('tool.register', () => ({ value: { tool: SAD_TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const cat = await ui.find({ type: 'Svg' })
  await ui.unmount()

  expect(String(cat?.props.source)).toContain('#EEE9E2')
  expect(String(cat?.props.source)).toContain('points-siamese')
  expect(String(cat?.props.source)).not.toContain('#E58B3F')
})

test('the cat sleeps on the cushion colour the desktop cat chose, and changes with it', async ($, on) => {
  const files = desktopFiles(on, { cushion: 'berry' })
  const clock = mock.clock(on, { now: 1234 })
  on('command.register', () => ({ value: { command: 'cat' } }))
  on('tool.register', () => ({ value: { tool: SAD_TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start(START)
  const asleep = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const cat = await ui.find({ type: 'Svg' })
    await ui.unmount()

    return String(cat?.props.source)
  }

  expect(await asleep()).toContain('fill:#B84C67')

  files.set(PREFS, JSON.stringify({ cushion: 'night-sky' }))
  await clock.advance(2000)
  expect(await asleep()).toContain('fill:#3D3B63')

  // A name this cat does not know: the cushion it starts on.
  files.set(PREFS, JSON.stringify({ cushion: 'plaid' }))
  await clock.advance(2000)
  expect(await asleep()).toContain('fill:#9FAB87')
})

// The places, named only in their own drawings (place-art.ts): a copy without
// them (the public one, for now) has none, and the cat stays as it is at home.
const PLACE_NAMES = Object.keys(PLACE_ART) as (keyof typeof PLACE_ART)[]
/** The things a drawing puts on the cat or beside it, by the names it gives them. */
const thingsIn = (...drawings: string[]) => [...drawings.join('').matchAll(/data-thing="([^"]+)"/g)].map(match => match[1])

test('in the place the desktop cat is in, the cat dresses for it and sleeps on its cushion', async ($, on) => {
  // The first place and the third, as this test has always taken them. (The
  // second and the fourth draw a pane over the engine's 131072-character limit
  // for now, so the pane is left undrawn there: to be made lighter.)
  const [first, , second] = PLACE_NAMES

  if (first === undefined || second === undefined) {
    return
  }
  const files = desktopFiles(on, { place: first, cushion: 'berry' })
  const clock = mock.clock(on, { now: 1234 })
  on('command.register', () => ({ value: { command: 'cat' } }))
  on('tool.register', () => ({ value: { tool: SAD_TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.session.start(START)
  const picture = async (site: typeof PANE | typeof REPLY) => {
    const ui = await $.ui.mount({ ...site, surface: 'desktop' })
    const cat = await ui.find({ type: 'Svg' })
    await ui.unmount()

    return String(cat?.props.source)
  }

  // Asleep in the first place: what it wears and has before the cushion, on
  // the place's own cushion rather than the one chosen.
  const asleepIn = (place: keyof typeof PLACE_ART) => thingsIn(PLACE_ART[place].head.lying, PLACE_ART[place].beside.lying)
  const inFirst = await picture(PANE)
  expect(asleepIn(first).length).toBeGreaterThan(0)
  for (const thing of asleepIn(first)) {
    expect(inFirst).toContain(`data-thing="${thing}"`)
  }
  expect(inFirst).toContain(`fill:${PLACE_ART[first].cushion.colour}`)
  expect(inFirst).not.toContain('fill:#B84C67')
  // Beside each reply, its face with what it wears on its head.
  const onItsHead = thingsIn(PLACE_ART[first].head.sitting).filter(thing => thingsIn(PLACE_ART[first].head.lying).includes(thing))
  const reply = await picture(REPLY)
  for (const thing of onItsHead) {
    expect(reply).toContain(`data-thing="${thing}"`)
  }

  files.set(PREFS, JSON.stringify({ place: second, cushion: 'berry' }))
  await clock.advance(2000)
  const inSecond = await picture(PANE)
  for (const thing of asleepIn(second)) {
    expect(inSecond).toContain(`data-thing="${thing}"`)
  }
  for (const thing of asleepIn(first).filter(thing => !asleepIn(second).includes(thing))) {
    expect(inSecond).not.toContain(`data-thing="${thing}"`)
  }

  // Back home, or somewhere this cat does not know: bare, on the cushion chosen.
  for (const place of ['none', 'moon']) {
    files.set(PREFS, JSON.stringify({ place, cushion: 'berry' }))
    await clock.advance(2000)
    const home = await picture(PANE)
    expect(home).not.toContain('data-thing=')
    expect(home).toContain('fill:#B84C67')
  }
})

test('the cans hear how much of each window is left and when it fills again', async ($, on) => {
  const written: { path: string; text: string }[] = []
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  mock.clock(on, { now: 1234 })
  on('fs.write', (_, e) => {
    written.push({ path: e.path.replaceAll('\\', '/'), text: e.text })

    return { value: undefined }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const measure = (changed: ('rateLimits' | 'context')[], rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]) =>
    $.session.measure({ context: { window: 200000 }, rateLimits, changed })

  await measure(['context'], [{ kind: 'five_hour', percentUsed: 10 }])
  expect(written).toEqual([])

  await measure(['rateLimits'], [
    { kind: 'five_hour', percentUsed: 34, resetsAt: '2026-11-04T09:00:00Z' },
    { kind: 'seven_day', percentUsed: 6.5, resetsAt: '2026-11-11T19:00:00Z' },
    { kind: 'spend_limit', percentUsed: 50 },
  ])
  expect(written).toHaveLength(1)
  expect(written[0]?.path).toBe('C:/Users/me/.desktop-cat/usage.json')
  expect(JSON.parse(written[0]?.text ?? '{}')).toEqual({
    fiveHour: { percentUsed: 34, resetsAt: '2026-11-04T09:00:00Z' },
    sevenDay: { percentUsed: 6.5, resetsAt: '2026-11-11T19:00:00Z' },
    seenAt: 1234,
  })

  // Off a subscription: nothing to show, nothing written.
  await measure(['rateLimits'], [])
  expect(written).toHaveLength(1)
})

test('a cat with no choice made yet wears the calico coat', async ($, on) => {
  desktopFiles(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const cat = await ui.find({ type: 'Svg' })
  await ui.unmount()

  expect(String(cat?.props.source)).toContain('#E58B3F')
})
test('the words come from the Chinese table, the same words as before', async () => {
  const say = textIn(SOURCE)

  expect(say('pat.praise', { count: 2 })).toBe('（摸摸頭 ×2）做得很好！')
  expect(say('pane.failed', { reason: 'no room' })).toBe('貓咪面板現在顯示不出來：no room')
  expect(textIn('fr')('pose.resting')).toBe('休息中')
  expect(Object.keys(TABLES)).toEqual(['zh-Hant', 'en'])
})

test('the English table says the same things, with the same blanks to fill', async () => {
  const names = (table: object, prefix = ''): string[] =>
    Object.entries(table).flatMap(([name, words]) =>
      typeof words === 'object' && words !== null ? names(words, `${prefix}${name}.`) : [`${prefix}${name}`],
    )

  expect(names(TABLES.en ?? {}).sort()).toEqual(names(TABLES[SOURCE] ?? {}).sort())
  expect(textIn('en')('pat.praise', { count: 2 })).toBe('(head pat ×2) Good job!')
  expect(textIn('en')('pose.calling')).toBe('Your turn')
})

test('the language is picked as the desktop cat picks it', async () => {
  // With an English table as well as the Chinese one, as there will be.
  const both = ['zh-Hant', 'en']

  expect(pickLanguage(undefined, ['zh-TW'], both)).toBe('zh-Hant')
  expect(pickLanguage(undefined, ['zh-HK'], both)).toBe('zh-Hant')
  expect(pickLanguage(undefined, ['en-GB'], both)).toBe('en')
  expect(pickLanguage('en', ['zh-TW'], both)).toBe('en')
  expect(pickLanguage('auto', ['zh-TW'], both)).toBe('zh-Hant')
  expect(pickLanguage(undefined, ['ja-JP'], both)).toBe('en')
  expect(pickLanguage(undefined, ['not a language!', 'zh-TW'], both)).toBe('zh-Hant')
  expect(pickLanguage(undefined, ['ja-JP'], ['zh-Hant'])).toBe('zh-Hant')
})
