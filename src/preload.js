// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  engineUpdate: (data) => ipcRenderer.invoke('engine-update', data),
  updatePluginSources: (data) => ipcRenderer.invoke('update-plugins', data),
  createPatches: (data) => ipcRenderer.invoke('create-patches', data),
  testPluginOutput: (data) => ipcRenderer.invoke('test-plugin-output', data),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (_, data) => callback(data)),
});
