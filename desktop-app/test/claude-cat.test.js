const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const {
  MARKETPLACE,
  PAIRED_CLAUDE_CAT,
  PLUGIN_ID,
  TIMES,
  bringUpToDate,
  careForClaudeCat,
  claudeCode,
  findClaudeCodes,
  needsNewerClaudeCat,
  runClaudeCode,
} = require('../src/claude-cat')
const { ACTIVE_FOR_MS } = require('../src/mood')

const NOW = 1_800_000_000_000

/** A pretend Claude Code: lists the Claude cat at `installed`, and updates it
    to `latest` when the marketplace was refreshed first, as 2.1.325 does. */
function pretendClaudeCode({ installed = '1.20.0', latest = PAIRED_CLAUDE_CAT, scope = 'user', online = true, lists = true } = {}) {
  const ran = []
  const state = { installed, refreshed: false }

  const run = async (file, args) => {
    ran.push([path.basename(file), ...args])
    const command = args.join(' ')

    if (command === 'plugin list --json') {
      if (!lists) {
        return { code: 1, stdout: '' }
      }

      const plugins = state.installed === null ? [] : [{ id: PLUGIN_ID, version: state.installed, scope, enabled: true }]
      return { code: 0, stdout: JSON.stringify(plugins, null, 2) }
    }

    if (command === `plugin marketplace update ${MARKETPLACE}`) {
      state.refreshed = online
      return { code: online ? 0 : 1, stdout: '' }
    }

    if (command.startsWith(`plugin update ${PLUGIN_ID}`)) {
      // Already at the latest it knows of: exit 0 all the same.
      if (state.refreshed) {
        state.installed = latest
      }
      return { code: online ? 0 : 1, stdout: '' }
    }

    return { code: 1, stdout: '' }
  }

  return { run, ran, state }
}

test('the Claude Code to ask: the Claude app\'s own, newest first, then the PATH, then its installer\'s folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-cat-claude-'))
  const make = (...parts) => {
    const file = path.join(root, ...parts)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')
    return file
  }
  const older = make('local', 'Claude-Data', 'claude_box', 'claude-code', '2.1.9', 'aaa', 'claude.exe')
  // Another account's copy, between the two: the newest comes first whoever's it is.
  const middle = make('local', 'Claude-Data', 'another_box', 'claude-code', '2.1.9.5', 'mmm', 'claude.exe')
  const newer = make('local', 'Claude-Data', 'claude_box', 'claude-code', '2.1.10', 'bbb', 'claude.exe')
  // A version folder with nothing in it is passed over.
  fs.mkdirSync(path.join(root, 'local', 'Claude-Data', 'claude_box', 'claude-code', '2.2.0', 'ccc'), { recursive: true })
  const onPath = make('bin', 'claude.exe')
  const fromNpm = make('npm', 'claude.cmd')
  const installed = make('home', '.local', 'bin', 'claude.exe')

  const found = findClaudeCodes({
    platform: 'win32',
    home: path.join(root, 'home'),
    env: {
      LOCALAPPDATA: path.join(root, 'local'),
      // The installer's folder on the PATH too: asked once only.
      PATH: [path.join(root, 'bin'), path.join(root, 'nowhere'), path.join(root, 'npm'), path.join(root, 'home', '.local', 'bin')].join(path.delimiter),
    },
  })

  assert.deepEqual(found, [newer, middle, older, onPath, fromNpm, installed])
  assert.deepEqual(findClaudeCodes({ platform: 'win32', home: path.join(root, 'none'), env: { LOCALAPPDATA: path.join(root, 'none') } }), [])
  fs.rmSync(root, { recursive: true })
})

test('on a Mac: the Claude app\'s own, newest first, then the PATH, then the folders a short PATH leaves out', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-cat-claude-'))
  const make = (...parts) => {
    const file = path.join(root, ...parts)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')
    return file
  }
  const codes = ['home', 'Library', 'Application Support', 'Claude', 'claude-code']
  const program = ['claude.app', 'Contents', 'MacOS', 'claude']
  const older = make(...codes, '2.1.9', 'aaa', ...program)
  const newer = make(...codes, '2.1.326', 'bbb', ...program)
  fs.mkdirSync(path.join(root, ...codes, '2.2.0', 'ccc'), { recursive: true })
  const onPath = make('bin', 'claude')
  const local = make('home', '.claude', 'local', 'claude')
  const installed = make('home', '.local', 'bin', 'claude')

  const found = findClaudeCodes({
    platform: 'darwin',
    home: path.join(root, 'home'),
    env: { PATH: [path.join(root, 'bin'), path.join(root, 'nowhere')].join(path.delimiter) },
  })

  // Homebrew's folders are this computer's own, so only the test's files are compared.
  assert.deepEqual(found.filter(file => file.startsWith(root)), [newer, older, onPath, local, installed])
  fs.rmSync(root, { recursive: true })
})

test('already the paired version: nothing is updated', async () => {
  const claude = pretendClaudeCode({ installed: PAIRED_CLAUDE_CAT })
  assert.equal(await bringUpToDate({ find: () => ['claude.exe'], run: claude.run }), 'current')
  assert.deepEqual(claude.ran, [['claude.exe', 'plugin', 'list', '--json']])

  const newer = pretendClaudeCode({ installed: '9.0.0' })
  assert.equal(await bringUpToDate({ find: () => ['claude.exe'], run: newer.run }), 'current', 'a newer one is left alone')
})

test("an older one is updated through Claude Code's own commands, the marketplace refreshed first, then checked", async () => {
  const claude = pretendClaudeCode()
  assert.equal(await bringUpToDate({ find: () => ['claude.exe'], run: claude.run }), 'updated')
  assert.deepEqual(claude.ran, [
    ['claude.exe', 'plugin', 'list', '--json'],
    ['claude.exe', 'plugin', 'marketplace', 'update', MARKETPLACE],
    ['claude.exe', 'plugin', 'update', PLUGIN_ID, '--scope', 'user'],
    ['claude.exe', 'plugin', 'list', '--json'],
  ])
  assert.equal(claude.state.installed, PAIRED_CLAUDE_CAT)
})

test('installed for one project, it is updated in that scope', async () => {
  const claude = pretendClaudeCode({ scope: 'project' })
  await bringUpToDate({ find: () => ['claude.exe'], run: claude.run })
  assert.deepEqual(claude.ran[2], ['claude.exe', 'plugin', 'update', PLUGIN_ID, '--scope', 'project'])
})

test('no network: still older afterwards, so it failed, whatever the commands said', async () => {
  const offline = pretendClaudeCode({ online: false })
  assert.equal(await bringUpToDate({ find: () => ['claude.exe'], run: offline.run }), 'failed')

  // The marketplace still held the old version: "already at the latest", exit 0.
  const stale = pretendClaudeCode({ latest: '1.20.0' })
  assert.equal(await bringUpToDate({ find: () => ['claude.exe'], run: stale.run }), 'failed')
})

test("a Claude Code that can't list its plugins is passed over for the next", async () => {
  const old = pretendClaudeCode({ lists: false })
  const good = pretendClaudeCode()
  const run = (file, args) => (file === 'old.exe' ? old.run(file, args) : good.run(file, args))

  assert.equal(await bringUpToDate({ find: () => ['old.exe', 'good.exe'], run }), 'updated')
  assert.equal(old.ran.length, 1)
})

test("no Claude Code, or none with the Claude cat under its public name: it can't tell", async () => {
  assert.equal(await bringUpToDate({ find: () => [], run: pretendClaudeCode().run }), 'unknown')
  assert.equal(await bringUpToDate({ find: () => ['claude.exe'], run: pretendClaudeCode({ installed: null }).run }), 'unknown')
  assert.equal(await bringUpToDate({ find: () => ['a.exe', 'b.exe'], run: pretendClaudeCode({ lists: false }).run }), 'unknown')
})

test('the list is read even with words printed before it', async () => {
  const run = async () => ({ code: 0, stdout: `Checking…\n${JSON.stringify([{ id: PLUGIN_ID, version: PAIRED_CLAUDE_CAT }])}` })
  assert.equal(await bringUpToDate({ find: () => ['claude.exe'], run }), 'current')
  const garbled = async () => ({ code: 0, stdout: 'no list here' })
  assert.equal(await bringUpToDate({ find: () => ['claude.exe'], run: garbled }), 'unknown')
})

test('a conversation running an older Claude cat, going on now, needs a newer one', () => {
  const going = { updatedAt: NOW - 1000 }
  assert.equal(needsNewerClaudeCat([{ ...going, pluginVersion: '1.20.0' }], NOW, ACTIVE_FOR_MS), true)
  assert.equal(needsNewerClaudeCat([{ ...going, pluginVersion: PAIRED_CLAUDE_CAT }], NOW, ACTIVE_FOR_MS), false)
  assert.equal(needsNewerClaudeCat([{ ...going, pluginVersion: null }], NOW, ACTIVE_FOR_MS), false, "one that couldn't tell")
  assert.equal(
    needsNewerClaudeCat([{ updatedAt: NOW - ACTIVE_FOR_MS - 1, pluginVersion: '1.20.0' }], NOW, ACTIVE_FOR_MS),
    false,
    'one gone quiet',
  )
})

/** The care, on a pretend clock and Claude Code, with a person who answers the window. */
function setUpCare({ claude = pretendClaudeCode(), seenTo = null, remindAnswers = [] } = {}) {
  const timers = []
  const kept = { seenTo }
  const asked = []
  const saved = { ...claudeCode }
  claudeCode.find = () => ['claude.exe']
  claudeCode.run = claude.run

  const care = careForClaudeCat({
    activeForMs: ACTIVE_FOR_MS,
    store: { get: () => kept.seenTo, set: version => (kept.seenTo = version) },
    remind: async () => {
      asked.push('asked')
      return remindAnswers.shift() ?? true
    },
    later: (run, ms) => timers.push({ run, ms }),
  })

  const settle = async () => {
    for (let i = 0; i < 20; i += 1) {
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  const next = async () => {
    const timer = timers.shift()
    timer.run()
    await settle()
    return timer.ms
  }

  return { care, claude, kept, asked, timers, next, settle, done: () => Object.assign(claudeCode, saved) }
}

test('a minute after the start, an older Claude cat is updated, and kept as seen to', async () => {
  const care = setUpCare()

  try {
    assert.equal(care.timers[0].ms, TIMES.firstTryAfterMs)
    await care.next()
    assert.equal(care.kept.seenTo, PAIRED_CLAUDE_CAT)
    assert.deepEqual(care.asked, [], 'the person is not asked')
    assert.deepEqual(care.timers, [], 'nothing more to do')
  } finally {
    care.done()
  }
})

test('already seen to: no Claude Code is even run', async () => {
  const care = setUpCare({ seenTo: PAIRED_CLAUDE_CAT })

  try {
    await care.next()
    assert.deepEqual(care.claude.ran, [])
  } finally {
    care.done()
  }
})

test('a failed try is made once more an hour later; failing again, the person is asked, once', async () => {
  const care = setUpCare({ claude: pretendClaudeCode({ online: false }) })

  try {
    await care.next()
    assert.deepEqual(care.asked, [], 'not after the first try')
    assert.equal(care.timers[0].ms, TIMES.tryAgainAfterMs)
    await care.next()
    assert.deepEqual(care.asked, ['asked'])
    assert.equal(care.kept.seenTo, PAIRED_CLAUDE_CAT, 'asked once for this version')
    care.care.reportsSay([{ updatedAt: NOW, pluginVersion: '1.20.0' }], NOW)
    await care.settle()
    assert.deepEqual(care.asked, ['asked'], 'the reports ask no more')
  } finally {
    care.done()
  }
})

test('back online for the second try: updated, nobody asked', async () => {
  const claude = pretendClaudeCode({ online: false })
  const care = setUpCare({ claude })

  try {
    await care.next()
    claudeCode.run = pretendClaudeCode().run
    await care.next()
    assert.deepEqual(care.asked, [])
    assert.equal(care.kept.seenTo, PAIRED_CLAUDE_CAT)
  } finally {
    care.done()
  }
})

test("when no Claude Code can tell, a conversation running an older Claude cat has the person asked, once", async () => {
  const care = setUpCare({ claude: pretendClaudeCode({ installed: null }) })

  try {
    care.care.reportsSay([{ updatedAt: NOW, pluginVersion: '1.20.0' }], NOW)
    await care.settle()
    assert.deepEqual(care.asked, [], 'not before the try has said it can\'t tell')

    await care.next()
    care.care.reportsSay([{ updatedAt: NOW, pluginVersion: PAIRED_CLAUDE_CAT }], NOW)
    await care.settle()
    assert.deepEqual(care.asked, [], 'every conversation runs the paired one')

    care.care.reportsSay([{ updatedAt: NOW, pluginVersion: '1.20.0' }], NOW)
    care.care.reportsSay([{ updatedAt: NOW, pluginVersion: '1.20.0' }], NOW)
    await care.settle()
    assert.deepEqual(care.asked, ['asked'], 'one window, though the reports keep coming')
    assert.equal(care.kept.seenTo, PAIRED_CLAUDE_CAT)
  } finally {
    care.done()
  }
})

test("a reminder that couldn't be shown just then is not kept: the next report asks", async () => {
  const care = setUpCare({ claude: pretendClaudeCode({ installed: null }), remindAnswers: [false] })

  try {
    await care.next()
    care.care.reportsSay([{ updatedAt: NOW, pluginVersion: '1.20.0' }], NOW)
    await care.settle()
    assert.equal(care.kept.seenTo, null)
    care.care.reportsSay([{ updatedAt: NOW, pluginVersion: '1.20.0' }], NOW)
    await care.settle()
    assert.deepEqual(care.asked, ['asked', 'asked'])
    assert.equal(care.kept.seenTo, PAIRED_CLAUDE_CAT)
  } finally {
    care.done()
  }
})

test('updated, the conversations still running the old one ask nothing: new ones get the new one', async () => {
  const care = setUpCare()

  try {
    await care.next()
    care.care.reportsSay([{ updatedAt: NOW, pluginVersion: '1.20.0' }], NOW)
    await care.settle()
    assert.deepEqual(care.asked, [])
  } finally {
    care.done()
  }
})

test('a real program runs hidden, and its words and exit code come back', async () => {
  const ok = await runClaudeCode(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'plugin', 'list', '--json'])
  assert.deepEqual([ok.code, JSON.parse(ok.stdout)], [0, ['plugin', 'list', '--json']])

  const failed = await runClaudeCode(process.execPath, ['-e', 'process.exit(3)'])
  assert.equal(failed.code, 3)

  const missing = await runClaudeCode(path.join(os.tmpdir(), 'no-such-claude.exe'), ['plugin', 'list', '--json'])
  assert.notEqual(missing.code, 0)
})

test('a Claude Code from npm (a .cmd) runs through cmd.exe, from a folder with spaces in its name', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop cat claude '))
  const cmd = path.join(dir, 'claude.cmd')
  fs.writeFileSync(cmd, `@"${process.execPath}" -e "console.log(JSON.stringify(process.argv.slice(1)))" %*\r\n`)

  try {
    const { code, stdout } = await runClaudeCode(cmd, ['plugin', 'update', PLUGIN_ID, '--scope', 'user'])
    assert.equal(code, 0)
    assert.deepEqual(JSON.parse(stdout), ['plugin', 'update', PLUGIN_ID, '--scope', 'user'])
  } finally {
    fs.rmSync(dir, { recursive: true })
  }
})
