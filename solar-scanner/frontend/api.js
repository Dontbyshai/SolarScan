/**
 * api.js — Appels au moteur local, avec le jeton fourni par Electron.
 * Sans Electron (fichier ouvert dans un navigateur), les appels partent
 * sans jeton : le backend lancé à la main les accepte, sauf /shutdown.
 */
window.SolarApi = (() => {
  'use strict';

  const BASE = 'http://127.0.0.1:8765';

  async function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (window.solarAPI && window.solarAPI.getToken) {
      const token = await window.solarAPI.getToken();
      if (token) headers['X-SolarScan-Token'] = token;
    }
    return headers;
  }

  async function request(path, options) {
    const opts = options || {};
    const headers = await authHeaders(opts.headers);
    return fetch(BASE + path, Object.assign({}, opts, { headers }));
  }

  return { BASE, request };
})();
