/**
 * sidebar.js — Panneau latéral : stats, liste des détections, exports
 */

window.Sidebar = (() => {
  'use strict';

  let _detections = [];
  let _settings = {
    price_tiers: [
      { max: 100, price: 3.5 },
      { max: 300, price: 3.0 },
      { max: 500, price: 2.5 },
      { max: Infinity, price: 2.0 }
    ],
    vat_rate: 0.20,
    cleaning_time_per_m2: 2,
    currency: 'EUR',
    max_tiles_auto: 20,
    company_name: '',
    company_address: '',
    company_siret: '',
    company_logo: '',
  };
  let _onSelectDetection = null;

  // ── DOM refs ─────────────────────────────────────────────
  const $count     = document.getElementById('stat-count');
  const $area      = document.getElementById('stat-area');
  const $price     = document.getElementById('stat-price');
  const $list      = document.getElementById('detection-list');
  const $sidebar   = document.getElementById('sidebar');

  const $btnExportCSV     = document.getElementById('btn-export-csv');
  const $btnExportGeoJSON = document.getElementById('btn-export-geojson');
  const $btnExportPDF     = document.getElementById('btn-export-pdf');
  const $btnClearResults  = document.getElementById('btn-clear-results');

  // ── Settings panel refs ───────────────────────────────────
  const $settingsPanel  = document.getElementById('settings-panel');
  const $btnSettings    = document.getElementById('btn-settings');
  const $btnSave        = document.getElementById('btn-save-settings');
  const $btnClose       = document.getElementById('btn-close-settings');
  const $btnClearCache  = document.getElementById('btn-clear-cache');
  
  // Pricing tiers
  const $tier1Max   = document.getElementById('tier1-max');
  const $tier1Price = document.getElementById('tier1-price');
  const $tier2Max   = document.getElementById('tier2-max');
  const $tier2Price = document.getElementById('tier2-price');
  const $tier3Max   = document.getElementById('tier3-max');
  const $tier3Price = document.getElementById('tier3-price');
  const $tier4Price = document.getElementById('tier4-price');

  const $inputVAT       = document.getElementById('setting-vat');
  const $inputTime      = document.getElementById('setting-time');
  const $inputMaxTiles  = document.getElementById('setting-max-tiles');
  const $inputCompanyName = document.getElementById('setting-company-name');
  const $inputCompanyAddr = document.getElementById('setting-company-address');
  const $inputCompanySiret = document.getElementById('setting-company-siret');
  
  // Logo
  const $inputCompanyLogo = document.getElementById('setting-company-logo');
  const $fileCompanyLogo = document.getElementById('setting-company-logo-file');
  const $btnUploadLogo = document.getElementById('btn-upload-logo');
  const $logoPreview = document.getElementById('logo-preview');

  // ── Logo Upload ───────────────────────────────────────────
  $btnUploadLogo.addEventListener('click', () => $fileCompanyLogo.click());
  $fileCompanyLogo.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        $inputCompanyLogo.value = ev.target.result;
        $logoPreview.src = ev.target.result;
        $logoPreview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }
  });

  // ── Toggle sidebar ────────────────────────────────────────
  document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
    $sidebar.classList.toggle('collapsed');
    setTimeout(() => {
      if (window.MapController && window.MapController.invalidateMap) {
        window.MapController.invalidateMap();
      } else {
        window.dispatchEvent(new Event('resize'));
      }
    }, 350);
  });

  // ── Settings panel ────────────────────────────────────────
  $btnSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    $settingsPanel.style.display = 'flex';
  });

  $btnClose.addEventListener('click', () => {
    $settingsPanel.style.display = 'none';
  });

  $settingsPanel.addEventListener('click', (e) => {
    if (e.target === $settingsPanel) {
      $settingsPanel.style.display = 'none';
    }
  });

  $btnSave.addEventListener('click', async () => {
    _settings.price_tiers = [
      { max: parseFloat($tier1Max.value) || 100, price: parseFloat($tier1Price.value) || 3.5 },
      { max: parseFloat($tier2Max.value) || 300, price: parseFloat($tier2Price.value) || 3.0 },
      { max: parseFloat($tier3Max.value) || 500, price: parseFloat($tier3Price.value) || 2.5 },
      { max: Infinity, price: parseFloat($tier4Price.value) || 2.0 }
    ];

    _settings.vat_rate = (parseFloat($inputVAT.value) || 20) / 100;
    _settings.cleaning_time_per_m2 = parseFloat($inputTime.value) || 2;
    _settings.max_tiles_auto = parseInt($inputMaxTiles.value) || 20;
    
    _settings.company_name = $inputCompanyName.value || '';
    _settings.company_address = $inputCompanyAddr.value || '';
    _settings.company_siret = $inputCompanySiret.value || '';
    _settings.company_logo = $inputCompanyLogo.value || '';

    if (window.solarAPI) {
      await window.solarAPI.saveSettings(_settings);
    }
    $settingsPanel.style.display = 'none';
    Toast.show('Paramètres enregistrés', 'success');

    _render();
  });

  $btnClearCache.addEventListener('click', async () => {
    if (window.solarAPI) {
      const res = await window.solarAPI.clearCache();
      Toast.show(res.ok ? 'Cache vidé' : 'Erreur', res.ok ? 'success' : 'error');
    }
  });

  // ── Load settings from backend/disk ──────────────────────
  async function loadSettings() {
    if (!window.solarAPI) return;
    const saved = await window.solarAPI.getSettings();
    if (saved && Object.keys(saved).length) {
      _settings = { ..._settings, ...saved };
      
      if (_settings.price_tiers && _settings.price_tiers.length >= 4) {
        $tier1Max.value = _settings.price_tiers[0].max;
        $tier1Price.value = _settings.price_tiers[0].price;
        $tier2Max.value = _settings.price_tiers[1].max;
        $tier2Price.value = _settings.price_tiers[1].price;
        $tier3Max.value = _settings.price_tiers[2].max;
        $tier3Price.value = _settings.price_tiers[2].price;
        $tier4Price.value = _settings.price_tiers[3].price;
      } else if (saved.price_per_m2) {
        // Fallback for old save
        $tier1Price.value = $tier2Price.value = $tier3Price.value = $tier4Price.value = saved.price_per_m2;
      }
      
      $inputVAT.value = Math.round(_settings.vat_rate * 100);
      $inputTime.value = _settings.cleaning_time_per_m2;
      $inputMaxTiles.value = _settings.max_tiles_auto;
      
      $inputCompanyName.value = _settings.company_name || '';
      $inputCompanyAddr.value = _settings.company_address || '';
      $inputCompanySiret.value = _settings.company_siret || '';
      $inputCompanyLogo.value = _settings.company_logo || '';

      if (_settings.company_logo && _settings.company_logo.length > 10) {
        $logoPreview.src = _settings.company_logo;
        $logoPreview.style.display = 'block';
      }
    }
  }

  function getPriceForArea(area_m2) {
    if (!_settings.price_tiers) return 3.0;
    for (const tier of _settings.price_tiers) {
      if (area_m2 <= tier.max) return tier.price;
    }
    return _settings.price_tiers[_settings.price_tiers.length - 1].price;
  }

  // ── Compute cleaning estimate ─────────────────────────────
  function computeEstimate(area_m2) {
    const unitPrice = getPriceForArea(area_m2);
    const price_ht = area_m2 * unitPrice;
    const price_ttc = price_ht * (1 + _settings.vat_rate);
    const cleaning_min = area_m2 * _settings.cleaning_time_per_m2;
    return { price_ht, price_ttc, cleaning_min, unitPrice };
  }

  // ── Public: set detections ────────────────────────────────
  function setDetections(detections) {
    _detections = detections;
    _render();
  }

  function clearDetections() {
    _detections = [];
    _render();
    if (_onSelectDetection) _onSelectDetection(null);
  }

  function onSelectDetection(cb) {
    _onSelectDetection = cb;
  }

  function getSettings() {
    return _settings;
  }

  // ── Render ────────────────────────────────────────────────
  function _render() {
    // Ne calculer le total que pour les détections cochées (par défaut true)
    const active_detections = _detections.filter(d => d.checked !== false);
    const total_area = active_detections.reduce((s, d) => s + d.area_m2, 0);
    const total_price = active_detections.reduce((s, d) => s + computeEstimate(d.area_m2).price_ht, 0);

    // Mettre à jour le compteur global pour refléter la sélection vs total
    $count.textContent = `${active_detections.length}/${_detections.length}`;
    $area.innerHTML = _detections.length > 0
      ? `${total_area.toFixed(0)}<span class="stat-unit">m²</span>`
      : `0<span class="stat-unit">m²</span>`;
    $price.innerHTML = _detections.length > 0
      ? `${total_price.toFixed(0)}<span class="stat-unit">€</span>`
      : `0<span class="stat-unit">€</span>`;

    const hasResults = _detections.length > 0;
    $btnExportCSV.disabled = !hasResults;
    $btnExportGeoJSON.disabled = !hasResults;
    $btnExportPDF.disabled = !hasResults;
    $btnClearResults.disabled = !hasResults;

    if (!hasResults) {
      $list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🛰</div>
          <div class="empty-title">Aucune détection</div>
          <div class="empty-desc">Activez le mode Auto (zoom ≥ 17 sur IGN) ou dessinez une zone avec le mode Zone.</div>
        </div>`;
      return;
    }

    $list.innerHTML = _detections.map((d, i) => {
      const est = computeEstimate(d.area_m2);
      const conf = d.confidence;
      const confClass = conf >= 0.75 ? 'high' : conf >= 0.5 ? 'medium' : 'low';
      const confLabel = conf >= 0.75 ? 'Haute' : conf >= 0.5 ? 'Moyenne' : 'Basse';
      const isChecked = d.checked !== false ? 'checked' : '';
      const opacity = d.checked !== false ? '1.0' : '0.5';

      return `
        <div class="detection-item" data-idx="${i}" role="button" tabindex="0" aria-label="Panneau ${i + 1}" style="opacity: ${opacity};">
          <input type="checkbox" class="detection-checkbox" data-idx="${i}" ${isChecked} title="Inclure dans le total" style="margin-right: 12px; transform: scale(1.2); cursor: pointer;">
          <div class="detection-badge ${confClass}"></div>
          <div class="detection-info">
            <div class="detection-id">#PAN-${String(i + 1).padStart(4, '0')}</div>
            <div class="detection-area">${d.area_m2.toFixed(1)} m²</div>
            <div class="detection-meta">
              <span>🎯 ${confLabel} (${(conf * 100).toFixed(0)}%)</span>
              <span>📍 ${d.center ? d.center.lat.toFixed(5) + ', ' + d.center.lng.toFixed(5) : '—'}</span>
            </div>
          </div>
          <div class="detection-price">${est.price_ht.toFixed(0)}€</div>
        </div>
      `;
    }).join('');

    // Click events
    $list.querySelectorAll('.detection-item').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        $list.querySelectorAll('.detection-item').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        if (_onSelectDetection) _onSelectDetection(_detections[idx], idx);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') el.click();
      });
    });

    // Checkbox events
    $list.querySelectorAll('.detection-checkbox').forEach((cb) => {
      cb.addEventListener('click', (e) => {
        e.stopPropagation(); // Évite de déclencher le clic sur l'item complet
      });
      cb.addEventListener('change', (e) => {
        const idx = parseInt(cb.dataset.idx);
        _detections[idx].checked = cb.checked;
        _render(); // Re-calculer les totaux
      });
    });
  }

  // ── Exports ───────────────────────────────────────────────
  $btnClearResults.addEventListener('click', () => {
    clearDetections();
    if (window.MapController) window.MapController.clearDetections();
  });

  $btnExportGeoJSON.addEventListener('click', async () => {
    if (!_detections.length || !window.solarAPI) return;
    const geojson = {
      type: 'FeatureCollection',
      features: _detections.map((d, i) => ({
        type: 'Feature',
        id: i + 1,
        geometry: { type: 'Polygon', coordinates: [d.polygon] },
        properties: {
          id: `PAN-${String(i + 1).padStart(4, '0')}`,
          area_m2: d.area_m2,
          confidence: d.confidence,
          ...computeEstimate(d.area_m2),
        },
      })),
    };
    const res = await window.solarAPI.exportGeoJSON(geojson);
    if (res.ok) Toast.show(`GeoJSON exporté`, 'success');
    else if (res.reason !== 'cancelled') Toast.show('Erreur export GeoJSON', 'error');
  });

  $btnExportCSV.addEventListener('click', async () => {
    if (!_detections.length || !window.solarAPI) return;
    const rows = _detections.map((d) => {
      const est = computeEstimate(d.area_m2);
      return {
        lat: d.center ? d.center.lat : 0,
        lng: d.center ? d.center.lng : 0,
        area_m2: d.area_m2,
        confidence: d.confidence,
        price_eur: est.price_ht,
        cleaning_min: est.cleaning_min,
      };
    });
    const res = await window.solarAPI.exportCSV(rows);
    if (res.ok) Toast.show(`CSV exporté`, 'success');
    else if (res.reason !== 'cancelled') Toast.show('Erreur export CSV', 'error');
  });

  const $clientModal = document.getElementById('client-modal');
  const $btnClientCancel = document.getElementById('btn-client-cancel');
  const $btnClientConfirm = document.getElementById('btn-client-confirm');
  const $inputClientName = document.getElementById('client-name');
  const $inputClientAddress = document.getElementById('client-address');

  $btnExportPDF.addEventListener('click', async () => {
    if (!_detections.length || !window.solarAPI) return;
    $clientModal.style.display = 'flex';
    
    // Pré-remplir automatiquement l'adresse avec le premier panneau détecté
    if (!$inputClientAddress.value) {
      try {
        const firstDet = _detections[0];
        if (firstDet && firstDet.center) {
          $inputClientAddress.placeholder = "Recherche de l'adresse en cours...";
          const { lat, lng } = firstDet.center;
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
            headers: { 'Accept-Language': 'fr' }
          });
          const data = await res.json();
          if (data && data.address) {
            const addr = data.address;
            const houseNumber = addr.house_number || '';
            const road = addr.road || addr.pedestrian || addr.suburb || '';
            const city = addr.city || addr.town || addr.village || addr.municipality || '';
            const postcode = addr.postcode || '';
            
            if (road && city) {
               $inputClientAddress.value = `${houseNumber} ${road}, ${postcode} ${city}`.trim();
            } else {
               $inputClientAddress.value = data.display_name;
            }
          }
        }
      } catch (err) {
        console.error("Erreur géocodage:", err);
      } finally {
        $inputClientAddress.placeholder = "Ex: 7 lot la prade, Landogne";
      }
    }
  });

  $btnClientCancel.addEventListener('click', () => {
    $clientModal.style.display = 'none';
  });

  $btnClientConfirm.addEventListener('click', async () => {
    $clientModal.style.display = 'none';
    
    if (!_detections.length || !window.solarAPI) return;
    
    // Attendre que la modale disparaisse visuellement de l'écran avant de capturer
    await new Promise(resolve => setTimeout(resolve, 600));

    Toast.show('Génération du devis en cours...', 'info', 5000);

    const clientInfo = {
      name: $inputClientName.value || 'Client Anonyme',
      address: $inputClientAddress.value || 'Adresse non spécifiée',
    };

    let mapDataUrl = '';
    const mapEl = document.getElementById('map');
    if (mapEl && window.solarAPI.captureRect) {
      const rect = mapEl.getBoundingClientRect();
      const bounds = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
      mapDataUrl = await window.solarAPI.captureRect(bounds);
    }

    const html = _buildPDFHTML(clientInfo, mapDataUrl);
    const res = await window.solarAPI.exportPDF(html);
    if (res.ok) Toast.show(`Devis PDF exporté avec succès !`, 'success');
    else if (res.reason !== 'cancelled') Toast.show('Erreur export PDF', 'error');
  });

  function _buildPDFHTML(clientInfo, mapDataUrl) {
    const now = new Date().toLocaleDateString('fr-FR', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const total_area = _detections.reduce((s, d) => s + d.area_m2, 0);
    const total_price_ht = _detections.reduce((s, d) => s + computeEstimate(d.area_m2).price_ht, 0);
    const tva_amount = total_price_ht * _settings.vat_rate;
    const total_price_ttc = total_price_ht + tva_amount;
    const total_time = _detections.reduce((s, d) => s + computeEstimate(d.area_m2).cleaning_min, 0);

    const rows = _detections.map((d, i) => {
      const est = computeEstimate(d.area_m2);
      return `
        <tr>
          <td>#PAN-${String(i + 1).padStart(4, '0')}</td>
          <td>Nettoyage panneau photovoltaïque</td>
          <td>${d.area_m2.toFixed(1)}</td>
          <td>${est.unitPrice.toFixed(2)} €</td>
          <td>${est.price_ht.toFixed(2)} €</td>
        </tr>`;
    }).join('');

    const logoHtml = _settings.company_logo 
      ? `<img src="${_settings.company_logo}" class="logo" />` 
      : `<div class="logo-placeholder">${_settings.company_name || 'Votre Société'}</div>`;

    const mapHtml = mapDataUrl 
      ? `<div class="map-container">
           <h4>Aperçu des zones détectées</h4>
           <img src="${mapDataUrl}" />
         </div>`
      : '';

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<title>Devis - Nettoyage Panneaux</title>
<style>
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 13px; color: #333; margin: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
  .company-info { max-width: 250px; }
  .company-name { font-size: 20px; font-weight: bold; color: #1a1a2e; margin-bottom: 5px; }
  .logo { max-height: 80px; max-width: 200px; margin-bottom: 15px; }
  .logo-placeholder { font-size: 24px; font-weight: 800; color: #00b894; margin-bottom: 15px; }
  
  .document-title { font-size: 28px; font-weight: 300; color: #00b894; margin: 0; text-transform: uppercase; letter-spacing: 2px; text-align: right; }
  
  .meta-row { display: flex; justify-content: space-between; margin-bottom: 40px; }
  .client-info { background: #f8f9fa; padding: 20px; border-left: 4px solid #00b894; width: 300px; }
  .client-info h4 { margin: 0 0 10px 0; color: #666; font-size: 11px; text-transform: uppercase; }
  .client-info .c-name { font-size: 16px; font-weight: bold; margin-bottom: 5px; }
  
  .invoice-details { text-align: right; }
  .invoice-details table { width: 100%; text-align: right; border-collapse: collapse; }
  .invoice-details th { color: #888; font-weight: normal; font-size: 12px; padding: 4px 15px 4px 0; text-align: right; }
  
  .map-container { margin: 30px 0; border: 1px solid #ddd; padding: 10px; background: #fff; text-align: center; border-radius: 4px; }
  .map-container h4 { margin: 0 0 10px 0; font-size: 12px; color: #555; text-transform: uppercase; }
  .map-container img { max-width: 100%; max-height: 350px; border-radius: 2px; object-fit: contain; }
  
  .items-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  .items-table th { background: #1a1a2e; color: #fff; padding: 10px; text-align: left; font-size: 11px; text-transform: uppercase; }
  .items-table th:last-child { text-align: right; }
  .items-table td { padding: 12px 10px; border-bottom: 1px solid #eee; }
  .items-table td:last-child { text-align: right; font-weight: bold; }
  
  .totals-container { display: flex; justify-content: flex-end; margin-top: 20px; }
  .totals-table { width: 300px; border-collapse: collapse; }
  .totals-table td { padding: 8px 10px; border-bottom: 1px solid #eee; }
  .totals-table tr.ttc td { font-size: 16px; font-weight: bold; background: #f0faf8; color: #00b894; border-bottom: none; }
  
  .footer { margin-top: 60px; font-size: 10px; color: #999; border-top: 1px solid #eee; padding-top: 15px; text-align: center; }
  .note { background: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 10px 15px; margin-top: 30px; font-size: 12px; border-radius: 4px; }
  
  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); opacity: 0.05; z-index: -1; pointer-events: none; max-width: 80%; max-height: 80%; }
  .watermark-text { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); opacity: 0.05; z-index: -1; pointer-events: none; font-size: 100px; font-weight: bold; color: #000; white-space: nowrap; }
</style>
</head><body>

${_settings.company_logo ? `<img src="${_settings.company_logo}" class="watermark" />` : `<div class="watermark-text">${_settings.company_name || 'SolarScan'}</div>`}

<div class="header">
  <div class="company-info">
    ${logoHtml}
    <div class="company-name">${_settings.company_name || 'Votre Société'}</div>
    <div>${_settings.company_address ? _settings.company_address.replace(/\n/g, '<br/>') : 'Adresse de votre société'}</div>
    <div style="margin-top: 5px; color: #666;">${_settings.company_siret || 'SIRET: XXX XXX XXX'}</div>
  </div>
  <div>
    <h1 class="document-title">DEVIS</h1>
  </div>
</div>

<div class="meta-row">
  <div class="client-info">
    <h4>Facturé à</h4>
    <div class="c-name">${clientInfo.name}</div>
    <div>${clientInfo.address.replace(/\n/g, '<br/>')}</div>
  </div>
  <div class="invoice-details">
    <table>
      <tr><th>Date :</th><td>${now}</td></tr>
      <tr><th>Validité :</th><td>30 jours</td></tr>
    </table>
  </div>
</div>

${mapHtml}

<table class="items-table">
  <thead>
    <tr>
      <th>Réf</th>
      <th>Désignation</th>
      <th>Surface (m²)</th>
      <th>Prix Unitaire HT</th>
      <th>Total HT</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<div class="totals-container">
  <table class="totals-table">
    <tr>
      <td>Total Net HT</td>
      <td style="text-align: right;">${total_price_ht.toFixed(2)} €</td>
    </tr>
    <tr>
      <td>TVA (${(_settings.vat_rate * 100).toFixed(1)}%)</td>
      <td style="text-align: right;">${tva_amount.toFixed(2)} €</td>
    </tr>
    <tr class="ttc">
      <td>Total TTC</td>
      <td style="text-align: right;">${total_price_ttc.toFixed(2)} €</td>
    </tr>
  </table>
</div>

<div class="note">
  <strong>Note :</strong> Ce devis est une estimation générée automatiquement via imagerie satellite. La surface totale détectée est de <strong>${total_area.toFixed(1)} m²</strong>, avec un temps de nettoyage estimé de <strong>${total_time >= 60 ? (total_time/60).toFixed(1)+'h' : total_time.toFixed(0)+'min'}</strong>.
</div>

<div class="footer">
  ${_settings.company_name || 'Votre Société'} - ${_settings.company_siret || 'SIRET Non renseigné'}<br/>
  Généré par SolarScanner
</div>

</body></html>`;
  }

  return { setDetections, clearDetections, onSelectDetection, getSettings, loadSettings, computeEstimate };
})();

// ── Toast notification system ──────────────────────────────
window.Toast = (() => {
  const $container = document.getElementById('toast-container');

  function show(message, type = 'info', duration = 3000) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    el.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    $container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  return { show };
})();
