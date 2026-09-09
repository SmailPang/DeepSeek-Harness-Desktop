const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__dshShell', {
  requestRestart: () => ipcRenderer.send('dsh:request-restart')
});
