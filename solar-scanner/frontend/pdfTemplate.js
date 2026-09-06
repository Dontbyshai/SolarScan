window.PDFGenerator = (() => {
  'use strict';

  function build(clientInfo, mapDataUrl, detections, settings, businessOptions, computeEstimate) {
    const now = new Date().toLocaleDateString('fr-FR', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
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
        let desc = opt.label;
        if (opt.type === 'multiplier') {
          optPrice = current_ht * (opt.value - 1);
          current_ht += optPrice;
          desc += ' (x' + opt.value + ')';
        } else if (opt.type === 'fixed') {
          optPrice = opt.value;
          current_ht += optPrice;
        } else if (opt.type === 'per_m2') {
          optPrice = total_area * opt.value;
          current_ht += optPrice;
          desc += ' (' + opt.value + '\u20ac/m\u00b2)';
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
      return '<tr>'
        + '<td>' + (d.label || '#PAN-' + String(i + 1).padStart(4, '0')) + '</td>'
        + '<td>Nettoyage panneau photovolta\u00efque</td>'
        + '<td>' + d.area_m2.toFixed(1) + '</td>'
        + '<td>' + est.unitPrice.toFixed(2) + ' \u20ac</td>'
        + '<td>' + est.price_ht.toFixed(2) + ' \u20ac</td>'
        + '</tr>';
    }).join('');

    const logoHtml = settings.company_logo
      ? '<img src="' + settings.company_logo + '" class="logo" />'
      : '<div class="logo-placeholder">' + (settings.company_name || 'Votre Soci\u00e9t\u00e9') + '</div>';

    const mapHtml = mapDataUrl
      ? '<div class="map-container"><h4>Aper\u00e7u des zones d\u00e9tect\u00e9es</h4><img src="' + mapDataUrl + '" /></div>'
      : '';

    const watermarkHtml = settings.company_logo
      ? '<img src="' + settings.company_logo + '" class="watermark" />'
      : '<div class="watermark-text">' + (settings.company_name || 'SolarScan') + '</div>';

    const companyAddr = settings.company_address
      ? settings.company_address.replace(/\n/g, '<br/>')
      : 'Adresse de votre soci\u00e9t\u00e9';

    const timeStr = total_time >= 60
      ? (total_time / 60).toFixed(1) + 'h'
      : total_time.toFixed(0) + 'min';

    const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>'
      + '<title>Devis - Nettoyage Panneaux</title>'
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
      + '<div class="company-name">' + (settings.company_name || 'Votre Soci\u00e9t\u00e9') + '</div>'
      + '<div>' + companyAddr + '</div>'
      + '<div style="margin-top: 5px; color: #666;">' + (settings.company_siret || 'SIRET: XXX XXX XXX') + '</div>'
      + '</div>'
      + '<div><h1 class="document-title">DEVIS</h1></div>'
      + '</div>'

      + '<div class="meta-row">'
      + '<div class="client-info">'
      + '<h4>Factur\u00e9 \u00e0</h4>'
      + '<div class="c-name">' + clientInfo.name + '</div>'
      + '<div>' + clientInfo.address.replace(/\n/g, '<br/>') + '</div>'
      + '</div>'
      + '<div class="invoice-details"><table>'
      + '<tr><th>Date :</th><td>' + now + '</td></tr>'
      + '<tr><th>Validit\u00e9 :</th><td>30 jours</td></tr>'
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
      + (settings.company_name || 'Votre Soci\u00e9t\u00e9') + ' - ' + (settings.company_siret || 'SIRET Non renseign\u00e9') + '<br/>'
      + 'G\u00e9n\u00e9r\u00e9 par SolarScanner'
      + '</div>'
      + '</body></html>';

    return html;
  }

  return { build };
})();
