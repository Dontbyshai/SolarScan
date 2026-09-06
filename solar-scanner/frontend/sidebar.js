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
    company_logo: '../assets/logo.png',
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

  // ── Session Storage ────────────────────────────────────────
  function _saveSessionToStorage() {
    try {
      localStorage.setItem('solarscan_session', JSON.stringify({
        detections: _detections,
        tournee: _tournee,
        businessOptions: _businessOptions
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

  function getBusinessOptions() {
    return _businessOptions;
  }

  function _renderBusinessOptions() {
    if (!_detections || _detections.length === 0) {
      if ($businessOptionsContainer) $businessOptionsContainer.innerHTML = '';
      return;
    }
    
    if ($businessOptionsContainer) {
      let html = '<div style="font-size: 13px; font-weight: 600; color: #a1a1aa; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Options d\'intervention</div>';
      
      _businessOptions.forEach((opt, idx) => {
        html += `
          <label class="business-opt-label">
            <input type="checkbox" data-idx="${idx}" ${opt.checked ? 'checked' : ''} class="business-opt-cb">
            <span>${opt.label}</span>
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
    // Ne calculer le total que pour les détections cochées (par défaut true)
    const active_detections = _detections.filter(d => d.checked !== false);
    const total_area = active_detections.reduce((s, d) => s + d.area_m2, 0);
    let total_price = active_detections.reduce((s, d) => s + computeEstimate(d.area_m2).price_ht, 0);

    // Appliquer les options métier (business options)
    _businessOptions.forEach(opt => {
      if (opt.checked) {
        if (opt.type === 'multiplier') total_price *= opt.value;
        else if (opt.type === 'fixed') total_price += opt.value;
        else if (opt.type === 'per_m2') total_price += (total_area * opt.value);
      }
    });

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
    if ($btnExportPDF) $btnExportPDF.disabled = !hasResults;
    if ($btnClearResults) $btnClearResults.disabled = !hasResults;
    if ($btnSaveProject) $btnSaveProject.disabled = !hasResults;

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
            <input type="text" class="detection-label-input" data-idx="${i}" value="${d.label || '#PAN-' + String(i + 1).padStart(4, '0')}" />
            <div class="detection-area">${d.area_m2.toFixed(1)} m²</div>
            <div class="detection-meta">
              <span>🎯 ${confLabel} (${(conf * 100).toFixed(0)}%)</span>
              <span>📍 ${d.center ? d.center.lat.toFixed(5) + ', ' + d.center.lng.toFixed(5) : '—'}</span>
            </div>
          </div>
          <div class="detection-price">${est.price_ht.toFixed(0)}€</div>
          <button class="btn-delete-zone" data-idx="${i}" title="Supprimer la zone">🗑️</button>
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
        <td><input type="text" class="opt-label" value="${opt.label}"></td>
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
        version: 1,
        date: new Date().toISOString(),
        detections: _detections,
        businessOptions: _businessOptions,
        mapState: window.MapController ? window.MapController.getState() : null
      };
      
      const res = await window.solarAPI.saveProject(projectData);
      if (res.ok) Toast.show('Projet sauvegardé avec succès', 'success');
      else if (res.reason !== 'cancelled') Toast.show('Erreur lors de la sauvegarde', 'error');
    });
  }

  if ($btnOpenProject) {
    $btnOpenProject.addEventListener('click', async () => {
      if (!window.solarAPI) return;
      const res = await window.solarAPI.openProject();
      
      if (res.ok && res.data) {
        // Restaurer le projet
        const data = res.data;
        if (data.detections) {
          clearDetections();
          // Injection silencieuse des detections (sans append)
          if (window.MapController && window.MapController.displayDetectionsDirect) {
            window.MapController.displayDetectionsDirect(data.detections);
          } else {
            setDetections(data.detections); // Fallback mais risque de bug en fonction de l'impl de map.js
          }
        }
        if (data.businessOptions) {
          _businessOptions = data.businessOptions;
        }
        if (data.mapState && window.MapController && window.MapController.setState) {
          window.MapController.setState(data.mapState);
        }
        Toast.show('Projet chargé avec succès !', 'success');
      } else if (res.reason !== 'cancelled') {
        Toast.show('Fichier invalide ou corrompu', 'error');
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
          const BACKEND_URL = 'http://127.0.0.1:8765';
          const res = await fetch(`${BACKEND_URL}/geocode/reverse?lat=${lat}&lon=${lng}`);
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

    const html = window.PDFGenerator.build(clientInfo, mapDataUrl, _detections, _settings, _businessOptions, computeEstimate);
    const res = await window.solarAPI.exportPDF(html);
    if (res.ok) Toast.show(`Devis PDF exporté avec succès !`, 'success');
    else if (res.reason !== 'cancelled') Toast.show('Erreur export PDF', 'error');
  });



  // ── Tournée Logic ─────────────────────────────────────────
  function _renderTournee() {
    if ($btnOpenTournee) {
      $btnOpenTournee.innerHTML = `🚗 Ma Tournée (${_tournee.length})`;
    }
    
    if ($tourneeTbody) {
      $tourneeTbody.innerHTML = _tournee.map((t, i) => `
        <tr>
          <td>
            ${i === 0 ? '<span title="Point de départ" style="font-size: 16px;">📍</span>' : `<span style="color: #666; font-size: 11px;">Étape ${i}</span>`}
          </td>
          <td>${t.name}</td>
          <td>${t.address}</td>
          <td style="text-align: right; font-weight: bold; display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
            ${t.price.toFixed(2)} €
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span class="btn-up-tournee" data-idx="${i}" style="cursor: ${i === 0 ? 'not-allowed; opacity: 0.3;' : 'pointer;'}" title="Monter">🔼</span>
              <span class="btn-down-tournee" data-idx="${i}" style="cursor: ${i === _tournee.length - 1 ? 'not-allowed; opacity: 0.3;' : 'pointer;'}" title="Descendre">🔽</span>
            </div>
            <span class="btn-edit-tournee" data-idx="${i}" style="cursor: pointer; margin-left: 8px;" title="Modifier">✏️</span>
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
      
      // Construire la chaîne de coordonnées lon,lat;lon,lat
      const coords = _tournee.map(t => `${t.center.lng.toFixed(6)},${t.center.lat.toFixed(6)}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
      
      try {
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.code === 'Ok') {
          const route = data.routes[0];
          const distanceKm = route.distance / 1000;
          const timeMin = route.duration / 60;
          const totalRevenue = _tournee.reduce((s, t) => s + t.price, 0);
          
          const mileageCostRate = _settings.mileage_cost !== undefined ? _settings.mileage_cost : 0.5;
          const totalMileageCost = distanceKm * mileageCostRate;
          const totalFinal = totalRevenue + totalMileageCost;
          
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
          Toast.show('Erreur de calcul OSRM: ' + data.code, 'error');
        }
      } catch (err) {
        Toast.show('Erreur réseau lors du calcul', 'error');
        console.error(err);
      }
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
