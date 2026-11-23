'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const http = require('http');

const BACKEND_PORT = 8765;
const IS_DEV = process.argv.includes('--dev');
const ROOT_DIR = path.join(__dirname, '..');
const API_TOKEN = crypto.randomBytes(32).toString('hex');
const MAX_SETTINGS_BYTES = 2_500_000;
const MAX_PROJECT_BYTES = 8_000_000;
const HISTORY_LIMIT = 200;
// Un capture Rétina + logo base64 (parfois doublé) dépasse facilement 6 Mo.
// L'ancienne limite rejetait le 2e devis sans rien écrire dans les journaux.
const MAX_PDF_HTML_CHARS = 40_000_000;

// Même nom que le repli Python (paths.py) : le dossier reste stable.
app.setName('SolarScan');

// Schéma local pour le logo : avec webSecurity, un fichier file:// ne peut
// pas lire le dossier assets/ qui est au-dessus de l'interface.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'solarscan',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

let mainWindow = null;
let pythonProcess = null;

function assetsDir() {
  const candidates = [
    path.join(ROOT_DIR, 'assets'),
    process.resourcesPath ? path.join(process.resourcesPath, 'assets') : '',
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(dir)) || candidates[0];
}

function frontendDir() {
  const candidates = [
    path.join(ROOT_DIR, 'frontend'),
    process.resourcesPath ? path.join(process.resourcesPath, 'frontend') : '',
    path.join(__dirname, 'frontend'),
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) || candidates[0];
}

function interfaceErrorHtml(message) {
  const safe = String(message || 'Fichier introuvable')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>SolarScan — interface introuvable</title>
  <style>
    body { margin: 0; background: #0d1117; color: #e6edf3; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    main { max-width: 520px; padding: 32px; }
    h1 { font-size: 22px; margin: 0 0 12px; }
    p { line-height: 1.5; color: #9ba3af; }
    code { display: block; margin-top: 16px; padding: 12px; background: #161b22; border-radius: 8px; color: #f0883e; word-break: break-all; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>Impossible d'ouvrir l'interface</h1>
    <p>SolarScan a démarré, mais la page de l'application est introuvable. Réinstallez l'application, puis relancez-la. Si le problème continue, contactez l'éditeur.</p>
    <code>${safe}</code>
  </main>
</body>
</html>`;
}

async function showInterfaceError(win, message) {
  console.error("[Electron] Chargement de l'interface :", message);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(interfaceErrorHtml(message)));
  if (!win.isVisible()) win.show();
}

async function loadInterface(win) {
  const indexPath = path.join(frontendDir(), 'index.html');
  if (!fs.existsSync(indexPath)) {
    await showInterfaceError(win, 'Interface introuvable : ' + indexPath);
    return;
  }
  try {
    await win.loadFile(indexPath);
  } catch (err) {
    await showInterfaceError(win, err.message);
  }
}

function userDataDir() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function settingsPath() {
  return path.join(userDataDir(), 'settings.json');
}

function historyPath() {
  return path.join(userDataDir(), 'historique.json');
}

function electronLogPath() {
  return path.join(userDataDir(), 'electron.log');
}

function electronLog(level, message, extra) {
  const suffix = extra !== undefined && extra !== '' ? ' ' + String(extra) : '';
  const line = new Date().toISOString() + ' [' + level + '] ' + String(message) + suffix + '\n';
  if (level === 'ERROR') console.error(String(message), extra !== undefined ? extra : '');
  else console.log(String(message), extra !== undefined ? extra : '');
  try {
    fs.appendFileSync(electronLogPath(), line, 'utf-8');
  } catch (err) {
    console.error('Impossible d\'écrire electron.log :', err.message);
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

/** Première ouverture : on récupère d'anciens réglages, sinon le modèle vierge. */
function ensureSettingsFile() {
  const dest = settingsPath();
  if (fs.existsSync(dest)) return;

  const legacy = path.join(assetsDir(), 'settings.json');
  const defaults = path.join(assetsDir(), 'settings.default.json');
  if (fs.existsSync(legacy)) {
    fs.copyFileSync(legacy, dest);
  } else if (fs.existsSync(defaults)) {
    fs.copyFileSync(defaults, dest);
  }
}

// ─── Python Backend ──────────────────────────────────────────────────────────

function backendEnv() {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    SOLARSCAN_DATA_DIR: userDataDir(),
    SOLARSCAN_TOKEN: API_TOKEN,
    SOLARSCAN_PORT: String(BACKEND_PORT),
  };
}

function isPortOpen() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const req = http.get(
      { host: '127.0.0.1', port: BACKEND_PORT, path: '/health', agent: false, timeout: 1500 },
      (res) => {
        res.resume();
        res.on('end', () => req.destroy());
        done(res.statusCode === 200);
      }
    );
    req.on('error', () => done(false));
    req.on('timeout', () => { req.destroy(); done(false); });
  });
}

function startPythonBackend() {
  const backendDir = path.join(ROOT_DIR, 'backend');

  let cmd;
  let args = [];
  let cwd = backendDir;

  if (app.isPackaged) {
    console.log('[Electron] Démarrage du moteur Python (installé)…');
    const ext = process.platform === 'win32' ? '.exe' : '';
    cmd = path.join(process.resourcesPath, 'backend', 'solar_backend' + ext);
    cwd = path.join(process.resourcesPath, 'backend');
  } else {
    console.log('[Electron] Démarrage du moteur Python (développement)…');
    cmd = process.platform === 'win32' ? 'python' : 'python3';
    args = ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)];
  }

  pythonProcess = spawn(cmd, args, {
    cwd,
    stdio: IS_DEV ? 'inherit' : 'pipe',
    env: backendEnv(),
  });

  pythonProcess.on('error', (err) => {
    console.error('[Python] Échec du démarrage :', err.message);
  });

  pythonProcess.on('exit', (code) => {
    console.log(`[Python] Arrêt (code ${code})`);
    pythonProcess = null;
  });
}

function waitForBackend(retries = 240, delay = 500) {
  return new Promise((resolve, reject) => {
    let finished = false;

    function attempt(n) {
      if (finished) return;
      let settled = false; // une seule issue par tentative (évite les boucles en double)
      const done = (ok) => {
        if (settled || finished) return;
        settled = true;
        if (ok) {
          finished = true;
          console.log('[Electron] Moteur prêt.');
          resolve();
        } else {
          retry(n);
        }
      };
      const req = http.get(
        { host: '127.0.0.1', port: BACKEND_PORT, path: '/health', agent: false, timeout: 3000 },
        (res) => {
          res.resume();
          res.on('end', () => req.destroy());
          done(res.statusCode === 200);
        }
      );
      req.on('error', () => done(false));
      req.on('timeout', () => { req.destroy(); done(false); });
    }

    function retry(n) {
      if (finished) return;
      if (n <= 0) {
        finished = true;
        reject(new Error('Le moteur n\'a pas démarré à temps'));
        return;
      }
      setTimeout(() => attempt(n - 1), delay);
    }

    attempt(retries);
  });
}

function stopPythonBackend() {
  if (!pythonProcess) return;
  const child = pythonProcess;
  pythonProcess = null;
  try {
    const req = http.request({
      host: '127.0.0.1',
      port: BACKEND_PORT,
      path: '/shutdown',
      method: 'POST',
      headers: { 'X-SolarScan-Token': API_TOKEN },
    });
    req.on('error', () => child.kill());
    req.end();
  } catch {
    child.kill();
  }
  setTimeout(() => {
    if (!child.killed) child.kill();
  }, 800);
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
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://www.google.com/maps/') || url.startsWith('https://maps.google.com/')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('data:')) event.preventDefault();
  });

  mainWindow.webContents.on('did-fail-load', async (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (String(validatedURL || '').startsWith('data:')) return;
    await showInterfaceError(mainWindow, `${errorDescription} (${validatedURL})`);
  });

  await loadInterface(mainWindow);

  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });

  try {
    // Premier lancement du moteur one-file : l'extraction peut dépasser 60 s.
    await waitForBackend(240, 500);
    mainWindow.webContents.send('backend-ready');
  } catch (err) {
    console.error('[Electron] Délai dépassé :', err.message);
    mainWindow.webContents.send('backend-error', err.message);
  }
}

// ─── Application Menu ─────────────────────────────────────────────────────────

function buildMenu() {
  const template = [
    {
      label: 'SolarScan',
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

ipcMain.handle('get-api-token', () => API_TOKEN);

ipcMain.handle('get-settings', () => {
  ensureSettingsFile();
  const saved = readJson(settingsPath(), {});
  return saved && typeof saved === 'object' ? saved : {};
});

ipcMain.handle('save-settings', (_, settings) => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ok: false, reason: 'Réglages invalides' };
  }
  const payload = JSON.stringify(settings, null, 2);
  if (Buffer.byteLength(payload, 'utf-8') > MAX_SETTINGS_BYTES) {
    return { ok: false, reason: 'Réglages trop volumineux (logo trop lourd)' };
  }
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(settingsPath(), payload, 'utf-8');
  return { ok: true };
});

ipcMain.handle('save-project', async (_, project) => {
  if (!project || typeof project !== 'object') {
    return { ok: false, reason: 'Projet invalide' };
  }
  const payload = JSON.stringify(project, null, 2);
  if (Buffer.byteLength(payload, 'utf-8') > MAX_PROJECT_BYTES) {
    return { ok: false, reason: 'Projet trop volumineux' };
  }
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `chantier_${Date.now()}.solar`,
    filters: [{ name: 'Projet SolarScan', extensions: ['solar'] }],
  });
  if (!filePath) return { ok: false, reason: 'cancelled' };
  fs.writeFileSync(filePath, payload, 'utf-8');
  return { ok: true, filePath };
});

ipcMain.handle('open-project', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Projet SolarScan', extensions: ['solar', 'json'] }],
  });
  if (!filePaths || !filePaths.length) return { ok: false, reason: 'cancelled' };
  const filePath = filePaths[0];
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_PROJECT_BYTES) return { ok: false, reason: 'Fichier trop volumineux' };
  const data = readJson(filePath, null);
  if (!data || !Array.isArray(data.detections)) return { ok: false, reason: 'Fichier invalide' };
  return { ok: true, data };
});

function readHistory() {
  const data = readJson(historyPath(), []);
  return Array.isArray(data) ? data : [];
}

ipcMain.handle('get-history', () => readHistory());

ipcMain.handle('append-history', (_, entry) => {
  if (!entry || typeof entry !== 'object') return { ok: false };
  const text = (value, max) => String(value ?? '').slice(0, max);
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const item = {
    id: text(entry.id || Date.now(), 40),
    date: text(entry.date || new Date().toISOString(), 40),
    numero: text(entry.numero, 32),
    client: text(entry.client, 200),
    adresse: text(entry.adresse, 300),
    panneaux: num(entry.panneaux),
    surface_m2: num(entry.surface_m2),
    prix_ht: num(entry.prix_ht),
    prix_ttc: num(entry.prix_ttc),
    fichier: text(entry.fichier, 500),
  };
  const history = readHistory();
  history.unshift(item);
  fs.writeFileSync(historyPath(), JSON.stringify(history.slice(0, HISTORY_LIMIT), null, 2), 'utf-8');
  return { ok: true };
});

ipcMain.handle('export-history-csv', async () => {
  const rows = readHistory();
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `historique_devis_${Date.now()}.csv`,
    filters: [{ name: 'Fichiers CSV', extensions: ['csv'] }],
  });
  if (!filePath) return { ok: false, reason: 'cancelled' };

  const cell = (value) => String(value ?? '').replace(/;/g, ',').replace(/\r?\n/g, ' ');
  const fr = (value, digits) => Number(value || 0).toFixed(digits).replace('.', ',');
  const header = 'Date;Numéro;Client;Adresse;Panneaux;Surface (m²);Prix HT (€);Prix TTC (€)\n';
  const body = rows.map((row) => [
    cell(row.date),
    cell(row.numero),
    cell(row.client),
    cell(row.adresse),
    String(row.panneaux ?? 0),
    fr(row.surface_m2, 1),
    fr(row.prix_ht, 2),
    fr(row.prix_ttc, 2),
  ].join(';')).join('\n');
  fs.writeFileSync(filePath, `\uFEFF${header}${body}`, 'utf-8');
  shell.showItemInFolder(filePath);
  return { ok: true, filePath };
});

ipcMain.handle('export-geojson', async (_, geojson) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `solar_detections_${Date.now()}.geojson`,
    filters: [{ name: 'GeoJSON', extensions: ['geojson'] }],
  });
  if (!filePath) return { ok: false, reason: 'cancelled' };
  fs.writeFileSync(filePath, JSON.stringify(geojson, null, 2), 'utf-8');
  return { ok: true, filePath };
});

ipcMain.handle('export-csv', async (_, rows) => {
  if (!Array.isArray(rows)) return { ok: false, reason: 'Données invalides' };
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `solar_detections_${Date.now()}.csv`,
    filters: [{ name: 'Fichiers CSV', extensions: ['csv'] }],
  });
  if (!filePath) return { ok: false, reason: 'cancelled' };

  const header = 'Numéro;Latitude;Longitude;Surface (m²);Confiance IA (%);Prix HT (€);Temps Estimé (min)\n';
  const body = rows.map((r, i) => {
    const id = `PAN-${String(i + 1).padStart(4, '0')}`;
    const lat = Number(r.lat || 0).toFixed(6).replace('.', ',');
    const lng = Number(r.lng || 0).toFixed(6).replace('.', ',');
    const area = Number(r.area_m2 || 0).toFixed(1).replace('.', ',');
    const conf = (Number(r.confidence || 0) * 100).toFixed(0);
    const price = Number(r.price_eur || 0).toFixed(2).replace('.', ',');
    const time = Number(r.cleaning_min || 0).toFixed(0);
    return `${id};${lat};${lng};${area};${conf};${price};${time}`;
  }).join('\n');

  fs.writeFileSync(filePath, `\uFEFF${header}${body}`, 'utf-8');
  return { ok: true, filePath };
});

let pdfExportChain = Promise.resolve();

function looksLikePdfPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const resolved = path.resolve(filePath);
  return path.extname(resolved).toLowerCase() === '.pdf';
}

async function exportPdfToFile(htmlContent, filePath) {
  let pdfWin = null;
  let tempPath = '';
  try {
    pdfWin = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        sandbox: true,
      },
    });

    tempPath = path.join(app.getPath('temp'), `pdf_temp_${Date.now()}_${Math.random().toString(16).slice(2)}.html`);
    fs.writeFileSync(tempPath, htmlContent, 'utf-8');

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 8000);
      pdfWin.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        setTimeout(resolve, 250);
      });
      pdfWin.webContents.once('did-fail-load', (_event, code, desc) => {
        clearTimeout(timer);
        reject(new Error(desc || ('Chargement du document échoué (' + code + ')')));
      });
      pdfWin.loadFile(tempPath).catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const pdfData = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: false,
    });

    fs.writeFileSync(filePath, Buffer.from(pdfData));
    return { ok: true, filePath };
  } finally {
    if (pdfWin && !pdfWin.isDestroyed()) {
      pdfWin.destroy();
    }
    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    }
  }
}

async function handleExportPdf(htmlContent, suggestedName) {
  if (typeof htmlContent !== 'string') {
    electronLog('ERROR', 'export-pdf: le document n\'est pas une chaîne');
    return { ok: false, reason: 'Document invalide' };
  }
  electronLog('INFO', 'export-pdf: génération demandée (' + htmlContent.length + ' car., nom=' + String(suggestedName || '') + ')');
  if (htmlContent.length > MAX_PDF_HTML_CHARS) {
    const reason = 'Document trop volumineux (' + Math.round(htmlContent.length / 1e6) + ' Mo)';
    electronLog('ERROR', 'export-pdf: ' + reason);
    return { ok: false, reason };
  }
  const safeName = typeof suggestedName === 'string'
    ? suggestedName.replace(/[^\w.\- ]+/g, '').slice(0, 80)
    : '';
  const defaultDir = app.getPath('documents') || app.getPath('home') || '';
  const defaultPath = path.join(defaultDir, safeName || ('devis_panneaux_' + Date.now() + '.pdf'));
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!filePath) return { ok: false, reason: 'cancelled' };

  try {
    const result = await exportPdfToFile(htmlContent, filePath);
    electronLog('INFO', 'export-pdf: écrit ' + filePath);
    shell.showItemInFolder(filePath);
    return result;
  } catch (err) {
    electronLog('ERROR', 'export-pdf: ' + err.message, err.stack || '');
    return { ok: false, reason: err.message || 'Impossible de créer le PDF' };
  }
}

ipcMain.handle('export-pdf', async (_, htmlContent, suggestedName) => {
  const run = pdfExportChain.then(
    () => handleExportPdf(htmlContent, suggestedName),
    () => handleExportPdf(htmlContent, suggestedName),
  );
  pdfExportChain = run.then(() => undefined, () => undefined);
  return run;
});

ipcMain.handle('log-error', (_, message, detail) => {
  electronLog('ERROR', String(message || 'erreur renderer'), detail ? String(detail).slice(0, 4000) : '');
  return { ok: true };
});

ipcMain.handle('open-history-file', async (_, filePath) => {
  if (!looksLikePdfPath(filePath)) {
    return { ok: false, reason: 'Fichier PDF invalide' };
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, reason: 'Fichier introuvable (déplacé ou supprimé)' };
  }
  const err = await shell.openPath(resolved);
  if (err) {
    electronLog('ERROR', 'open-history-file: ' + err);
    return { ok: false, reason: err };
  }
  return { ok: true };
});

ipcMain.handle('reexport-history-file', async (_, filePath) => {
  if (!looksLikePdfPath(filePath)) {
    return { ok: false, reason: 'Fichier PDF invalide' };
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, reason: 'Fichier introuvable (déplacé ou supprimé)' };
  }
  const { filePath: dest } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), path.basename(resolved)),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!dest) return { ok: false, reason: 'cancelled' };
  try {
    fs.copyFileSync(resolved, dest);
    shell.showItemInFolder(dest);
    electronLog('INFO', 'reexport-history-file: ' + dest);
    return { ok: true, filePath: dest };
  } catch (err) {
    electronLog('ERROR', 'reexport-history-file: ' + err.message);
    return { ok: false, reason: err.message };
  }
});

ipcMain.handle('capture-rect', async (_, rect) => {
  if (!mainWindow || !rect) return null;
  try {
    const nativeImage = await mainWindow.webContents.capturePage(rect);
    return nativeImage.toDataURL();
  } catch (err) {
    console.error('Erreur de capture :', err);
    return null;
  }
});

ipcMain.handle('clear-cache', async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/cache/clear`, {
      method: 'DELETE',
      headers: { 'X-SolarScan-Token': API_TOKEN },
    });
    return res.ok ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  }
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

function serveLocalAsset(request) {
  let name = '';
  try {
    name = path.basename(new URL(request.url).pathname);
  } catch {
    return new Response('introuvable', { status: 404 });
  }
  const allowed = new Set(['logo.png']);
  const filePath = path.join(assetsDir(), name);
  if (!allowed.has(name) || !fs.existsSync(filePath)) {
    return new Response('introuvable', { status: 404 });
  }
  const data = fs.readFileSync(filePath);
  return new Response(data, { headers: { 'Content-Type': 'image/png' } });
}

app.whenReady().then(async () => {
  protocol.handle('solarscan', serveLocalAsset);
  ensureSettingsFile();
  buildMenu();

  if (await isPortOpen()) {
    dialog.showErrorBox(
      'Port 8765 occupé',
      'Un serveur répond déjà sur le port 8765. Fermez l\'autre SolarScan, ou le backend lancé à la main, puis relancez. Electron démarre le moteur tout seul.'
    );
    app.quit();
    return;
  }

  startPythonBackend();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Sur macOS la fenêtre se ferme mais l'app reste dans le Dock :
  // on garde le moteur pour la réouverture.
  if (process.platform !== 'darwin') {
    stopPythonBackend();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopPythonBackend();
});
