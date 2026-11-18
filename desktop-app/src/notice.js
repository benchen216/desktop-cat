// A window that tells the person something and asks what to do: a new
// version of the cat, or a Claude cat to update. The main program sends what
// to show, in the person's words, and hears the button pressed. Everything is
// set as text: release notes come from the network.
const band = document.getElementById('band')
const main = document.getElementById('main')
const footer = document.getElementById('buttons')

// How long "Copied" shows before the button says "Copy link" again.
const COPIED_FOR_MS = 2000

/** The website's big face: the cat waiting, without its tail, standing still. */
function faceOf(source) {
  const drawing = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement

  drawing.querySelector('mask#sitting-tail')?.parentElement.remove()
  drawing.querySelectorAll('animate, animateTransform, animateMotion, set').forEach(moving => moving.remove())

  return document.adoptNode(drawing)
}

function element(tag, className, text) {
  const made = document.createElement(tag)

  if (className) {
    made.className = className
  }

  if (text !== undefined) {
    made.textContent = text
  }

  return made
}

function show(notice) {
  document.title = notice.windowTitle
  document.documentElement.lang = notice.language
  const poses = window.POSES[notice.coat] ?? window.POSES.calico
  band.append(faceOf(poses.waiting))

  main.append(element('h1', '', notice.title))

  if (notice.notes?.length > 0) {
    const list = element('ul')
    list.append(...notice.notes.map(note => element('li', '', note)))
    main.append(list)
  }

  for (const line of notice.lines ?? []) {
    main.append(element('p', '', line))
  }

  if (notice.link) {
    main.append(element('div', 'link', notice.link))
  }

  if (notice.hint) {
    main.append(element('p', 'hint', notice.hint))
  }

  if (notice.warning) {
    main.append(element('p', 'warn', notice.warning))
  }

  if (notice.versions) {
    main.append(element('p', 'versions', notice.versions))
  }

  let mainButton = null

  for (const button of notice.buttons) {
    const made = element('button', button.look, button.label)
    made.type = 'button'
    made.dataset.answer = button.id

    if (button.id === 'copy') {
      made.addEventListener('click', async () => {
        if (await window.notice.copy()) {
          made.textContent = button.done
          setTimeout(() => {
            made.textContent = button.label
          }, COPIED_FOR_MS)
        }
      })
    } else {
      made.addEventListener('click', () => window.notice.answer(button.id))
    }

    footer.append(made)

    // The quiet one sits apart on the left; the rest together on the right.
    if (button.look === 'quiet') {
      footer.append(element('span', 'grow'))
    }

    if (button.look === 'main') {
      mainButton = made
    }
  }

  if (footer.querySelector('.grow') === null) {
    footer.prepend(element('span', 'grow'))
  }

  // Enter presses the main button, as in Windows' own windows; Esc is the
  // same as closing the window.
  mainButton?.focus()
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') {
      document.body.classList.add('keys')
    }

    if (event.key === 'Escape') {
      window.notice.answer(notice.cancel)
    } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      mainButton?.click()
    }
  })
}

async function start() {
  show(await window.notice.get())
  window.notice.fit(document.documentElement.getBoundingClientRect().height)
}

start()
