const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('AmongDemonsRuntime', {
  platform: 'steam',
  isElectron: true
});
