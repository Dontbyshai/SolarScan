/**
 * map.js — Logique principale de la carte Leaflet
 * Initialise la carte, gère les layers OSM / IGN, et orchestre
 * la détection automatique (zoom ≥ 17) et manuelle (zone dessinée).
 */

window.MapController = (() => {
  'use strict';

  const BACKEND_URL = 'http://127.0.0.1:8765';
  const AUTO_TRIGGER_ZOOM = 17;
  const DEBOUNCE_MS = 800;

  // ── State ─────────────────────────────────────────────────
  let _map = null;
  let _currentLayer = 'osm';
  let _layers = {};
  let _detectionPolygons = L.featureGroup();
  let _isAnalyzing = false;
  let _detections = [];
  let _isBackendReady = false;
  let _scanBoundsLayer = null;

  // Edit mode vars
  let _editHandler = null;
  let _isEditing = false;
  const $btnModeEdit = document.getElementById('btn-mode-edit');

  // ── DOM refs ──────────────────────────────────────────────
  const $loadingOverlay   = document.getElementById('loading-overlay');
  const $loadingText      = document.getElementById('loading-text');
  const $loadingSub       = document.getElementById('loading-sub');
  const $progressContainer = document.getElementById('progress-bar-container');
  const $progressFill     = document.getElementById('progress-fill');
  const $progressText     = document.getElementById('progress-text');
  const $progressPct      = document.getElementById('progress-pct');
  const $zoomBadge        = document.getElementById('zoom-badge');
  const $zoomValue        = document.getElementById('zoom-value');
  const $btnOSM           = document.getElementById('btn-osm');
  const $btnIGN           = document.getElementById('btn-ign');
  const $btnScanView      = document.getElementById('btn-scan-view');
  const $btnZoomIn        = document.getElementById('btn-zoom-in');
  const $btnZoomOut       = document.getElementById('btn-zoom-out');
  const $btnLocate        = document.getElementById('btn-locate');
  const $statusDot        = document.getElementById('status-dot');
  const $statusText       = document.getElementById('status-text');

  // ── Layer definitions ─────────────────────────────────────
  function _buildLayers() {
    _layers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 22,
      maxNativeZoom: 19,
      subdomains: 'abc',
    });

    // IGN Géoplateforme — France uniquement — sans clé API
    _layers.ign = L.tileLayer(
      'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
      '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM' +
      '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
      '&FORMAT=image%2Fjpeg&STYLE=normal',
      {
        attribution: '© IGN Géoplateforme — France uniquement',
        maxZoom: 22,
        maxNativeZoom: 19,
        minZoom: 1,
      }
    );
  }

  // ── Init map ──────────────────────────────────────────────
  function init() {
    _map = L.map('map', {
      center: [46.603354, 1.888334], // Centre de la France
      zoom: 6,
      maxZoom: 22,
      zoomControl: false,
      doubleClickZoom: true,
      scrollWheelZoom: true,
    });

    _buildLayers();
    _layers.osm.addTo(_map);
    _detectionPolygons.addTo(_map);

    // Init draw module
    DrawController.init(_map);
    // Draw events
    DrawController.onAddManualZone(_onAddManualZone);

    // Init sidebar settings
    Sidebar.loadSettings();
    Sidebar.onSelectDetection((detection, idx) => {
      if (!detection) return;
      _map.flyTo([detection.center.lat, detection.center.lng], 19, { duration: 0.8 });
    });

    // Map events
    _map.on('zoomend moveend', () => {
      _updateZoomBadge();
    });

    _map.on(L.Draw.Event.EDITED, (e) => {
      e.layers.eachLayer(layer => {
        const idx = layer._detectionIdx;
        if (idx !== undefined && _detections[idx]) {
          const latlngs = layer.getLatLngs()[0];
          
          let area = 0;
          if (L.GeometryUtil && L.GeometryUtil.geodesicArea) {
            area = L.GeometryUtil.geodesicArea(latlngs);
          } else {
            const bounds = layer.getBounds();
            const w = bounds.getEast() - bounds.getWest();
            const h = bounds.getNorth() - bounds.getSouth();
            area = Math.abs(w * 111000) * Math.abs(h * 111000) * 0.7; 
          }
          
          _detections[idx].area_m2 = area;
          _detections[idx].polygon = latlngs.map(ll => [ll.lng, ll.lat]);
          const center = layer.getBounds().getCenter();
          _detections[idx].center = { lat: center.lat, lng: center.lng };
        }
      });
      Sidebar.setDetections(_detections); // Mettre à jour l'interface
      Toast.show('Modifications enregistrées', 'success');
      _toggleEditMode(false);
    });

    if ($btnModeEdit) {
      $btnModeEdit.addEventListener('click', () => {
        _toggleEditMode(!_isEditing);
      });
    }

    _updateZoomBadge();

    // Backend events from Electron preload (if spawned by Electron)
    if (window.solarAPI) {
      window.solarAPI.onBackendReady(() => _setBackendReady(true));
      window.solarAPI.onBackendError((msg) => {
        console.warn(`Electron backend IPC error: ${msg}`);
      });
    }

    // Always run direct HTTP check as a reliable source of truth
    setTimeout(() => _checkBackendDirectly(), 1000);

    // Layer switching
    $btnOSM.addEventListener('click', () => _switchLayer('osm'));
    $btnIGN.addEventListener('click', () => _switchLayer('ign'));
    $btnScanView.addEventListener('click', _analyzeCurrentView);

    // Zoom controls
    $btnZoomIn.addEventListener('click', () => _map.zoomIn());
    $btnZoomOut.addEventListener('click', () => _map.zoomOut());
    $btnLocate.addEventListener('click', _locateUser);

    // Search address
    const $searchInput = document.getElementById('search-input');
    const $btnSearch = document.getElementById('btn-search');
    
    async function performSearch() {
      const query = $searchInput.value.trim();
      if (!query) return;
      $btnSearch.textContent = '⏳';
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`, {
          headers: { 'Accept-Language': 'fr' }
        });
        const data = await res.json();
        if (data && data.length > 0) {
          const result = data[0];
          _map.flyTo([result.lat, result.lon], 18, { animate: true, duration: 1.5 });
        } else {
          window.Toast?.show('Adresse introuvable', 'warning');
        }
      } catch (e) {
        window.Toast?.show('Erreur lors de la recherche', 'error');
      } finally {
        $btnSearch.textContent = '🔍';
      }
    }
    
    $btnSearch.addEventListener('click', performSearch);
    $searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') performSearch();
    });
  }

  // ── Backend health check (fallback without Electron) ─────
  async function _checkBackendDirectly() {
    try {
      const res = await fetch(`${BACKEND_URL}/health`);
      if (res.ok) _setBackendReady(true);
      else setTimeout(_checkBackendDirectly, 3000);
    } catch {
      setTimeout(_checkBackendDirectly, 3000);
    }
  }

  function _setBackendReady(ready) {
    _isBackendReady = ready;
    $statusDot.className = `status-dot ${ready ? 'online' : 'offline'}`;
    $statusText.textContent = ready ? 'IA prête' : 'IA hors ligne';
  }

  // ── Layer switching ───────────────────────────────────────
  function _switchLayer(name) {
    if (_currentLayer === name) return;
    _map.removeLayer(_layers[_currentLayer]);
    _layers[name].addTo(_map);
    _map.addLayer(_detectionPolygons); // Keep polygons on top
    _currentLayer = name;

    $btnOSM.classList.toggle('active', name === 'osm');
    $btnIGN.classList.toggle('active', name === 'ign');
  }

  // ── Zoom badge ────────────────────────────────────────────
  function _updateZoomBadge() {
    const z = _map.getZoom();
    $zoomValue.textContent = z;

    const isAutoReady = z >= AUTO_TRIGGER_ZOOM;
    $zoomBadge.classList.toggle('auto-ready', isAutoReady);
  }

  // ── Get visible tiles ─────────────────────────────────────
  function _getVisibleTiles(zoom) {
    const settings = Sidebar.getSettings();
    const maxTiles = settings.max_tiles_auto || 20;
    const bounds = _map.getBounds();

    const georgraphicBounds = {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    };

    let tiles = GeoUtils.tilesInBounds(georgraphicBounds, zoom);

    if (tiles.length > maxTiles) {
      // Take center tiles
      const mid = Math.floor(tiles.length / 2);
      const half = Math.floor(maxTiles / 2);
      tiles = tiles.slice(Math.max(0, mid - half), mid + half);
    }

    return tiles.map((t) => ({
      x: t.x, y: t.y, z: t.z,
      url: GeoUtils.ignTileUrl(t.x, t.y, t.z),
      bounds: GeoUtils.tileToBounds(t.x, t.y, t.z),
    }));
  }

  // ── Analyze current view (manual via button) ─────────────
  async function _analyzeCurrentView() {
    if (_isAnalyzing) return;
    if (!_isBackendReady) {
      Toast.show('Le moteur IA n\'est pas démarré.', 'error');
      return;
    }

    const zoom = _map.getZoom();
    if (zoom < 17) {
      Toast.show('Trop de maisons, veuillez zoomer davantage (zoom >= 17).', 'warning');
      return;
    }

    if (_currentLayer !== 'ign') {
      _switchLayer('ign');
    }

    const analyzeZoom = Math.min(zoom + 1, 19); // Prefer zoom+1 for more detail
    const tiles = _getVisibleTiles(analyzeZoom);

    if (tiles.length === 0) {
      Toast.show('Aucune tuile visible', 'info');
      return;
    }

    // Highlight area being analyzed
    if (_scanBoundsLayer) {
      _map.removeLayer(_scanBoundsLayer);
    }
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    tiles.forEach(t => {
      minLat = Math.min(minLat, t.bounds.south);
      maxLat = Math.max(maxLat, t.bounds.north);
      minLng = Math.min(minLng, t.bounds.west);
      maxLng = Math.max(maxLng, t.bounds.east);
    });
    _scanBoundsLayer = L.rectangle([[minLat, minLng], [maxLat, maxLng]], {
      color: "#3b82f6",
      weight: 3,
      fillOpacity: 0.1,
      dashArray: '5, 5'
    }).addTo(_map);

    showLoading(`Analyse de ${tiles.length} tuile${tiles.length > 1 ? 's' : ''} IGN…`, 'Scan de la vue · Zoom ' + analyzeZoom);
    await _runAnalysis(tiles);
    hideLoading();

    setTimeout(() => {
      if (_scanBoundsLayer) {
        _map.removeLayer(_scanBoundsLayer);
        _scanBoundsLayer = null;
      }
    }, 5000);
  }

  // ── Add manual zone ───────────────────────────────────────
  async function _onAddManualZone(layer) {
    if (!layer || typeof layer.getLatLngs !== 'function') return;

    // Récupérer les coordonnées (tableau de tableaux d'objets LatLng)
    const latlngs = layer.getLatLngs()[0];
    if (!latlngs || latlngs.length < 3) return;

    // Calculer la surface
    let area = 0;
    if (L.GeometryUtil && L.GeometryUtil.geodesicArea) {
      area = L.GeometryUtil.geodesicArea(latlngs);
    } else {
      const bounds = layer.getBounds();
      const w = bounds.getEast() - bounds.getWest();
      const h = bounds.getNorth() - bounds.getSouth();
      // degrees to meters roughly
      area = Math.abs(w * 111000) * Math.abs(h * 111000) * 0.7; 
    }

    if (area < 1.0) {
      Toast.show('Zone trop petite', 'warning');
      return;
    }

    const center = layer.getBounds().getCenter();
    
    // Convertir les LatLng au format attendu par _displayDetections: [lng, lat]
    const polygonGeo = latlngs.map(ll => [ll.lng, ll.lat]);

    const detection = {
      polygon: polygonGeo,
      area_m2: area,
      confidence: 1.0,
      center: { lat: center.lat, lng: center.lng }
    };

    // Add to _detections
    _detections.push(detection);
    
    // Redessiner toutes les détections en utilisant displayDetections
    displayDetections(_detections); // Re-render the map and sidebar
    
    DrawController.clearDrawings();
    DrawController.setMode('normal');
    
    Toast.show('Panneau ajouté manuellement avec succès', 'success');
  }

  // ── Core analysis call ────────────────────────────────────
  async function _runAnalysis(tiles, withProgress = false) {
    _isAnalyzing = true;

    try {
      const response = await fetch(`${BACKEND_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiles }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Erreur inconnue' }));
        throw new Error(err.detail || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const newDetections = data.detections || [];

      if (newDetections.length === 0) {
        Toast.show('Aucun panneau solaire détecté dans cette zone', 'info');
      } else {
        Toast.show(`${newDetections.length} panneau${newDetections.length > 1 ? 'x' : ''} détecté${newDetections.length > 1 ? 's' : ''} !`, 'success');
        displayDetections(newDetections);
      }

    } catch (err) {
      console.error('[Analysis] Error:', err);
      Toast.show(`Erreur d'analyse : ${err.message}`, 'error', 6000);
    } finally {
      _isAnalyzing = false;
    }
  }

  // ── Display detection polygons ────────────────────────────
  function displayDetections(detections) {
    _detections = [..._detections, ...detections];
    _renderPolygons(detections);
    Sidebar.setDetections(_detections);
  }

  function _toggleEditMode(enable) {
    if (!_detectionPolygons) return;
    
    if (!_editHandler) {
      _editHandler = new L.EditToolbar.Edit(_map, {
        featureGroup: _detectionPolygons
      });
    }

    _isEditing = enable;
    if (_isEditing) {
      _editHandler.enable();
      $btnModeEdit.classList.add('active');
      $btnModeEdit.innerHTML = '💾 Sauver';
      $btnModeEdit.classList.remove('btn-ghost');
      $btnModeEdit.classList.add('btn-primary');
      Toast.show('Mode édition actif. Déplacez les points puis cliquez sur Sauver.', 'info');
      if (window.DrawController && window.DrawController.isDrawMode()) {
        window.DrawController.setMode('normal');
      }
    } else {
      _editHandler.save();
      _editHandler.disable();
      $btnModeEdit.classList.remove('active', 'btn-primary');
      $btnModeEdit.classList.add('btn-ghost');
      $btnModeEdit.innerHTML = '✍️ Editer';
    }
  }

  function clearDetections() {
    _detections = [];
    _detectionPolygons.clearLayers();
    Sidebar.setDetections([]);
  }

  function _renderPolygons(detections) {
    detections.forEach((d, i) => {
      const conf = d.confidence;
      const color = conf >= 0.75 ? '#22c55e' : conf >= 0.5 ? '#f97316' : '#ef4444';
      const fillColor = conf >= 0.75 ? 'rgba(34,197,94,0.2)' : 'rgba(249,115,22,0.2)';

      // Polygon coords: [[lat, lng], ...]
      const latlngs = d.polygon.map(([lng, lat]) => [lat, lng]);

      const poly = L.polygon(latlngs, {
        color,
        fillColor,
        weight: 2,
        fillOpacity: 0.35,
        dashArray: null,
      });

      // Popup
      const est = Sidebar.computeEstimate(d.area_m2);
      const confClass = conf >= 0.75 ? 'high' : 'medium';
      const confLabel = conf >= 0.75 ? 'Haute confiance' : 'Confiance moyenne';
      const idx = _detections.length - detections.length + i;

      poly.bindPopup(_buildPopupHTML(d, est, idx, confClass, confLabel), {
        maxWidth: 300,
        className: '',
      });

      poly._detectionIdx = idx; // Store index for editing

      poly.on('click', () => {
        // Highlight in sidebar
        const items = document.querySelectorAll('.detection-item');
        items.forEach(el => el.classList.remove('selected'));
        const item = document.querySelector(`.detection-item[data-idx="${idx}"]`);
        if (item) {
          item.classList.add('selected');
          item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      _detectionPolygons.addLayer(poly);
    });
  }

  function _buildPopupHTML(d, est, idx, confClass, confLabel) {
    const settings = Sidebar.getSettings();
    const center = d.center || { lat: 0, lng: 0 };

    return `
      <div class="popup-body">
        <div class="popup-header">
          <div class="popup-dot" style="background: ${confClass === 'high' ? '#22c55e' : '#f97316'}; box-shadow: 0 0 6px ${confClass === 'high' ? '#22c55e' : '#f97316'};"></div>
          <div class="popup-title">#PAN-${String(idx + 1).padStart(4, '0')}</div>
          <div class="popup-confidence ${confClass}">${(d.confidence * 100).toFixed(0)}%</div>
        </div>

        <div class="popup-rows">
          <div class="popup-row">
            <span class="popup-row-label">Surface estimée</span>
            <span class="popup-row-value">${d.area_m2.toFixed(1)} m²</span>
          </div>
          <div class="popup-row">
            <span class="popup-row-label">Confiance IA</span>
            <span class="popup-row-value">${confLabel}</span>
          </div>
          <div class="popup-row">
            <span class="popup-row-label">Latitude</span>
            <span class="popup-row-value">${center.lat.toFixed(6)}°</span>
          </div>
          <div class="popup-row">
            <span class="popup-row-label">Longitude</span>
            <span class="popup-row-value">${center.lng.toFixed(6)}°</span>
          </div>
        </div>

        <div class="popup-price-section">
          <div class="popup-price-label">💰 Estimation nettoyage</div>
          <div class="popup-price-value">${est.price_ht.toFixed(2)} € HT</div>
          <div class="popup-price-meta">
            ${est.price_ttc.toFixed(2)} € TTC · ${est.cleaning_min.toFixed(0)} min
            <br/>Base : ${settings.price_per_m2}€/m² · ${settings.cleaning_time_per_m2} min/m²
          </div>
        </div>

        <div class="popup-actions">
          <button class="btn btn-ghost" onclick="Sidebar.computeEstimate(${d.area_m2})" style="font-size:11px;" disabled>
            📄 Fiche PDF
          </button>
          <button class="btn btn-ghost" style="font-size:11px;"
            onclick="navigator.clipboard && navigator.clipboard.writeText('${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}'); Toast.show('Coords copiées', 'success')">
            📋 Coords
          </button>
        </div>
      </div>`;
  }

  // ── Loading/Progress UI ───────────────────────────────────
  function showLoading(text = 'Analyse en cours…', sub = '') {
    $loadingText.textContent = text;
    $loadingSub.textContent = sub;
    $loadingOverlay.classList.add('visible');
  }

  function hideLoading() {
    $loadingOverlay.classList.remove('visible');
  }

  function showProgress(text = '') {
    $progressText.textContent = text;
    $progressFill.style.width = '0%';
    $progressPct.textContent = '0%';
    $progressContainer.classList.add('visible');
  }

  function updateProgress(pct, text) {
    $progressFill.style.width = `${pct}%`;
    $progressPct.textContent = `${Math.round(pct)}%`;
    if (text) $progressText.textContent = text;
    $progressContainer.setAttribute('aria-valuenow', Math.round(pct));
  }

  function hideProgress() {
    $progressContainer.classList.remove('visible');
  }

  // ── Geolocation ───────────────────────────────────────────
  function _locateUser() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        _map.flyTo([pos.coords.latitude, pos.coords.longitude], 16, { duration: 1.2 });
        Toast.show('Position localisée', 'success');
      },
      () => Toast.show('Impossible d\'accéder à la géolocalisation', 'error')
    );
  }

  // ── Start ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  return { clearDetections, showProgress, updateProgress, hideProgress };
})();
