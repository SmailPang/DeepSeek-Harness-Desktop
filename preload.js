const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__dshShell', {
  requestRestart: () => ipcRenderer.send('dsh:request-restart'),
  retryBoot: () => ipcRenderer.send('dsh:retry-boot'),
  quit: () => ipcRenderer.send('dsh:quit')
});
