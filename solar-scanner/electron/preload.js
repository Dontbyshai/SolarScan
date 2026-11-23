'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('solarAPI', {
  // Jeton du moteur local (jamais écrit dans un fichier)
  getToken: () => ipcRenderer.invoke('get-api-token'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Projets et historique
  saveProject: (project) => ipcRenderer.invoke('save-project', project),
  openProject: () => ipcRenderer.invoke('open-project'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  appendHistory: (entry) => ipcRenderer.invoke('append-history', entry),
  exportHistoryCSV: () => ipcRenderer.invoke('export-history-csv'),

  // Exports
  exportGeoJSON: (geojson) => ipcRenderer.invoke('export-geojson', geojson),
  exportCSV: (rows) => ipcRenderer.invoke('export-csv', rows),
  exportPDF: (html, suggestedName) => ipcRenderer.invoke('export-pdf', html, suggestedName),
  captureRect: (rect) => ipcRenderer.invoke('capture-rect', rect),
  logError: (message, detail) => ipcRenderer.invoke('log-error', message, detail),
  openHistoryFile: (filePath) => ipcRenderer.invoke('open-history-file', filePath),
  reexportHistoryFile: (filePath) => ipcRenderer.invoke('reexport-history-file', filePath),

  // Cache
  clearCache: () => ipcRenderer.invoke('clear-cache'),

  // Backend events from main process
  onBackendReady: (cb) => ipcRenderer.on('backend-ready', cb),
  onBackendError: (cb) => ipcRenderer.on('backend-error', (_, msg) => cb(msg)),
});
