// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  updatePlugins: (data) => ipcRenderer.invoke('update-plugins', data),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (_, data) => callback(data)),
});
