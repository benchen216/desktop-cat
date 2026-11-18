const { contextBridge, ipcRenderer } = require('electron')

// A window that tells the person something and asks what to do: what it
// shows comes from the main program, which hears the button pressed.
contextBridge.exposeInMainWorld('notice', {
  get: () => ipcRenderer.invoke('notice:get'),
  // How tall the page is once laid out, so the window fits it.
  fit: height => ipcRenderer.send('notice:fit', height),
  answer: id => ipcRenderer.send('notice:answer', id),
  copy: () => ipcRenderer.invoke('notice:copy'),
})
