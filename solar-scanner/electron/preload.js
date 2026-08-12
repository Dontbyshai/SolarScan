'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('solarAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Exports
  exportGeoJSON: (geojson) => ipcRenderer.invoke('export-geojson', geojson),
  exportCSV: (rows) => ipcRenderer.invoke('export-csv', rows),
  exportPDF: (html) => ipcRenderer.invoke('export-pdf', html),
  captureRect: (rect) => ipcRenderer.invoke('capture-rect', rect),

  // Cache
  clearCache: () => ipcRenderer.invoke('clear-cache'),

  // Backend events from main process
  onBackendReady: (cb) => ipcRenderer.on('backend-ready', cb),
  onBackendError: (cb) => ipcRenderer.on('backend-error', (_, msg) => cb(msg)),
});
