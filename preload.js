const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__dshShell', {
  requestRestart: () => ipcRenderer.send('dsh:request-restart'),
  getDesktopInfo: () => ipcRenderer.invoke('dsh:get-desktop-info'),
  checkUpdates: (scope) => ipcRenderer.invoke('dsh:check-updates', scope),
  checkStartupUpdates: () => ipcRenderer.invoke('dsh:check-startup-updates'),
  getUpdatePreferences: () => ipcRenderer.invoke('dsh:get-update-preferences'),
  setUpdatePreferences: (values) => ipcRenderer.invoke('dsh:set-update-preferences', values),
  updateDsh: () => ipcRenderer.invoke('dsh:update-dsh'),
  openUpdatePage: (target) => ipcRenderer.send('dsh:open-update-page', target),
  retryBoot: () => ipcRenderer.send('dsh:retry-boot'),
  quit: () => ipcRenderer.send('dsh:quit')
});
