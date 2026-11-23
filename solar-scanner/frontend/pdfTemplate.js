window.PDFGenerator = (() => {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function multiline(value) {
    return escapeHtml(value).replace(/\n/g, '<br/>');
  }

  function safeImage(src) {
    const value = String(src || '');
    if (/^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) {
      return value;
    }
    return '';
  }

  /**
   * Réduit une data-URL (carte ou logo) pour le PDF.
   * Sans ça, un capturePage Rétina + un logo 1024px (parfois doublé en filigrane)
   * dépasse la limite de l'IPC Electron et le 2e devis échoue silencieusement.
   */
  function compactImage(src, options) {
    const opts = options || {};
    const safe = safeImage(src);
    if (!safe) return Promise.resolve('');
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      return Promise.resolve(safe);
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width || 1;
          let h = img.naturalHeight || img.height || 1;
          const maxW = opts.maxWidth || 1600;
          const maxH = opts.maxHeight || 1100;
          const scale = Math.min(1, maxW / w, maxH / h);
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(safe);
            return;
          }
          if ((opts.format || 'image/jpeg') === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
          }
          ctx.drawImage(img, 0, 0, w, h);
          const mime = opts.format || 'image/jpeg';
          const maxChars = opts.maxChars || 900000;
          let quality = typeof opts.quality === 'number' ? opts.quality : 0.82;
          let out = canvas.toDataURL(mime, quality);
          while (out.length > maxChars && quality > 0.45) {
            quality -= 0.1;
            out = canvas.toDataURL(mime, quality);
          }
          if (out.length > maxChars && (w > 640 || h > 480)) {
            const shrink = Math.sqrt(maxChars / out.length);
            canvas.width = Math.max(320, Math.round(w * shrink));
            canvas.height = Math.max(240, Math.round(h * shrink));
            if (mime === 'image/jpeg') {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            out = canvas.toDataURL(mime, 0.72);
          }
          resolve(out && out.length ? out : safe);
        } catch (err) {
          resolve(safe);
        }
      };
      img.onerror = () => resolve(safe);
      img.src = safe;
    });
  }

  function quoteNumber(settings) {
    const year = new Date().getFullYear();
    const n = parseInt(settings.next_quote_number, 10) || 1;
    return 'DEV-' + year + '-' + String(n).padStart(3, '0');
  }

  function validityDays(settings) {
    const days = parseInt(settings.quote_validity_days, 10);
    if (!days || days < 1) return 30;
    return Math.min(days, 365);
  }

  const DOCUMENT_CSS = [
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:12.5px;color:#171717;margin:36px;background:#fff;}',
    '.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:16px;border-bottom:1px solid #e5e5e5;}',
    '.company-info{max-width:280px;}',
    '.company-name{font-size:16px;font-weight:600;color:#171717;margin:8px 0 4px;}',
    '.company-info .muted{color:#5c5c5c;line-height:1.45;}',
    '.logo{max-height:64px;max-width:180px;object-fit:contain;margin-bottom:4px;}',
    '.logo-placeholder{font-size:16px;font-weight:600;color:#171717;margin-bottom:8px;}',
    '.document-title{font-size:22px;font-weight:600;color:#171717;margin:0;letter-spacing:0.04em;text-align:right;}',
    '.doc-number{text-align:right;color:#5c5c5c;margin-top:6px;font-variant-numeric:tabular-nums;}',
    '.meta-row{display:flex;justify-content:space-between;gap:24px;margin-bottom:28px;}',
    '.client-info{background:#fafafa;padding:16px 18px;border:1px solid #e5e5e5;width:300px;}',
    '.client-info h4{margin:0 0 8px 0;color:#5c5c5c;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;}',
    '.client-info .c-name{font-size:14px;font-weight:600;margin-bottom:4px;}',
    '.invoice-details{text-align:right;}',
    '.invoice-details table{width:100%;text-align:right;border-collapse:collapse;}',
    '.invoice-details th{color:#5c5c5c;font-weight:500;font-size:12px;padding:3px 12px 3px 0;text-align:right;}',
    '.invoice-details td{font-variant-numeric:tabular-nums;}',
    '.map-container{margin:0 0 24px;border:1px solid #e5e5e5;padding:10px 12px 12px;background:#fff;text-align:center;}',
    '.map-container h4{margin:0 0 8px 0;font-size:10px;font-weight:600;color:#5c5c5c;text-transform:uppercase;letter-spacing:0.06em;text-align:left;}',
    '.map-container img{max-width:100%;max-height:320px;object-fit:contain;}',
    '.items-table{width:100%;border-collapse:collapse;margin-top:8px;}',
    '.items-table th{background:#171717;color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;}',
    '.items-table th:last-child,.items-table td:last-child{text-align:right;}',
    '.items-table td{padding:9px 10px;border-bottom:1px solid #e5e5e5;font-variant-numeric:tabular-nums;}',
    '.items-table tr.option td{background:#fafafa;color:#3f3f3f;font-size:12px;}',
    '.totals-container{display:flex;justify-content:flex-end;margin-top:16px;}',
    '.totals-table{width:280px;border-collapse:collapse;}',
    '.totals-table td{padding:7px 8px;border-bottom:1px solid #e5e5e5;font-variant-numeric:tabular-nums;}',
    '.totals-table tr.ttc td{font-size:14px;font-weight:600;border-bottom:none;border-top:1px solid #171717;padding-top:10px;}',
    '.footer{margin-top:48px;font-size:10px;color:#737373;border-top:1px solid #e5e5e5;padding-top:12px;text-align:center;line-height:1.5;}',
    '.note{border:1px solid #e5e5e5;background:#fafafa;color:#3f3f3f;padding:10px 14px;margin-top:24px;font-size:12px;}',
    '.roi{border:1px solid #e5e5e5;padding:14px 16px;margin:24px 0 0;}',
    '.roi h4{margin:0 0 8px 0;font-size:13px;font-weight:600;color:#171717;}',
    '.roi p{margin:0;font-size:12.5px;color:#3f3f3f;line-height:1.55;}',
  ].join('');

  function build(clientInfo, mapDataUrl, detections, settings, businessOptions, computeEstimate) {
    const now = new Date().toLocaleDateString('fr-FR', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const numero = quoteNumber(settings);
    const jours = validityDays(settings);
    const total_area = detections.reduce((s, d) => s + d.area_m2, 0);
    let total_price_ht = detections.reduce((s, d) => s + computeEstimate(d.area_m2).price_ht, 0);
    const total_time = detections.reduce((s, d) => s + computeEstimate(d.area_m2).cleaning_min, 0);

    const prodM2 = settings.roi_prod_kwh || 200;
    const priceKwh = settings.roi_price_kwh || 0.25;
    const lossPct = (settings.roi_loss_percent || 15) / 100;
    const annualLossEuros = total_area * prodM2 * priceKwh * lossPct;

    let optionRows = '';
    let current_ht = total_price_ht;

    businessOptions.forEach((opt) => {
      if (opt.checked) {
        let optPrice = 0;
        let desc = escapeHtml(opt.label);
        if (opt.type === 'multiplier') {
          optPrice = current_ht * (opt.value - 1);
          current_ht += optPrice;
          desc += ' (x' + Number(opt.value) + ')';
        } else if (opt.type === 'fixed') {
          optPrice = Number(opt.value) || 0;
          current_ht += optPrice;
        } else if (opt.type === 'per_m2') {
          optPrice = total_area * (Number(opt.value) || 0);
          current_ht += optPrice;
          desc += ' (' + Number(opt.value) + '\u20ac/m\u00b2)';
        }
        optionRows += '<tr class="option">'
          + '<td>#OPT</td>'
          + '<td colspan="3">Option : ' + desc + '</td>'
          + '<td>' + optPrice.toFixed(2) + ' \u20ac</td>'
          + '</tr>';
      }
    });

    total_price_ht = current_ht;
    const tva_amount = total_price_ht * settings.vat_rate;
    const total_price_ttc = total_price_ht + tva_amount;

    const rows = detections.map((d, i) => {
      const est = computeEstimate(d.area_m2);
      const label = escapeHtml(d.label || '#PAN-' + String(i + 1).padStart(4, '0'));
      return '<tr>'
        + '<td>' + label + '</td>'
        + '<td>Nettoyage panneau photovolta\u00efque</td>'
        + '<td>' + d.area_m2.toFixed(1) + '</td>'
        + '<td>' + est.unitPrice.toFixed(2) + ' \u20ac</td>'
        + '<td>' + est.price_ht.toFixed(2) + ' \u20ac</td>'
        + '</tr>';
    }).join('');

    // Le logo n'est inséré qu'une fois (plus de filigrane en base64,
    // qui doublait le poids et faisait échouer le devis suivant).
    const logo = safeImage(settings.company_logo);
    const companyName = escapeHtml(settings.company_name || 'Votre Soci\u00e9t\u00e9');
    const companySiret = escapeHtml(settings.company_siret || 'SIRET: XXX XXX XXX');
    const companyAddr = settings.company_address
      ? multiline(settings.company_address)
      : 'Adresse de votre soci\u00e9t\u00e9';
    const clientName = escapeHtml(clientInfo.name || 'Client');
    const clientAddr = multiline(clientInfo.address || '');

    const logoHtml = logo
      ? '<img src="' + logo + '" class="logo" alt="" />'
      : '<div class="logo-placeholder">' + companyName + '</div>';

    const mapSrc = safeImage(mapDataUrl);
    const mapHtml = mapSrc
      ? '<div class="map-container"><h4>Aper\u00e7u des zones d\u00e9tect\u00e9es</h4><img src="' + mapSrc + '" alt="" /></div>'
      : '';

    const timeStr = total_time >= 60
      ? (total_time / 60).toFixed(1) + 'h'
      : total_time.toFixed(0) + 'min';

    const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>'
      + '<title>Devis ' + escapeHtml(numero) + '</title>'
      + '<style>' + DOCUMENT_CSS + '</style></head><body>'

      + '<div class="header">'
      + '<div class="company-info">'
      + logoHtml
      + '<div class="company-name">' + companyName + '</div>'
      + '<div class="muted">' + companyAddr + '</div>'
      + '<div class="muted" style="margin-top:4px;">' + companySiret + '</div>'
      + '</div>'
      + '<div><h1 class="document-title">DEVIS</h1>'
      + '<div class="doc-number">' + escapeHtml(numero) + '</div></div>'
      + '</div>'

      + '<div class="meta-row">'
      + '<div class="client-info">'
      + '<h4>Factur\u00e9 \u00e0</h4>'
      + '<div class="c-name">' + clientName + '</div>'
      + '<div>' + clientAddr + '</div>'
      + '</div>'
      + '<div class="invoice-details"><table>'
      + '<tr><th>Date</th><td>' + escapeHtml(now) + '</td></tr>'
      + '<tr><th>Validit\u00e9</th><td>' + jours + ' jours</td></tr>'
      + '</table></div>'
      + '</div>'

      + mapHtml

      + '<table class="items-table"><thead><tr>'
      + '<th>R\u00e9f</th><th>D\u00e9signation</th><th>Surface (m\u00b2)</th><th>Prix unitaire HT</th><th>Total HT</th>'
      + '</tr></thead><tbody>'
      + rows
      + optionRows
      + '</tbody></table>'

      + '<div class="totals-container"><table class="totals-table">'
      + '<tr><td>Total net HT</td><td style="text-align:right;">' + total_price_ht.toFixed(2) + ' \u20ac</td></tr>'
      + '<tr><td>TVA (' + (settings.vat_rate * 100).toFixed(1) + '%)</td><td style="text-align:right;">' + tva_amount.toFixed(2) + ' \u20ac</td></tr>'
      + '<tr class="ttc"><td>Total TTC</td><td style="text-align:right;">' + total_price_ttc.toFixed(2) + ' \u20ac</td></tr>'
      + '</table></div>'

      + '<div class="note"><strong>Note.</strong> Ce devis est une estimation g\u00e9n\u00e9r\u00e9e \u00e0 partir d\'imagerie satellite. '
      + 'Surface totale d\u00e9tect\u00e9e : <strong>' + total_area.toFixed(1) + ' m\u00b2</strong>, '
      + 'temps de nettoyage estim\u00e9 : <strong>' + timeStr + '</strong>.</div>'

      + '<div class="roi">'
      + '<h4>Rentabilit\u00e9 de l\'intervention</h4>'
      + '<p>'
      + 'Des panneaux encrass\u00e9s perdent en moyenne <strong>' + (settings.roi_loss_percent || 15) + ' %</strong> de leur rendement. '
      + 'Sur <strong>' + total_area.toFixed(1) + ' m\u00b2</strong>, '
      + 'cela repr\u00e9sente une perte estim\u00e9e \u00e0 <strong>' + annualLossEuros.toFixed(0) + ' \u20ac par an</strong>. '
      + 'Le co\u00fbt de l\'intervention est de <strong>' + total_price_ttc.toFixed(2) + ' \u20ac TTC</strong>.'
      + '</p></div>'

      + '<div class="footer">'
      + companyName + ' — ' + (settings.company_siret ? companySiret : 'SIRET non renseign\u00e9') + '<br/>'
      + 'Document g\u00e9n\u00e9r\u00e9 par SolarScan — ' + escapeHtml(numero)
      + '</div>'
      + '</body></html>';

    return html;
  }

  function buildTourSheet(stops, summary, settings) {
    const now = new Date().toLocaleDateString('fr-FR', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const companyName = escapeHtml(settings.company_name || 'SolarScan');
    const rows = stops.map((stop, i) => {
      return '<tr>'
        + '<td>' + (i + 1) + '</td>'
        + '<td>' + escapeHtml(stop.name || 'Client') + '</td>'
        + '<td>' + escapeHtml(stop.address || '') + '</td>'
        + '<td style="text-align:right;">' + Number(stop.price || 0).toFixed(2) + ' \u20ac</td>'
        + '</tr>';
    }).join('');

    let bilan = '';
    if (summary) {
      bilan = '<div class="note"><strong>Bilan.</strong> '
        + Number(summary.distanceKm).toFixed(1) + ' km, '
        + Math.round(summary.timeMin) + ' min de route, '
        + Number(summary.mileageCost).toFixed(0) + ' \u20ac de frais, '
        + 'total ' + Number(summary.total).toFixed(0) + ' \u20ac HT.</div>';
    }

    return '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>'
      + '<title>Feuille de route</title>'
      + '<style>' + DOCUMENT_CSS
      + 'h1{font-size:22px;font-weight:600;margin:0 0 8px;}'
      + '</style></head><body>'
      + '<h1>Feuille de route</h1>'
      + '<p>' + companyName + ' — ' + escapeHtml(now) + '</p>'
      + '<table class="items-table"><thead><tr><th>#</th><th>Client</th><th>Adresse</th><th>Prix HT</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>'
      + bilan
      + '<p class="footer">G\u00e9n\u00e9r\u00e9 par SolarScan 1.5.1</p>'
      + '</body></html>';
  }

  return { build, buildTourSheet, escapeHtml, quoteNumber, safeImage, compactImage };
})();
