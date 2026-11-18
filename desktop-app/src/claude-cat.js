// The Claude cat (the Claude Code plugin) comes in a version that goes with
// this desktop cat. When the one installed is older, the desktop cat asks
// Claude Code to update it, through Claude Code's own plugin commands: it
// never writes into Claude Code's files itself. Only if that fails does it ask
// the person to have Claude update it.
//
// Tried with Claude Code 2.1.231 and 2.1.325: the newer one updates a plugin
// only from the marketplace copy it already has, so the copy is refreshed
// first; both say a plugin already at the latest version with exit code 0, so
// the version installed is read again afterwards rather than trusted.

const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { isNewer } = require('./updates')

// The Claude cat this desktop cat goes with. Kept equal to the plugin's own
// version by the public-copy script, which stops if they differ.
const PAIRED_CLAUDE_CAT = '1.21.0'
// Its public name in Claude Code, and the marketplace it comes from.
const MARKETPLACE = 'desktop-cat'
const PLUGIN_ID = `desktop-cat@${MARKETPLACE}`
// Where it is installed from: the page the person gives Claude.
const PLUGIN_PAGE = 'https://github.com/hannahindielab/desktop-cat'

// The first try waits a minute, as the look for a new desktop cat does: just
// after the computer starts, the network may not be up yet. A try that fails
// is made once more an hour later, before the person is asked.
const TIMES = { firstTryAfterMs: 60 * 1000, tryAgainAfterMs: 60 * 60 * 1000 }
const TRIES = 2
// Refreshing the marketplace copies it from GitHub anew.
const LIST_TIMEOUT_MS = 60 * 1000
const UPDATE_TIMEOUT_MS = 3 * 60 * 1000

const isFile = file => {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

const folders = dir => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch {
    return []
  }
}

/**
 * Every Claude Code on this computer, the likeliest first: the Claude desktop
 * app's own copies, newest first (its Code tab runs these); then the one a
 * terminal finds on the PATH; then where Claude Code's installer puts it.
 * All of them share the person's plugins, in ~/.claude.
 */
function findClaudeCodes({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const windows = platform === 'win32'
  const found = []

  if (windows) {
    const data = path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Claude-Data')
    const copies = []

    for (const account of folders(data)) {
      const versions = path.join(data, account, 'claude-code')

      for (const version of folders(versions)) {
        for (const build of folders(path.join(versions, version))) {
          const file = path.join(versions, version, build, 'claude.exe')

          if (isFile(file)) {
            copies.push({ file, version })
          }
        }
      }
    }

    copies.sort((a, b) => (isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0))
    found.push(...copies.map(copy => copy.file))
  }

  const names = windows ? ['claude.exe', 'claude.cmd'] : ['claude']

  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      found.push(path.join(dir, name))
    }
  }

  found.push(path.join(home, '.local', 'bin', windows ? 'claude.exe' : 'claude'))

  const seen = new Set()

  return found.filter(file => {
    const key = windows ? file.toLowerCase() : file

    if (seen.has(key) || !isFile(file)) {
      return false
    }

    seen.add(key)
    return true
  })
}

/** Runs one Claude Code command, hidden, and answers with how it ended and
    what it printed. Never rejects: a Claude Code that can't run ends with a
    code that isn't 0. */
function runClaudeCode(file, args, timeout = UPDATE_TIMEOUT_MS) {
  // A Claude Code installed with npm is a .cmd, which only cmd.exe can run.
  // The arguments are this file's own, with nothing in them to escape.
  const viaCmd = /\.cmd$/i.test(file)
  const [command, commandArgs, options] = viaCmd
    ? ['cmd.exe', ['/d', '/s', '/c', `""${file}" ${args.join(' ')}"`], { windowsVerbatimArguments: true }]
    : [file, args, {}]

  return new Promise(resolve => {
    childProcess.execFile(
      command,
      commandArgs,
      { ...options, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        const code = error === null ? 0 : Number.isInteger(error.code) ? error.code : -1
        resolve({ code, stdout: String(stdout ?? '') })
      },
    )
  })
}

// Kept on an object so the tests can stand in for Claude Code.
const claudeCode = { find: findClaudeCodes, run: runClaudeCode }

/** The Claude cat as one Claude Code lists it: { version, scope }; null when
    it isn't installed under its public name; undefined when that Claude Code
    couldn't say. */
async function listedClaudeCat(run, file) {
  const { code, stdout } = await run(file, ['plugin', 'list', '--json'], LIST_TIMEOUT_MS)

  if (code !== 0) {
    return undefined
  }

  let plugins

  try {
    plugins = JSON.parse(stdout.slice(stdout.indexOf('[')))
  } catch {
    return undefined
  }

  if (!Array.isArray(plugins)) {
    return undefined
  }

  const plugin = plugins.find(entry => entry?.id === PLUGIN_ID)

  return plugin === undefined || typeof plugin.version !== 'string'
    ? null
    : { version: plugin.version, scope: typeof plugin.scope === 'string' ? plugin.scope : 'user' }
}

/**
 * Brings the Claude cat up to the paired version, if it is older. Answers:
 * 'current' (it was already), 'updated', 'failed' (older, and still older
 * after trying), or 'unknown' (no Claude Code could say, or it isn't installed
 * under its public name): then only the conversations' reports can tell.
 */
async function bringUpToDate({ find, run }, paired = PAIRED_CLAUDE_CAT) {
  for (const file of find()) {
    const before = await listedClaudeCat(run, file)

    if (before === undefined) {
      // This one can't say: perhaps too old to have plugins. The next may.
      continue
    }

    if (before === null) {
      return 'unknown'
    }

    if (!isNewer(paired, before.version)) {
      return 'current'
    }

    // Each step's outcome is read from the version installed at the end.
    await run(file, ['plugin', 'marketplace', 'update', MARKETPLACE])
    await run(file, ['plugin', 'update', PLUGIN_ID, '--scope', before.scope])
    const after = await listedClaudeCat(run, file)

    return after?.version !== undefined && !isNewer(paired, after.version) ? 'updated' : 'failed'
  }

  return 'unknown'
}

/** Whether a conversation going on now runs a Claude cat older than the
    paired one. One that can't tell its version (null) says nothing. */
const needsNewerClaudeCat = (sessions, now, activeForMs, paired = PAIRED_CLAUDE_CAT) =>
  sessions.some(
    session =>
      now - session.updatedAt < activeForMs &&
      typeof session.pluginVersion === 'string' &&
      isNewer(paired, session.pluginVersion),
  )

/**
 * Keeps the Claude cat up to date with this desktop cat, once for each paired
 * version: a minute after the start, and once more an hour later if that
 * failed. `store` keeps the paired version already seen to (brought up to
 * date, or the person asked), so a restart doesn't try again. `remind` asks
 * the person to have Claude update it.
 *
 * Returns `reportsSay(sessions, now)`, for the conversations' reports: they
 * decide only when no Claude Code could say.
 */
function careForClaudeCat({ store, remind, paired = PAIRED_CLAUDE_CAT, later = setTimeout, activeForMs }) {
  let outcome = 'waiting'
  let tries = 0
  // One window at a time: the reports come in every few seconds.
  let isAsking = false

  const isSeenTo = () => store.get() === paired
  const seenTo = () => store.set(paired)

  async function attempt() {
    if (isSeenTo()) {
      return
    }

    tries += 1
    outcome = await bringUpToDate(claudeCode, paired).catch(() => 'failed')

    if (outcome === 'current' || outcome === 'updated') {
      seenTo()
    } else if (outcome === 'failed') {
      if (tries < TRIES) {
        later(attempt, TIMES.tryAgainAfterMs)
      } else {
        void ask()
      }
    }
  }

  /** Asks the person, once for each paired version, however they answer.
      `remind` answers false when it couldn't ask just now (a new desktop cat
      on its way down, say): then nothing is kept, and a later start asks. */
  async function ask() {
    if (isAsking || isSeenTo()) {
      return
    }

    isAsking = true

    try {
      if (await remind()) {
        seenTo()
      }
    } catch {
      // The window failed to open: a later start asks again.
    } finally {
      isAsking = false
    }
  }

  later(attempt, TIMES.firstTryAfterMs)

  return {
    reportsSay(sessions, now) {
      if (outcome === 'unknown' && !isSeenTo() && needsNewerClaudeCat(sessions, now, activeForMs, paired)) {
        void ask()
      }
    },
  }
}

module.exports = {
  MARKETPLACE,
  PAIRED_CLAUDE_CAT,
  PLUGIN_ID,
  PLUGIN_PAGE,
  TIMES,
  TRIES,
  bringUpToDate,
  careForClaudeCat,
  claudeCode,
  findClaudeCodes,
  listedClaudeCat,
  needsNewerClaudeCat,
  runClaudeCode,
}
