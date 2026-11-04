// What the desktop app adds to the page (window.reelStudio, see src/api.ts `desktop`): a native folder picker
// for the welcome page. A browser on another machine doesn't get it and types the path instead.
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('reelStudio', {
  pickFolder: (defaultPath) => ipcRenderer.invoke('pick-folder', defaultPath),
});
