'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const BACKEND_PORT = 8765;
const IS_DEV = process.argv.includes('--dev');
const ROOT_DIR = path.join(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const SETTINGS_PATH = path.join(ASSETS_DIR, 'settings.json');

let mainWindow = null;
let pythonProcess = null;

// ─── Python Backend ──────────────────────────────────────────────────────────

function startPythonBackend() {
  const backendDir = path.join(ROOT_DIR, 'backend');
  
  let cmd;
  let args = [];
  let cwd = backendDir;

  if (app.isPackaged) {
    console.log('[Electron] Starting Python backend (Production mode)…');
    // In production, the executable is placed in resources/backend/
    const ext = process.platform === 'win32' ? '.exe' : '';
    cmd = path.join(process.resourcesPath, 'backend', 'solar_backend' + ext);
    cwd = path.join(process.resourcesPath, 'backend');
  } else {
    console.log('[Electron] Starting Python backend (Dev mode)…');
    cmd = process.platform === 'win32' ? 'python' : 'python3';
    args = ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)];
  }

  pythonProcess = spawn(cmd, args, {
    cwd: cwd,
    stdio: IS_DEV ? 'inherit' : 'pipe',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  pythonProcess.on('error', (err) => {
    console.error('[Python] Failed to start:', err.message);
  });

  pythonProcess.on('exit', (code) => {
    console.log(`[Python] Exited with code ${code}`);
  });
}

function waitForBackend(retries = 30, delay = 500) {
  return new Promise((resolve, reject) => {
    function attempt(n) {
      const req = http.get(`http://127.0.0.1:${BACKEND_PORT}/health`, (res) => {
        if (res.statusCode === 200) {
          console.log('[Electron] Backend ready!');
          resolve();
        } else {
          retry(n);
        }
      });
      req.on('error', () => retry(n));
      req.setTimeout(400, () => { req.destroy(); retry(n); });
    }

    function retry(n) {
      if (n <= 0) {
        reject(new Error('Backend did not start in time'));
        return;
      }
      setTimeout(() => attempt(n - 1), delay);
    }

    attempt(retries);
  });
}

// ─── Window ──────────────────────────────────────────────────────────────────

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // needed for local tile fetching
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Load splash first, then wait for backend
  await mainWindow.loadFile(path.join(FRONTEND_DIR, 'index.html'));

  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Try to start backend and notify renderer when ready
  try {
    await waitForBackend(40, 500);
    mainWindow.webContents.send('backend-ready');
  } catch (e) {
    console.error('[Electron] Backend timeout:', e.message);
    mainWindow.webContents.send('backend-error', e.message);
  }
}

// ─── Application Menu ─────────────────────────────────────────────────────────

function buildMenu() {
  const template = [
    {
      label: 'Solar Scanner',
      submenu: [
        { label: 'À propos', role: 'about' },
        { type: 'separator' },
        { label: 'Quitter', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: 'Édition',
      submenu: [
        { label: 'Annuler', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Copier', accelerator: 'CmdOrCtrl+C', role: 'copy' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Actualiser', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { type: 'separator' },
        { label: 'Plein écran', accelerator: 'F11', role: 'togglefullscreen' },
        IS_DEV ? { label: 'DevTools', accelerator: 'F12', role: 'toggleDevTools' } : null,
      ].filter(Boolean),
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'Documentation IGN',
          click: () => shell.openExternal('https://geoservices.ign.fr/services-geoplateforme'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

/** Read settings.json */
ipcMain.handle('get-settings', () => {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch {
    return {};
  }
});

/** Write settings.json */
ipcMain.handle('save-settings', (_, settings) => {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  return { ok: true };
});

/** Export GeoJSON */
ipcMain.handle('export-geojson', async (_, geojson) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `solar_detections_${Date.now()}.geojson`,
    filters: [{ name: 'GeoJSON', extensions: ['geojson'] }],
  });
  if (!filePath) return { ok: false, reason: 'cancelled' };
  fs.writeFileSync(filePath, JSON.stringify(geojson, null, 2), 'utf-8');
  return { ok: true, filePath };
});

/** Export CSV */
ipcMain.handle('export-csv', async (_, rows) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `solar_detections_${Date.now()}.csv`,
    filters: [{ name: 'Fichiers CSV', extensions: ['csv'] }],
  });
  if (!filePath) return { ok: false, reason: 'cancelled' };

  // En France, Excel utilise le point-virgule comme séparateur CSV
  const header = 'Numéro;Latitude;Longitude;Surface (m²);Confiance IA (%);Prix HT (€);Temps Estimé (min)\n';
  const body = rows.map((r, i) => {
    const id = `PAN-${String(i + 1).padStart(4, '0')}`;
    // Remplacer les points par des virgules pour Excel FR
    const lat = r.lat.toFixed(6).replace('.', ',');
    const lng = r.lng.toFixed(6).replace('.', ',');
    const area = r.area_m2.toFixed(1).replace('.', ',');
    const conf = (r.confidence * 100).toFixed(0);
    const price = r.price_eur.toFixed(2).replace('.', ',');
    const time = r.cleaning_min.toFixed(0);
    
    return `${id};${lat};${lng};${area};${conf};${price};${time}`;
  }).join('\n');
  
  // UTF-8 avec BOM pour forcer Excel à lire correctement les accents (m²)
  const BOM = '\uFEFF';
  fs.writeFileSync(filePath, BOM + header + body, 'utf-8');
  return { ok: true, filePath };
});

/** Export PDF via printToPDF */
ipcMain.handle('export-pdf', async (_, htmlContent) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `rapport_panneaux_${Date.now()}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!filePath) return { ok: false, reason: 'cancelled' };

  try {
    const pdfWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    const tempPath = path.join(app.getPath('temp'), `pdf_temp_${Date.now()}.html`);
    fs.writeFileSync(tempPath, htmlContent, 'utf-8');

    await pdfWin.loadFile(tempPath);
    
    // Attendre un peu que les images base64 soient bien rendues
    await new Promise(r => setTimeout(r, 500));

    const pdfData = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: false,
    });
    
    pdfWin.close();
    
    fs.writeFileSync(filePath, Buffer.from(pdfData));
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); // Clean up
    
    // Open the PDF folder after saving to help the user find it
    shell.showItemInFolder(filePath);
    
    return { ok: true, filePath };
  } catch (err) {
    console.error("PDF Export error:", err);
    dialog.showErrorBox("Erreur PDF", "Impossible de créer le PDF : " + err.message);
    return { ok: false, reason: err.message };
  }
});

/** Capture a rect of the main window */
ipcMain.handle('capture-rect', async (_, rect) => {
  if (!mainWindow) return null;
  // rect should be { x, y, width, height }
  try {
    const nativeImage = await mainWindow.webContents.capturePage(rect);
    return nativeImage.toDataURL(); // Returns 'data:image/png;base64,...'
  } catch (err) {
    console.error('Error capturing rect:', err);
    return null;
  }
});

/** Clear tile cache */
ipcMain.handle('clear-cache', async () => {
  const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/cache/clear`, { method: 'DELETE' });
  return res.ok ? { ok: true } : { ok: false };
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  buildMenu();
  startPythonBackend();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
    console.log('[Electron] Python backend killed');
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (pythonProcess) pythonProcess.kill();
});
