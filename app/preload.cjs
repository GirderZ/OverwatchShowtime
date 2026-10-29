const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('playtime', {
  getState: input => ipcRenderer.invoke('playtime:state', input),
  command: (name, input) => ipcRenderer.invoke('playtime:command', name, input),
  onChange: callback => { const listener = () => callback(); ipcRenderer.on('playtime:changed', listener); return () => ipcRenderer.removeListener('playtime:changed', listener); }
});
