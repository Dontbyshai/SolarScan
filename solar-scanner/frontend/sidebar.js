/**
 * sidebar.js — Panneau latéral : stats, liste des détections, exports
 */

window.Sidebar = (() => {
  'use strict';

  let _detections = [];
  let _tournee = [];
  
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
    company_name: 'Solar Scanner',
    company_address: '123 Avenue de l\'Innovation, 75000 Paris',
    company_siret: '123 456 789 00010',
    company_logo: '',
    quote_validity_days: 30,
    next_quote_number: 1,
    roi_prod_kwh: 200, // Production moyenne kWh/m²/an
    roi_price_kwh: 0.25, // Prix du kWh moyen en €
    roi_loss_percent: 15, // Pourcentage de perte due à l'encrassement
  };
  let _onSelectDetection = null;

  // Options d'intervention (Business factors)
  let _businessOptions = [
    { id: 'opt-steep', label: 'Toit très incliné (+20%)', type: 'multiplier', value: 1.2, checked: false },
    { id: 'opt-lift', label: 'Nacelle requise (+150€)', type: 'fixed', value: 150, checked: false },
    { id: 'opt-dirt', label: 'Encrassement extrême (+30%)', type: 'multiplier', value: 1.3, checked: false },
    { id: 'opt-moss', label: 'Présence de lichens (+15%)', type: 'multiplier', value: 1.15, checked: false },
  ];
  let _confidenceMin = 0;
  let _tourneeSummary = null;


  function syncRangeFill(el) {
    if (!el) return;
    const min = Number(el.min) || 0;
    const max = Number(el.max) || 100;
    const val = Number(el.value) || 0;
    const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
    el.style.setProperty('--range-pct', `${pct}%`);
  }

  function escapeText(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isBillable(d) {
    if (!d || d.checked === false) return false;
    const conf = typeof d.confidence === 'number' ? d.confidence : 1;
    return conf + 1e-9 >= _confidenceMin;
  }

  function exportFailToast(prefix, resOrErr) {
    const reason = (resOrErr && (resOrErr.reason || resOrErr.message))
      ? String(resOrErr.reason || resOrErr.message)
      : 'erreur inconnue';
    const msg = prefix + ' : ' + reason;
    Toast.show(msg, 'error', 7000);
    if (window.solarAPI && window.solarAPI.logError) {
      window.solarAPI.logError(msg, resOrErr && resOrErr.stack ? String(resOrErr.stack) : '');
    } else {
      console.error(msg, resOrErr);
    }
  }

  function iconSvg(name) {
    return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function quoteTotals(list) {
    const area = list.reduce((s, d) => s + d.area_m2, 0);
    let ht = list.reduce((s, d) => s + computeEstimate(d.area_m2).price_ht, 0);
    _businessOptions.forEach((opt) => {
      if (!opt.checked) return;
      if (opt.type === 'multiplier') ht *= opt.value;
      else if (opt.type === 'fixed') ht += opt.value;
      else if (opt.type === 'per_m2') ht += area * opt.value;
    });
    return { area, ht, ttc: ht * (1 + _settings.vat_rate) };
  }

  // ── Session Storage ────────────────────────────────────────
  function _saveSessionToStorage() {
    try {
      localStorage.setItem('solarscan_session', JSON.stringify({
        detections: _detections,
        tournee: _tournee,
        businessOptions: _businessOptions,
        confidenceMin: _confidenceMin,
      }));
    } catch (e) {
      console.warn("Erreur sauvegarde session locale:", e);
    }
  }

  function _loadSessionFromStorage() {
    try {
      const data = localStorage.getItem('solarscan_session');
      if (data) {
        const session = JSON.parse(data);
        if (session.detections) _detections = session.detections;
        if (session.tournee) _tournee = session.tournee;
        if (session.businessOptions) _businessOptions = session.businessOptions;
        if (typeof session.confidenceMin === 'number') {
          _confidenceMin = Math.min(0.9, Math.max(0, session.confidenceMin));
          const slider = document.getElementById('confidence-min');
          const label = document.getElementById('confidence-min-label');
          if (slider) {
            slider.value = String(Math.round(_confidenceMin * 100));
            syncRangeFill(slider);
          }
          if (label) label.textContent = `${Math.round(_confidenceMin * 100)} %`;
        }
        
        // Restore polygons on map if possible
        if (_detections.length > 0) {
          setTimeout(() => {
            if (window.MapController && window.MapController.displayDetectionsDirect) {
              window.MapController.displayDetectionsDirect(_detections);
            }
          }, 500);
        }
        if (_tournee.length > 0) {
          _renderTournee();
        }
      }
    } catch (e) {
      console.warn("Erreur chargement session locale:", e);
    }
  }

  // ── DOM refs ─────────────────────────────────────────────
  const $count     = document.getElementById('stat-count');
  const $area      = document.getElementById('stat-area');
  const $price     = document.getElementById('stat-price');
  const $list      = document.getElementById('detection-list');
  const $sidebar   = document.getElementById('sidebar');

  const $btnExportCSV     = document.getElementById('btn-export-csv');
  const $btnManageOptions = document.getElementById('btn-manage-options');
  const $btnExportPDF     = document.getElementById('btn-export-pdf');
  const $btnClearResults  = document.getElementById('btn-clear-results');
  
  // Project Management
  const $btnSaveProject = document.getElementById('btn-save-project');
  const $btnOpenProject = document.getElementById('btn-open-project');
  const $businessOptionsContainer = document.getElementById('business-options-container');

  // Tournée
  const $btnOpenTournee = document.getElementById('btn-open-tournee');
  const $tourneeModal = document.getElementById('tournee-modal');
  const $btnCloseTournee = document.getElementById('btn-close-tournee');
  const $btnCalcTournee = document.getElementById('btn-calc-tournee');
  const $btnClearTournee = document.getElementById('btn-clear-tournee');
  const $tourneeTbody = document.getElementById('tournee-tbody');
  const $btnAddTournee = document.getElementById('btn-add-tournee');

  // ── Settings panel refs ───────────────────────────────────
  const $settingsPanel  = document.getElementById('settings-panel');
  const $btnSettings    = document.getElementById('btn-settings');
  const $btnSave        = document.getElementById('btn-save-settings');
  const $btnClose       = document.getElementById('btn-close-settings');
  const $btnClearCache  = document.getElementById('btn-clear-cache');
  
  // Custom Options panel refs
  const $optionsModal     = document.getElementById('options-modal');
  const $btnOptionsCancel = document.getElementById('btn-options-cancel');
  const $btnOptionsSave   = document.getElementById('btn-options-save');
  const $btnAddOption     = document.getElementById('btn-add-option');
  const $optionsTbody     = document.getElementById('options-tbody');

  
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

  // ROI Settings
  const $inputRoiProd = document.getElementById('setting-roi-prod');
  const $inputRoiPrice = document.getElementById('setting-roi-price');
  const $inputRoiLoss = document.getElementById('setting-roi-loss');
  const $inputMileageCost = document.getElementById('setting-mileage-cost');

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

    _settings.roi_prod_kwh = parseFloat($inputRoiProd.value) || 200;
    _settings.roi_price_kwh = parseFloat($inputRoiPrice.value) || 0.25;
    _settings.roi_loss_percent = parseFloat($inputRoiLoss.value) || 15;
    _settings.mileage_cost = parseFloat($inputMileageCost.value) || 0.5;
    const validityInput = document.getElementById('setting-validity');
    const quoteNextInput = document.getElementById('setting-quote-next');
    _settings.quote_validity_days = Math.min(365, parseInt(validityInput && validityInput.value, 10) || 30);
    _settings.next_quote_number = Math.max(1, parseInt(quoteNextInput && quoteNextInput.value, 10) || 1);

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

  async function loadSettings() {
    if (!window.solarAPI) return;
    const saved = await window.solarAPI.getSettings();
    if (saved && Object.keys(saved).length) {
      _settings = { ..._settings, ...saved };
      
      if (saved.business_options && Array.isArray(saved.business_options)) {
        _businessOptions = saved.business_options.map(opt => ({ ...opt, checked: false }));
      }
      
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

      $inputRoiProd.value = _settings.roi_prod_kwh !== undefined ? _settings.roi_prod_kwh : 200;
      $inputRoiPrice.value = _settings.roi_price_kwh !== undefined ? _settings.roi_price_kwh : 0.25;
      $inputRoiLoss.value = _settings.roi_loss_percent !== undefined ? _settings.roi_loss_percent : 15;
      $inputMileageCost.value = _settings.mileage_cost !== undefined ? _settings.mileage_cost : 0.5;
      const validityInput = document.getElementById('setting-validity');
      const quoteNextInput = document.getElementById('setting-quote-next');
      if (validityInput) validityInput.value = _settings.quote_validity_days || 30;
      if (quoteNextInput) quoteNextInput.value = _settings.next_quote_number || 1;

      if (_settings.company_logo && _settings.company_logo.length > 10) {
        $logoPreview.src = _settings.company_logo;
        $logoPreview.style.display = 'block';
      }
    }
    _loadSessionFromStorage();
  }

  function getPriceForArea(area_m2) {
    if (!_settings.price_tiers) return 3.0;
    for (const tier of _settings.price_tiers) {
      if (tier.max == null || area_m2 <= tier.max) return tier.price;
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

  function getBusinessOptions() {
    return _businessOptions;
  }

  function _renderBusinessOptions() {
    if (!_detections || _detections.length === 0) {
      if ($businessOptionsContainer) $businessOptionsContainer.innerHTML = '';
      return;
    }
    
    if ($businessOptionsContainer) {
      let html = '<div class="business-options-title">Options d\'intervention</div>';
      
      _businessOptions.forEach((opt, idx) => {
        html += `
          <label class="business-opt-label">
            <input type="checkbox" data-idx="${idx}" ${opt.checked ? 'checked' : ''} class="business-opt-cb">
            <span>${escapeText(opt.label)}</span>
          </label>
        `;
      });
      
      $businessOptionsContainer.innerHTML = html;
      
      $businessOptionsContainer.querySelectorAll('.business-opt-cb').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          _businessOptions[idx].checked = e.target.checked;
          _render();
        });
      });
    }

    _saveSessionToStorage();
  }

  // ── Render ────────────────────────────────────────────────
  function _render() {
    const active_detections = _detections.filter(isBillable);
    const totals = quoteTotals(active_detections);
    const total_area = totals.area;
    const total_price = totals.ht;

    _renderBusinessOptions();

    // Mettre à jour le compteur global pour refléter la sélection vs total
    $count.textContent = `${active_detections.length}/${_detections.length}`;
    $area.innerHTML = _detections.length > 0
      ? `${total_area.toFixed(0)}<span class="stat-unit">m²</span>`
      : `0<span class="stat-unit">m²</span>`;
    $price.innerHTML = _detections.length > 0
      ? `${total_price.toFixed(0)}<span class="stat-unit">€</span>`
      : `0<span class="stat-unit">€</span>`;

    const hasResults = _detections.length > 0;
    const hasBillable = active_detections.length > 0;
    if ($btnExportPDF) $btnExportPDF.disabled = !hasBillable;
    if ($btnClearResults) $btnClearResults.disabled = !hasResults;
    if ($btnSaveProject) $btnSaveProject.disabled = !hasResults;
    if ($btnExportCSV) $btnExportCSV.disabled = !hasBillable;
    const $merge = document.getElementById('btn-merge-duplicates');
    if ($merge) $merge.disabled = _detections.length < 2;

    if (!hasResults) {
      $list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${iconSvg('satellite')}</div>
          <div class="empty-title">Aucune détection</div>
          <div class="empty-desc">Cliquez sur Scanner (zoom ≥ 17, fond IGN) ou dessinez un panneau.</div>
        </div>`;
      _saveSessionToStorage();
      return;
    }

    $list.innerHTML = _detections.map((d, i) => {
      const est = computeEstimate(d.area_m2);
      const conf = d.confidence;
      const confClass = conf >= 0.75 ? 'high' : conf >= 0.5 ? 'medium' : 'low';
      const confLabel = conf >= 0.75 ? 'Haute' : conf >= 0.5 ? 'Moyenne' : 'Basse';
      const below = (typeof conf === 'number' ? conf : 1) < _confidenceMin;
      const isChecked = !below && d.checked !== false ? 'checked' : '';
      const opacity = !below && d.checked !== false ? '1.0' : '0.5';
      const label = d.label || '#PAN-' + String(i + 1).padStart(4, '0');

      return `
        <div class="detection-item" data-idx="${i}" role="button" tabindex="0" aria-label="Panneau ${i + 1}" style="opacity: ${opacity};">
          <input type="checkbox" class="detection-checkbox" data-idx="${i}" ${isChecked} ${below ? 'disabled' : ''} title="Inclure dans le total" style="margin-right: 12px; transform: scale(1.2); cursor: pointer;">
          <div class="detection-badge ${confClass}"></div>
          <div class="detection-info">
            <input type="text" class="detection-label-input" data-idx="${i}" value="${escapeText(label)}" />
            <div class="detection-area">${d.area_m2.toFixed(1)} m²</div>
            <div class="detection-meta">
              <span class="conf-line ${confClass}">${confLabel} (${(conf * 100).toFixed(0)}%)${below ? ' · sous le seuil' : ''}</span>
              <span class="meta-line">${iconSvg('pin')} ${d.center ? d.center.lat.toFixed(5) + ', ' + d.center.lng.toFixed(5) : '—'}</span>
            </div>
          </div>
          <div class="detection-price">${est.price_ht.toFixed(0)}€</div>
          <button class="btn-delete-zone" data-idx="${i}" title="Supprimer la zone">${iconSvg('trash')}</button>
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

    // Label input events
    $list.querySelectorAll('.detection-label-input').forEach((input) => {
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        _detections[idx].label = e.target.value;
        _saveSessionToStorage();
      });
    });

    // Delete events
    $list.querySelectorAll('.btn-delete-zone').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Évite de déclencher le clic sur l'item complet
        const idx = parseInt(btn.dataset.idx);
        if (window.MapController) {
          window.MapController.deleteDetection(idx);
        }
      });
    });

    _saveSessionToStorage();
  }

  // ── Exports ───────────────────────────────────────────────
  $btnClearResults.addEventListener('click', () => {
    clearDetections();
    if (window.MapController) window.MapController.clearDetections();
  });

  // ── Custom Options Manager ──────────────────────────────
  function _syncOptionsFromDOM() {
    const rows = $optionsTbody.querySelectorAll('tr');
    rows.forEach((tr, i) => {
      if (_businessOptions[i]) {
        _businessOptions[i].label = tr.querySelector('.opt-label').value;
        _businessOptions[i].type = tr.querySelector('.opt-type').value;
        _businessOptions[i].value = parseFloat(tr.querySelector('.opt-value').value) || 0;
      }
    });
  }

  function _renderOptionsTable() {
    $optionsTbody.innerHTML = '';
    _businessOptions.forEach((opt, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" class="opt-label" value="${escapeText(opt.label)}"></td>
        <td>
          <select class="opt-type">
            <option value="multiplier" ${opt.type==='multiplier'?'selected':''}>Multiplicateur (ex: 1.2)</option>
            <option value="fixed" ${opt.type==='fixed'?'selected':''}>Frais Fixe (€)</option>
            <option value="per_m2" ${opt.type==='per_m2'?'selected':''}>Par m² (€/m²)</option>
          </select>
        </td>
        <td><input type="number" step="0.01" class="opt-value" value="${opt.value}"></td>
        <td><button class="btn btn-ghost btn-danger btn-small" data-idx="${i}">X</button></td>
      `;
      $optionsTbody.appendChild(tr);
      
      tr.querySelector('button').addEventListener('click', () => {
        _syncOptionsFromDOM();
        _businessOptions.splice(i, 1);
        _renderOptionsTable();
      });
    });
  }

  $btnManageOptions.addEventListener('click', () => {
    _renderOptionsTable();
    $optionsModal.style.display = 'flex';
  });

  $btnOptionsCancel.addEventListener('click', () => {
    $optionsModal.style.display = 'none';
  });

  $btnAddOption.addEventListener('click', () => {
    _syncOptionsFromDOM();
    _businessOptions.push({
      id: 'opt-custom-' + Date.now(),
      label: 'Nouvelle option',
      type: 'fixed',
      value: 0,
      checked: false
    });
    _renderOptionsTable();
  });

  $btnOptionsSave.addEventListener('click', async () => {
    _syncOptionsFromDOM();
    _settings.business_options = _businessOptions.map(opt => ({ ...opt, checked: false }));
    
    if (window.solarAPI) {
      await window.solarAPI.saveSettings(_settings);
    }
    $optionsModal.style.display = 'none';
    _render();
    Toast.show('Options enregistrées', 'success');
  });

  if ($btnExportCSV) {
    $btnExportCSV.addEventListener('click', async () => {
      if (!_detections.length || !window.solarAPI) return;
    const rows = _detections.filter(isBillable).map((d) => {
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
    else if (res.reason !== 'cancelled') exportFailToast('Erreur export CSV', res);
  });
  }

  const $clientModal = document.getElementById('client-modal');
  const $btnClientCancel = document.getElementById('btn-client-cancel');
  const $btnClientConfirm = document.getElementById('btn-client-confirm');
  const $inputClientName = document.getElementById('client-name');
  const $inputClientAddress = document.getElementById('client-address');

  // ── Project Management ────────────────────────────────────
  if ($btnSaveProject) {
    $btnSaveProject.addEventListener('click', async () => {
      if (!_detections.length || !window.solarAPI) return;
      const projectData = {
        version: '1.5.1',
        date: new Date().toISOString(),
        detections: _detections,
        businessOptions: _businessOptions,
        confidenceMin: _confidenceMin,
        mapState: window.MapController ? window.MapController.getState() : null
      };
      
      const res = await window.solarAPI.saveProject(projectData);
      if (res.ok) Toast.show('Projet sauvegardé avec succès', 'success');
      else if (res.reason !== 'cancelled') exportFailToast('Erreur lors de la sauvegarde', res);
    });
  }

  if ($btnOpenProject) {
    $btnOpenProject.addEventListener('click', async () => {
      if (!window.solarAPI) return;
      const res = await window.solarAPI.openProject();
      
      if (res.ok && res.data) {
        // Restaurer le projet
        const data = res.data;
        if (data.businessOptions) {
          _businessOptions = data.businessOptions;
        }
        if (typeof data.confidenceMin === 'number') {
          _confidenceMin = Math.min(0.9, Math.max(0, data.confidenceMin));
          const slider = document.getElementById('confidence-min');
          const label = document.getElementById('confidence-min-label');
          if (slider) {
            slider.value = String(Math.round(_confidenceMin * 100));
            syncRangeFill(slider);
          }
          if (label) label.textContent = `${Math.round(_confidenceMin * 100)} %`;
        }
        if (data.detections) {
          if (window.MapController && window.MapController.displayDetectionsDirect) {
            window.MapController.displayDetectionsDirect(data.detections);
          } else {
            setDetections(data.detections);
          }
        }
        if (data.mapState && window.MapController && window.MapController.setState) {
          window.MapController.setState(data.mapState);
        }
        Toast.show('Projet chargé avec succès !', 'success');
      } else if (res.reason !== 'cancelled') {
        exportFailToast('Fichier invalide ou corrompu', res);
      }
    });
  }

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
          const res = await SolarApi.request(`/geocode/reverse?lat=${lat}&lon=${lng}`);
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

  if ($btnAddTournee) {
    $btnAddTournee.addEventListener('click', () => {
      if (!_detections.length) return;
      const name = $inputClientName.value || 'Client sans nom';
      const address = $inputClientAddress.value || 'Adresse inconnue';
      
      const active_detections = _detections.filter(d => d.checked !== false);
      const total_area = active_detections.reduce((s, d) => s + d.area_m2, 0);
      let total_price = active_detections.reduce((s, d) => s + computeEstimate(d.area_m2).price_ht, 0);

      _businessOptions.forEach(opt => {
        if (opt.checked) {
          if (opt.type === 'multiplier') total_price *= opt.value;
          else if (opt.type === 'fixed') total_price += opt.value;
          else if (opt.type === 'per_m2') total_price += (total_area * opt.value);
        }
      });
      
      const center = _detections[0].center; 
      
      _tournee.push({ name, address, price: total_price, center });
      _renderTournee();
      $clientModal.style.display = 'none';
      
      Toast.show('Client ajouté à la tournée !', 'success');
      
      // Optionally clear the detections so we can scan another one
      clearDetections();
    });
  }

  $btnClientConfirm.addEventListener('click', async () => {
    const billableNow = _detections.filter(isBillable);
    if (!billableNow.length) {
      Toast.show('Aucun panneau au-dessus du seuil de confiance', 'warning');
      return;
    }
    $clientModal.style.display = 'none';

    if (!window.solarAPI) return;

    try {
      // Attendre que la modale disparaisse visuellement de l'écran avant de capturer
      await new Promise(resolve => setTimeout(resolve, 600));

      Toast.show('Génération du devis en cours...', 'info', 8000);

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
        mapDataUrl = await window.solarAPI.captureRect(bounds) || '';
      }

      if (window.PDFGenerator.compactImage) {
        mapDataUrl = await window.PDFGenerator.compactImage(mapDataUrl, {
          maxWidth: 1600,
          maxHeight: 1100,
          quality: 0.82,
          maxChars: 800000,
          format: 'image/jpeg',
        });
      }

      const settingsForPdf = Object.assign({}, _settings);
      if (window.PDFGenerator.compactImage && _settings.company_logo) {
        settingsForPdf.company_logo = await window.PDFGenerator.compactImage(_settings.company_logo, {
          maxWidth: 400,
          maxHeight: 160,
          quality: 0.9,
          maxChars: 220000,
          format: 'image/png',
        });
      }

      const billable = _detections.filter(isBillable);
      const totals = quoteTotals(billable);
      const numero = window.PDFGenerator.quoteNumber(_settings);
      const html = window.PDFGenerator.build(clientInfo, mapDataUrl, billable, settingsForPdf, _businessOptions, computeEstimate);
      const res = await window.solarAPI.exportPDF(html, `${numero}.pdf`);
      if (res.ok) {
        const current = parseInt(_settings.next_quote_number, 10) || 1;
        _settings.next_quote_number = current + 1;
        const quoteNextInput = document.getElementById('setting-quote-next');
        if (quoteNextInput) quoteNextInput.value = _settings.next_quote_number;
        if (window.solarAPI.saveSettings) {
          const saved = await window.solarAPI.saveSettings(_settings);
          if (saved && saved.ok === false) {
            Toast.show("Devis enregistré, mais les réglages n'ont pas pu être sauvés : " + (saved.reason || 'erreur'), 'warning', 7000);
          }
        }
        if (window.solarAPI.appendHistory) {
          await window.solarAPI.appendHistory({
            id: String(Date.now()),
            date: new Date().toISOString(),
            numero,
            client: clientInfo.name,
            adresse: clientInfo.address,
            panneaux: billable.length,
            surface_m2: totals.area,
            prix_ht: totals.ht,
            prix_ttc: totals.ttc,
            fichier: res.filePath || '',
          });
        }
        Toast.show(`Devis ${numero} exporté`, 'success');
      } else if (res.reason !== 'cancelled') {
        exportFailToast('Erreur export PDF', res);
      }
    } catch (err) {
      exportFailToast('Erreur export PDF', err);
    }
  });



  // ── Tournée Logic ─────────────────────────────────────────
  function _renderTournee() {
    _tourneeSummary = null;
    if ($btnOpenTournee) {
      $btnOpenTournee.innerHTML = `${iconSvg('route')} Ma Tournée (${_tournee.length})`;
    }
    
    if ($tourneeTbody) {
      $tourneeTbody.innerHTML = _tournee.map((t, i) => `
        <tr>
          <td>
            ${i === 0 ? '<span title="Point de départ" class="tour-start">' + iconSvg('pin') + '</span>' : `<span class="tour-step">Étape ${i}</span>`}
          </td>
          <td>${escapeText(t.name)}</td>
          <td>${escapeText(t.address)}</td>
          <td style="text-align: right; font-weight: bold; display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
            ${Number(t.price || 0).toFixed(2)} €
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <button type="button" class="btn-icon-plain btn-up-tournee" data-idx="${i}" style="cursor: ${i === 0 ? 'not-allowed; opacity: 0.3;' : 'pointer;'}" title="Monter">${iconSvg('up')}</button>
              <button type="button" class="btn-icon-plain btn-down-tournee" data-idx="${i}" style="cursor: ${i === _tournee.length - 1 ? 'not-allowed; opacity: 0.3;' : 'pointer;'}" title="Descendre">${iconSvg('down')}</button>
            </div>
            <button type="button" class="btn-icon-plain btn-edit-tournee" data-idx="${i}" title="Modifier">${iconSvg('pencil')}</button>
            <button type="button" class="btn-icon-plain btn-delete-tournee" data-idx="${i}" title="Retirer">${iconSvg('trash')}</button>
          </td>
        </tr>
      `).join('');
      
      if (_tournee.length === 0) {
        $tourneeTbody.innerHTML = `
          <tr>
            <td colspan="4" style="text-align:center; padding: 20px; color: #888;">
              Aucun client dans la tournée.<br>
              <span style="font-size: 11px;">(Ajoutez au moins 2 clients avec le bouton "+" pour optimiser votre itinéraire)</span>
            </td>
          </tr>
        `;
      }

      $tourneeTbody.querySelectorAll('.btn-delete-tournee').forEach(btn => {
        btn.addEventListener('click', () => {
          _tournee.splice(parseInt(btn.dataset.idx, 10), 1);
          _renderTournee();
          if (window.MapController && window.MapController.clearRoute) {
            window.MapController.clearRoute();
          }
        });
      });

      $tourneeTbody.querySelectorAll('.btn-edit-tournee').forEach(btn => {
        btn.addEventListener('click', () => {
          _openTourneeEditModal(parseInt(btn.dataset.idx));
        });
      });
      
      $tourneeTbody.querySelectorAll('.btn-up-tournee').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          if (idx > 0) {
            const temp = _tournee[idx - 1];
            _tournee[idx - 1] = _tournee[idx];
            _tournee[idx] = temp;
            _renderTournee();
            if (window.MapController && window.MapController.clearRoute) {
              window.MapController.clearRoute();
            }
          }
        });
      });

      $tourneeTbody.querySelectorAll('.btn-down-tournee').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          if (idx < _tournee.length - 1) {
            const temp = _tournee[idx + 1];
            _tournee[idx + 1] = _tournee[idx];
            _tournee[idx] = temp;
            _renderTournee();
            if (window.MapController && window.MapController.clearRoute) {
              window.MapController.clearRoute();
            }
          }
        });
      });
    }
    
    const $tourneeResults = document.getElementById('tournee-results');
    if ($tourneeResults) $tourneeResults.style.display = 'none';
    
    const $btnGmaps = document.getElementById('btn-gmaps-tournee');
    if ($btnGmaps) $btnGmaps.style.display = 'none';
  }

  // Modals Tournée Edit & Add Logic
  const $tourneeAddModal = document.getElementById('tournee-add-modal');
  const $btnTourneeAddCancel = document.getElementById('btn-tournee-add-cancel');
  const $btnTourneeAddConfirm = document.getElementById('btn-tournee-add-confirm');
  const $inputTourneeAddName = document.getElementById('tournee-add-name');
  const $inputTourneeAddAddress = document.getElementById('tournee-add-address');

  const $tourneeEditModal = document.getElementById('tournee-edit-modal');
  const $btnTourneeEditCancel = document.getElementById('btn-tournee-edit-cancel');
  const $btnTourneeEditConfirm = document.getElementById('btn-tournee-edit-confirm');
  const $inputTourneeEditName = document.getElementById('tournee-edit-name');
  const $inputTourneeEditAddress = document.getElementById('tournee-edit-address');
  let _currentEditTourneeIdx = -1;

  const $btnAddTourneeQuick = document.getElementById('btn-add-tournee-quick');
  if ($btnAddTourneeQuick) {
    $btnAddTourneeQuick.addEventListener('click', async () => {
      $inputTourneeAddName.value = '';
      $inputTourneeAddAddress.value = '';
      if ($tourneeAddModal) $tourneeAddModal.style.display = 'flex';
      
      try {
        let center = null;
        if (_detections && _detections.length > 0 && _detections[0].center) {
          center = _detections[0].center;
        } else if (window.MapController && window.MapController.getState) {
          const state = window.MapController.getState();
          if (state && state.center) center = state.center;
        }
        
        if (center) {
          $tourneeAddModal.dataset.lat = center.lat;
          $tourneeAddModal.dataset.lng = center.lng;

          $inputTourneeAddAddress.placeholder = "Recherche de l'adresse en cours...";
          const { lat, lng } = center;
          const res = await SolarApi.request(`/geocode/reverse?lat=${lat}&lon=${lng}`);
          const data = await res.json();
          if (data && data.address) {
            const addr = data.address;
            const houseNumber = addr.house_number || '';
            const road = addr.road || addr.pedestrian || addr.suburb || '';
            const city = addr.city || addr.town || addr.village || addr.municipality || '';
            const postcode = addr.postcode || '';
            if (road && city) {
               $inputTourneeAddAddress.value = `${houseNumber} ${road}, ${postcode} ${city}`.trim();
            } else {
               $inputTourneeAddAddress.value = data.display_name;
            }
          }
        }
      } catch (err) {
        console.error("Erreur géocodage:", err);
      } finally {
        $inputTourneeAddAddress.placeholder = "Ex: 7 lot la prade, Landogne";
      }
    });
  }

  if ($btnTourneeAddCancel) {
    $btnTourneeAddCancel.addEventListener('click', () => $tourneeAddModal.style.display = 'none');
  }

  if ($btnTourneeAddConfirm) {
    $btnTourneeAddConfirm.addEventListener('click', () => {
      const name = $inputTourneeAddName.value || 'Client sans nom';
      const address = $inputTourneeAddAddress.value || 'Adresse inconnue';
      
      let total_price = 0;
      if (_detections && _detections.length > 0) {
        const active_detections = _detections.filter(d => d.checked !== false);
        const total_area = active_detections.reduce((s, d) => s + d.area_m2, 0);
        total_price = active_detections.reduce((s, d) => s + computeEstimate(d.area_m2).price_ht, 0);

        _businessOptions.forEach(opt => {
          if (opt.checked) {
            if (opt.type === 'multiplier') total_price *= opt.value;
            else if (opt.type === 'fixed') total_price += opt.value;
            else if (opt.type === 'per_m2') total_price += (total_area * opt.value);
          }
        });
      }
      
      const centerLat = parseFloat($tourneeAddModal.dataset.lat);
      const centerLng = parseFloat($tourneeAddModal.dataset.lng);
      
      if (isNaN(centerLat) || isNaN(centerLng)) {
         Toast.show("Impossible de récupérer la position GPS de la carte", "error");
         return;
      }
      
      const center = { lat: centerLat, lng: centerLng };
      
      _tournee.push({ name, address, price: total_price, center });
      _renderTournee();
      $tourneeAddModal.style.display = 'none';
      
      Toast.show('Ajouté à la tournée !', 'success');
      clearDetections();
      if (window.MapController && window.MapController.clearDetections) {
        window.MapController.clearDetections();
      }
      if (window.MapController && window.MapController.clearRoute) {
        window.MapController.clearRoute();
      }
    });
  }

  function _openTourneeEditModal(idx) {
    if (idx < 0 || idx >= _tournee.length) return;
    _currentEditTourneeIdx = idx;
    const client = _tournee[idx];
    $inputTourneeEditName.value = client.name;
    $inputTourneeEditAddress.value = client.address;
    if ($tourneeEditModal) $tourneeEditModal.style.display = 'flex';
  }

  if ($btnTourneeEditCancel) {
    $btnTourneeEditCancel.addEventListener('click', () => {
      $tourneeEditModal.style.display = 'none';
    });
  }

  if ($btnTourneeEditConfirm) {
    $btnTourneeEditConfirm.addEventListener('click', () => {
      if (_currentEditTourneeIdx >= 0 && _currentEditTourneeIdx < _tournee.length) {
        _tournee[_currentEditTourneeIdx].name = $inputTourneeEditName.value || 'Client sans nom';
        _tournee[_currentEditTourneeIdx].address = $inputTourneeEditAddress.value || 'Adresse inconnue';
        _renderTournee();
        Toast.show('Client modifié', 'success');
      }
      $tourneeEditModal.style.display = 'none';
    });
  }

  if ($btnOpenTournee) {
    $btnOpenTournee.addEventListener('click', () => {
      _renderTournee();
      $tourneeModal.style.display = 'flex';
    });
  }

  if ($btnCloseTournee) {
    $btnCloseTournee.addEventListener('click', () => {
      $tourneeModal.style.display = 'none';
    });
  }

  if ($btnClearTournee) {
    $btnClearTournee.addEventListener('click', () => {
      if (confirm('Voulez-vous vraiment vider la tournée ?')) {
        _tournee = [];
        _renderTournee();
        if (window.MapController && window.MapController.clearRoute) {
          window.MapController.clearRoute();
        }
      }
    });
  }

  if ($btnCalcTournee) {
    $btnCalcTournee.addEventListener('click', async () => {
      if (_tournee.length < 2) {
        Toast.show('Ajoutez au moins 2 clients à la tournée', 'error');
        return;
      }
      
      try {
        const res = await SolarApi.request('/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            points: _tournee.map((t) => ({ lat: t.center.lat, lng: t.center.lng })),
          }),
        });
        const data = await res.json();
        
        if (res.ok && data.code === 'Ok') {
          const route = data.routes[0];
          const distanceKm = route.distance / 1000;
          const timeMin = route.duration / 60;
          const totalRevenue = _tournee.reduce((s, t) => s + t.price, 0);
          
          const mileageCostRate = _settings.mileage_cost !== undefined ? _settings.mileage_cost : 0.5;
          const totalMileageCost = distanceKm * mileageCostRate;
          const totalFinal = totalRevenue + totalMileageCost;
          _tourneeSummary = {
            distanceKm,
            timeMin,
            mileageCost: totalMileageCost,
            total: totalFinal,
          };
          
          document.getElementById('tournee-distance').textContent = distanceKm.toFixed(1);
          document.getElementById('tournee-time').textContent = timeMin.toFixed(0);
          document.getElementById('tournee-revenue').textContent = totalRevenue.toFixed(0);
          document.getElementById('tournee-mileage-cost').textContent = totalMileageCost.toFixed(0);
          document.getElementById('tournee-total-final').textContent = totalFinal.toFixed(0);
          
          document.getElementById('tournee-results').style.display = 'block';
          
          // Generate Google Maps URL
          if (_tournee.length >= 2) {
            const origin = `${_tournee[0].center.lat},${_tournee[0].center.lng}`;
            const dest = `${_tournee[_tournee.length-1].center.lat},${_tournee[_tournee.length-1].center.lng}`;
            let gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}`;
            
            if (_tournee.length > 2) {
              const waypoints = _tournee.slice(1, -1).map(t => `${t.center.lat},${t.center.lng}`).join('|');
              gmapsUrl += `&waypoints=${waypoints}`;
            }
            
            const btnGmaps = document.getElementById('btn-gmaps-tournee');
            if (btnGmaps) {
              btnGmaps.dataset.url = gmapsUrl;
              btnGmaps.style.display = 'inline-block';
            }
          }
          
          if (window.MapController && window.MapController.drawRoute) {
            window.MapController.drawRoute(route.geometry, _tournee);
          }
          
          Toast.show('Itinéraire calculé avec succès !', 'success');
        } else {
          Toast.show('Erreur de calcul d\'itinéraire', 'error');
        }
      } catch (err) {
        Toast.show('Erreur réseau lors du calcul', 'error');
        console.error(err);
      }
    });
  }

  const $confidence = document.getElementById('confidence-min');
  const $confidenceLabel = document.getElementById('confidence-min-label');
  if ($confidence) {
    syncRangeFill($confidence);
    $confidence.addEventListener('input', () => {
      _confidenceMin = (parseInt($confidence.value, 10) || 0) / 100;
      if ($confidenceLabel) $confidenceLabel.textContent = `${parseInt($confidence.value, 10) || 0} %`;
      syncRangeFill($confidence);
      _render();
    });
  }

  const $mergeBtn = document.getElementById('btn-merge-duplicates');
  if ($mergeBtn) {
    $mergeBtn.addEventListener('click', () => {
      if (!window.GeoUtils || _detections.length < 2) return;
      const before = _detections.length;
      const merged = GeoUtils.mergeCloseDetections(_detections, 15);
      const removed = before - merged.length;
      if (window.MapController && window.MapController.displayDetectionsDirect) {
        window.MapController.displayDetectionsDirect(merged);
      } else {
        setDetections(merged);
      }
      Toast.show(
        removed > 0 ? `${removed} doublon(s) fusionné(s)` : 'Aucun doublon à moins de 15 m',
        removed ? 'success' : 'info'
      );
    });
  }

  const $historyModal = document.getElementById('history-modal');
  const $btnHistory = document.getElementById('btn-history');
  const $btnCloseHistory = document.getElementById('btn-close-history');
  const $btnExportHistory = document.getElementById('btn-export-history');
  const $historyBody = document.getElementById('history-tbody');

  async function renderHistory() {
    if (!$historyBody || !window.solarAPI || !window.solarAPI.getHistory) return;
    const rows = await window.solarAPI.getHistory();
    if (!rows || !rows.length) {
      $historyBody.innerHTML = '<tr><td colspan="6" class="table-empty">Aucun devis enregistré pour le moment.</td></tr>';
      return;
    }
    $historyBody.innerHTML = rows.map((row) => `
      <tr>
        <td>${escapeText(String(row.date || '').slice(0, 10))}</td>
        <td>${escapeText(row.numero)}</td>
        <td>${escapeText(row.client)}</td>
        <td>${escapeText(row.adresse)}</td>
        <td style="text-align:right;">${Number(row.prix_ttc || 0).toFixed(0)} €</td>
        <td class="history-actions">
          <button type="button" class="btn btn-ghost btn-sm btn-open-history" data-file="${escapeText(row.fichier || '')}">Ouvrir</button>
          <button type="button" class="btn btn-ghost btn-sm btn-reexport-history" data-file="${escapeText(row.fichier || '')}">Réexporter</button>
        </td>
      </tr>
    `).join('');
  }

  if ($btnHistory) {
    $btnHistory.addEventListener('click', async () => {
      await renderHistory();
      if ($historyModal) $historyModal.style.display = 'flex';
    });
  }
  if ($btnCloseHistory) {
    $btnCloseHistory.addEventListener('click', () => {
      if ($historyModal) $historyModal.style.display = 'none';
    });
  }
  if ($historyBody) {
    $historyBody.addEventListener('click', async (event) => {
      const openBtn = event.target.closest('.btn-open-history');
      const reexportBtn = event.target.closest('.btn-reexport-history');
      const btn = openBtn || reexportBtn;
      if (!btn || !window.solarAPI) return;
      const file = btn.getAttribute('data-file') || '';
      if (!file) {
        Toast.show('Aucun fichier associé à ce devis', 'warning');
        return;
      }
      try {
        const res = openBtn
          ? await window.solarAPI.openHistoryFile(file)
          : await window.solarAPI.reexportHistoryFile(file);
        if (res.ok) {
          Toast.show(openBtn ? 'Devis ouvert' : 'Devis réexporté', 'success');
        } else if (res.reason !== 'cancelled') {
          exportFailToast(openBtn ? "Impossible d'ouvrir le devis" : 'Réexport impossible', res);
        }
      } catch (err) {
        exportFailToast('Historique', err);
      }
    });
  }
  if ($btnExportHistory) {
    $btnExportHistory.addEventListener('click', async () => {
      if (!window.solarAPI || !window.solarAPI.exportHistoryCSV) return;
      const res = await window.solarAPI.exportHistoryCSV();
      if (res.ok) Toast.show('Historique exporté', 'success');
      else if (res.reason !== 'cancelled') exportFailToast('Export impossible', res);
    });
  }

  const $btnExportTour = document.getElementById('btn-export-tournee');
  if ($btnExportTour) {
    $btnExportTour.addEventListener('click', async () => {
      if (!_tournee.length || !window.solarAPI) {
        Toast.show('Ajoutez au moins un client à la tournée', 'warning');
        return;
      }
      try {
        const html = window.PDFGenerator.buildTourSheet(_tournee, _tourneeSummary, _settings);
        const res = await window.solarAPI.exportPDF(html, 'feuille_de_route.pdf');
        if (res.ok) Toast.show('Feuille de route exportée', 'success');
        else if (res.reason !== 'cancelled') exportFailToast('Erreur PDF', res);
      } catch (err) {
        exportFailToast('Erreur PDF', err);
      }
    });
  }

  const $btnGmapsTour = document.getElementById('btn-gmaps-tournee');
  if ($btnGmapsTour) {
    $btnGmapsTour.addEventListener('click', () => {
      const url = $btnGmapsTour.dataset.url || '';
      if (url.startsWith('https://www.google.com/maps/')) window.open(url, '_blank');
    });
  }

  return {
    setDetections,
    clearDetections,
    onSelectDetection,
    computeEstimate,
    getSettings,
    loadSettings,
    getBusinessOptions
  };
})();

// ── Toast notification system ──────────────────────────────
window.Toast = (() => {
  const $container = document.getElementById('toast-container');

  function show(message, type = 'info', duration = 3000) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const iconName = type === 'success' ? 'check' : type === 'error' ? 'x' : type === 'warning' ? 'alert' : 'info';
    const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ic.setAttribute('class', 'icon');
    ic.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + iconName);
    ic.appendChild(use);
    const text = document.createElement('span');
    text.textContent = String(message ?? '');
    el.appendChild(ic);
    el.appendChild(text);
    $container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  return { show };
})();
