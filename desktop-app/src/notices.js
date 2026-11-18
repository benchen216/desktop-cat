// The desktop cat's own windows that tell the person something and ask what
// to do (notice.html): a new version of the cat, or a Claude cat to update.
// In the appearance window's paper and ink, with the website's big face,
// where Windows' own message window could show neither, nor words in red.
// What Windows' window did by itself, these do too: Enter presses the main
// button, Esc or closing the window is the cancel answer, and the window
// comes up in the middle of the screen, in front.

const { BrowserWindow, clipboard, ipcMain, nativeTheme, screen } = require('electron')
const path = require('node:path')

const WIDTH = 440
// Shown a moment after it paints, if the page never says how tall it is.
const FIT_WAIT_MS = 1000

// The one open now: { win, page, finish }.
let open = null
// One at a time: a second waits until the first is closed.
let queue = Promise.resolve()

const fromNotice = handler => (event, ...args) =>
  open !== null && !open.win.isDestroyed() && event.sender === open.win.webContents ? handler(...args) : undefined

/** Listens to the notice windows. Once, at the start. */
function connectNotices() {
  ipcMain.handle('notice:get', fromNotice(() => open.page))
  ipcMain.on('notice:fit', fromNotice(fit))
  ipcMain.on('notice:answer', fromNotice(id => open.finish(id)))
  // Copies the page's link, without closing the window. Answers whether it
  // was copied: the clipboard answers later, and may refuse.
  ipcMain.handle(
    'notice:copy',
    fromNotice(async () => {
      if (typeof open.page.link !== 'string') {
        return false
      }

      try {
        await clipboard.writeText(open.page.link)
        return true
      } catch {
        return false
      }
    }),
  )
}

/** Fits the window to its page, in the middle of its screen, then shows it. */
function fit(height) {
  const { win } = open

  if (typeof height === 'number' && Number.isFinite(height)) {
    const { height: screenHeight } = screen.getDisplayMatching(win.getBounds()).workArea
    win.setContentSize(WIDTH, Math.min(Math.max(Math.ceil(height), 200), screenHeight - 60))
  }

  win.center()

  if (!win.isVisible()) {
    win.show()
  }
}

/**
 * Shows a notice and answers with the id of the button pressed, or the page's
 * `cancel` when the window is closed. `page` holds what it shows, in the
 * person's words (see notice.js). `stillWanted`, asked just before it opens,
 * can call it off after waiting for another: it then answers null.
 */
function showNotice(page, { stillWanted = () => true } = {}) {
  const shown = queue.then(() => (stillWanted() ? openNotice(page) : null))
  queue = shown.catch(() => {})

  return shown
}

function openNotice(page) {
  return new Promise(resolve => {
    const win = new BrowserWindow({
      // Fitted to its page once that is laid out: this only starts it.
      width: WIDTH,
      height: 400,
      useContentSize: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: page.windowTitle,
      show: false,
      // The page's own paper, so the window never flashes white at night.
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#34302E' : '#FFFDF8',
      webPreferences: {
        preload: path.join(__dirname, 'notice-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    // The answers a button can give; copying is not one, it keeps the window.
    const answers = new Set([page.cancel, ...page.buttons.map(button => button.id).filter(id => id !== 'copy')])
    let isAnswered = false

    const finish = id => {
      if (isAnswered) {
        return
      }

      isAnswered = true
      resolve(answers.has(id) ? id : page.cancel)

      if (!win.isDestroyed()) {
        win.destroy()
      }
    }

    open = { win, page, finish }
    win.setMenu(null)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.once('ready-to-show', () =>
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) {
          win.center()
          win.show()
        }
      }, FIT_WAIT_MS),
    )
    win.on('closed', () => {
      if (open?.win === win) {
        open = null
      }

      finish(page.cancel)
    })
    win.loadFile(path.join(__dirname, 'notice.html')).catch(() => finish(page.cancel))
  })
}

/** The notice open now, for the self-test: its window and what it shows. */
const openNow = () => (open === null || open.win.isDestroyed() ? null : { win: open.win, page: open.page })

module.exports = { WIDTH, connectNotices, openNow, showNotice }
