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

    businessOptions.forEach(opt => {
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
        optionRows += '<tr style="background: #fafafa;">'
          + '<td style="color: #888; font-size: 10px;">#OPT</td>'
          + '<td colspan="3"><strong>Option :</strong> ' + desc + '</td>'
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

    const logo = safeImage(settings.company_logo);
    const companyName = escapeHtml(settings.company_name || 'Votre Soci\u00e9t\u00e9');
    const companySiret = escapeHtml(settings.company_siret || 'SIRET: XXX XXX XXX');
    const companyAddr = settings.company_address
      ? multiline(settings.company_address)
      : 'Adresse de votre soci\u00e9t\u00e9';
    const clientName = escapeHtml(clientInfo.name || 'Client');
    const clientAddr = multiline(clientInfo.address || '');

    const logoHtml = logo
      ? '<img src="' + logo + '" class="logo" />'
      : '<div class="logo-placeholder">' + companyName + '</div>';

    const mapSrc = safeImage(mapDataUrl);
    const mapHtml = mapSrc
      ? '<div class="map-container"><h4>Aper\u00e7u des zones d\u00e9tect\u00e9es</h4><img src="' + mapSrc + '" /></div>'
      : '';

    const watermarkHtml = logo
      ? '<img src="' + logo + '" class="watermark" />'
      : '<div class="watermark-text">' + companyName + '</div>';

    const timeStr = total_time >= 60
      ? (total_time / 60).toFixed(1) + 'h'
      : total_time.toFixed(0) + 'min';

    const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>'
      + '<title>Devis ' + escapeHtml(numero) + '</title>'
      + '<style>'
      + 'body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 13px; color: #333; margin: 40px; }'
      + '.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }'
      + '.company-info { max-width: 250px; }'
      + '.company-name { font-size: 20px; font-weight: bold; color: #1a1a2e; margin-bottom: 5px; }'
      + '.logo { max-height: 80px; max-width: 200px; margin-bottom: 15px; }'
      + '.logo-placeholder { font-size: 24px; font-weight: 800; color: #00b894; margin-bottom: 15px; }'
      + '.document-title { font-size: 28px; font-weight: 300; color: #00b894; margin: 0; text-transform: uppercase; letter-spacing: 2px; text-align: right; }'
      + '.meta-row { display: flex; justify-content: space-between; margin-bottom: 40px; }'
      + '.client-info { background: #f8f9fa; padding: 20px; border-left: 4px solid #00b894; width: 300px; }'
      + '.client-info h4 { margin: 0 0 10px 0; color: #666; font-size: 11px; text-transform: uppercase; }'
      + '.client-info .c-name { font-size: 16px; font-weight: bold; margin-bottom: 5px; }'
      + '.invoice-details { text-align: right; }'
      + '.invoice-details table { width: 100%; text-align: right; border-collapse: collapse; }'
      + '.invoice-details th { color: #888; font-weight: normal; font-size: 12px; padding: 4px 15px 4px 0; text-align: right; }'
      + '.map-container { margin: 30px 0; border: 1px solid #ddd; padding: 10px; background: #fff; text-align: center; border-radius: 4px; }'
      + '.map-container h4 { margin: 0 0 10px 0; font-size: 12px; color: #555; text-transform: uppercase; }'
      + '.map-container img { max-width: 100%; max-height: 350px; border-radius: 2px; object-fit: contain; }'
      + '.items-table { width: 100%; border-collapse: collapse; margin-top: 20px; }'
      + '.items-table th { background: #1a1a2e; color: #fff; padding: 10px; text-align: left; font-size: 11px; text-transform: uppercase; }'
      + '.items-table th:last-child { text-align: right; }'
      + '.items-table td { padding: 12px 10px; border-bottom: 1px solid #eee; }'
      + '.items-table td:last-child { text-align: right; font-weight: bold; }'
      + '.totals-container { display: flex; justify-content: flex-end; margin-top: 20px; }'
      + '.totals-table { width: 300px; border-collapse: collapse; }'
      + '.totals-table td { padding: 8px 10px; border-bottom: 1px solid #eee; }'
      + '.totals-table tr.ttc td { font-size: 16px; font-weight: bold; background: #f0faf8; color: #00b894; border-bottom: none; }'
      + '.footer { margin-top: 60px; font-size: 10px; color: #999; border-top: 1px solid #eee; padding-top: 15px; text-align: center; }'
      + '.note { background: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 10px 15px; margin-top: 30px; font-size: 12px; border-radius: 4px; }'
      + '.watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); opacity: 0.05; z-index: -1; pointer-events: none; max-width: 80%; max-height: 80%; }'
      + '.watermark-text { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); opacity: 0.05; z-index: -1; pointer-events: none; font-size: 100px; font-weight: bold; color: #000; white-space: nowrap; }'
      + '</style></head><body>'

      + watermarkHtml

      + '<div class="header">'
      + '<div class="company-info">'
      + logoHtml
      + '<div class="company-name">' + companyName + '</div>'
      + '<div>' + companyAddr + '</div>'
      + '<div style="margin-top: 5px; color: #666;">' + companySiret + '</div>'
      + '</div>'
      + '<div><h1 class="document-title">DEVIS</h1>'
      + '<div style="text-align:right; color:#666; margin-top:6px;">' + escapeHtml(numero) + '</div></div>'
      + '</div>'

      + '<div class="meta-row">'
      + '<div class="client-info">'
      + '<h4>Factur\u00e9 \u00e0</h4>'
      + '<div class="c-name">' + clientName + '</div>'
      + '<div>' + clientAddr + '</div>'
      + '</div>'
      + '<div class="invoice-details"><table>'
      + '<tr><th>Date :</th><td>' + escapeHtml(now) + '</td></tr>'
      + '<tr><th>Validit\u00e9 :</th><td>' + jours + ' jours</td></tr>'
      + '</table></div>'
      + '</div>'

      + mapHtml

      + '<table class="items-table"><thead><tr>'
      + '<th>R\u00e9f</th><th>D\u00e9signation</th><th>Surface (m\u00b2)</th><th>Prix Unitaire HT</th><th>Total HT</th>'
      + '</tr></thead><tbody>'
      + rows
      + optionRows
      + '</tbody></table>'

      + '<div class="totals-container"><table class="totals-table">'
      + '<tr><td>Total Net HT</td><td style="text-align: right;">' + total_price_ht.toFixed(2) + ' \u20ac</td></tr>'
      + '<tr><td>TVA (' + (settings.vat_rate * 100).toFixed(1) + '%)</td><td style="text-align: right;">' + tva_amount.toFixed(2) + ' \u20ac</td></tr>'
      + '<tr class="ttc"><td>Total TTC</td><td style="text-align: right;">' + total_price_ttc.toFixed(2) + ' \u20ac</td></tr>'
      + '</table></div>'

      + '<div class="note"><strong>Note :</strong> Ce devis est une estimation g\u00e9n\u00e9r\u00e9e automatiquement via imagerie satellite. '
      + 'La surface totale d\u00e9tect\u00e9e est de <strong>' + total_area.toFixed(1) + ' m\u00b2</strong>, '
      + 'avec un temps de nettoyage estim\u00e9 de <strong>' + timeStr + '</strong>.</div>'

      + '<div style="background: #e8f5e9; border: 1px solid #4caf50; padding: 20px; border-radius: 6px; margin: 30px 0;">'
      + '<h4 style="margin: 0 0 10px 0; color: #2e7d32; font-size: 16px;">\uD83C\uDF31 Argumentaire de Rentabilit\u00e9</h4>'
      + '<p style="margin: 0; font-size: 14px; color: #1b5e20; line-height: 1.5;">'
      + 'Vos panneaux solaires encrass\u00e9s perdent en moyenne <strong>' + (settings.roi_loss_percent || 15) + '%</strong> de leur rendement. '
      + 'Sur votre surface totale de <strong>' + total_area.toFixed(1) + ' m\u00b2</strong>, '
      + 'cela repr\u00e9sente une perte estim\u00e9e \u00e0 <strong style="font-size: 16px;">' + annualLossEuros.toFixed(0) + ' \u20ac par an</strong>.<br><br>'
      + 'Le co\u00fbt de notre intervention de nettoyage est de <strong>' + total_price_ttc.toFixed(2) + ' \u20ac TTC</strong>. Votre nettoyage s\'auto-finance donc tr\u00e8s rapidement !'
      + '</p></div>'

      + '<div class="footer">'
      + companyName + ' - ' + (settings.company_siret ? companySiret : 'SIRET Non renseign\u00e9') + '<br/>'
      + 'G\u00e9n\u00e9r\u00e9 par SolarScan ' + numero
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
      bilan = '<div class="note"><strong>Bilan :</strong> '
        + Number(summary.distanceKm).toFixed(1) + ' km, '
        + Math.round(summary.timeMin) + ' min de route, '
        + Number(summary.mileageCost).toFixed(0) + ' \u20ac de frais, '
        + 'total ' + Number(summary.total).toFixed(0) + ' \u20ac HT.</div>';
    }

    return '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>'
      + '<title>Feuille de route</title>'
      + '<style>'
      + 'body { font-family: Helvetica, Arial, sans-serif; font-size: 13px; color: #222; margin: 40px; }'
      + 'h1 { color: #00b894; font-weight: 500; letter-spacing: 1px; }'
      + 'table { width: 100%; border-collapse: collapse; margin-top: 16px; }'
      + 'th { background: #1a1a2e; color: white; text-align: left; padding: 8px; font-size: 11px; }'
      + 'td { padding: 8px; border-bottom: 1px solid #eee; }'
      + '.note { margin-top: 20px; background: #f0faf8; border: 1px solid #00b894; padding: 12px; }'
      + '</style></head><body>'
      + '<h1>Feuille de route</h1>'
      + '<p>' + companyName + ' — ' + escapeHtml(now) + '</p>'
      + '<table><thead><tr><th>#</th><th>Client</th><th>Adresse</th><th>Prix HT</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>'
      + bilan
      + '<p style="margin-top:28px;color:#888;font-size:11px;">Généré par SolarScan 1.5</p>'
      + '</body></html>';
  }

  return { build, buildTourSheet, escapeHtml, quoteNumber, safeImage };
})();
