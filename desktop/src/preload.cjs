// Runs before each page, in an isolated world; pages get nothing from Node.
// The app's own screens (setup, unreachable: file:// pages) get the setup calls.
// The main process checks the sender again, so a page can't fake its way in.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('staveSetup', {
    getServer: () => ipcRenderer.invoke('stave:get-server'),
    checkServer: (address) => ipcRenderer.invoke('stave:check-server', address),
    useServer: (address) => ipcRenderer.invoke('stave:use-server', address),
    retry: () => ipcRenderer.invoke('stave:retry'),
    changeServer: () => ipcRenderer.invoke('stave:change-server'),
  });
}
