/**
 * draw.js — Outils de dessin de zone (Leaflet.draw)
 * Mode manuel : rectangle ou polygone → déclenche l'analyse IA
 */

window.DrawController = (() => {
  'use strict';

  let _map = null;
  let _drawnItems = null;
  let _drawControl = null;
  let _activeDrawTool = null;
  let _currentLayer = null;
  let _onAddManualZone = null;

  // ── DOM refs ──────────────────────────────────────────────
  const $btnModeDraw   = document.getElementById('btn-mode-draw');
  const $drawControls  = document.getElementById('draw-controls');
  const $btnDrawRect   = document.getElementById('btn-draw-rect');
  const $btnDrawPoly   = document.getElementById('btn-draw-poly');
  const $btnDrawClear  = document.getElementById('btn-draw-clear');
  const $btnAnalyze    = document.getElementById('btn-analyze-zone');

  let _isDrawMode = false;

  function init(map) {
    _map = map;

    // Layer for drawn shapes
    _drawnItems = new L.FeatureGroup();
    _map.addLayer(_drawnItems);

    // Mode buttons
    $btnModeDraw.addEventListener('click', () => setMode(!_isDrawMode ? 'draw' : 'normal'));

    // Drawing tools
    $btnDrawRect.addEventListener('click', () => _startDraw('rectangle'));
    $btnDrawPoly.addEventListener('click', () => _startDraw('polygon'));
    $btnDrawClear.addEventListener('click', clearDrawings);
    $btnAnalyze.addEventListener('click', _triggerAnalysis);

    // Leaflet.draw event: shape completed
    _map.on(L.Draw.Event.CREATED, (e) => {
      // Clear previous shape
      _drawnItems.clearLayers();
      _drawnItems.addLayer(e.layer);

      // Get drawn shape layer
      _currentLayer = e.layer;
      $btnAnalyze.disabled = false;

      Toast.show('Zone définie. Cliquez sur "Analyser la zone" pour lancer la détection.', 'info', 5000);
    });

    _map.on(L.Draw.Event.DRAWSTART, () => {
      $btnDrawRect.classList.remove('active');
      $btnDrawPoly.classList.remove('active');
    });

    _map.on(L.Draw.Event.DRAWSTOP, () => {
      _activeDrawTool = null;
    });

    // Init to Auto mode
    setMode('auto');
  }

  function setMode(mode) {
    _isDrawMode = mode === 'draw';

    $btnModeDraw.classList.toggle('active', _isDrawMode);
    $drawControls.style.display = _isDrawMode ? 'flex' : 'none';

    // Stop any active draw tool
    if (_activeDrawTool) {
      _activeDrawTool.disable();
      _activeDrawTool = null;
    }

    if (!_isDrawMode) {
      clearDrawings();
    }
  }

  function isDrawMode() {
    return _isDrawMode;
  }

  function _startDraw(type) {
    // Cancel any existing draw tool
    if (_activeDrawTool) {
      _activeDrawTool.disable();
    }

    $btnDrawRect.classList.toggle('active', type === 'rectangle');
    $btnDrawPoly.classList.toggle('active', type === 'polygon');

    const opts = {
      shapeOptions: {
        color: '#00d4aa',
        weight: 2,
        fillColor: 'rgba(0, 212, 170, 0.1)',
        dashArray: '6 4',
      },
    };

    if (type === 'rectangle') {
      _activeDrawTool = new L.Draw.Rectangle(_map, opts);
    } else {
      _activeDrawTool = new L.Draw.Polygon(_map, opts);
    }

    _activeDrawTool.enable();
  }

  function clearDrawings() {
    if (_drawnItems) _drawnItems.clearLayers();
    _currentLayer = null;
    $btnAnalyze.disabled = true;
    if (_activeDrawTool) {
      _activeDrawTool.disable();
      _activeDrawTool = null;
    }
    $btnDrawRect.classList.remove('active');
    $btnDrawPoly.classList.remove('active');
  }

  function _triggerAnalysis() {
    if (_onAddManualZone && _currentLayer) {
      _onAddManualZone(_currentLayer);
    }
  }

  function onAddManualZone(cb) {
    _onAddManualZone = cb;
  }

  return { init, setMode, isDrawMode, clearDrawings, onAddManualZone };
})();
