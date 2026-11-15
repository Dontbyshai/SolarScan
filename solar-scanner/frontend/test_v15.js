/**
 * Contrôles hors navigateur : échappement PDF, fusion des doublons, bug Street View.
 * Lancer depuis n'importe où : node solar-scanner/frontend/test_v15.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(name) {
  const code = fs.readFileSync(path.join(dir, name), 'utf8');
  vm.runInContext(code, sandbox, { filename: name });
}

load('geo_utils.js');
load('pdfTemplate.js');

const mapSource = fs.readFileSync(path.join(dir, 'map.js'), 'utf8');
if (mapSource.includes('det.center')) {
  console.error('map.js utilise encore det.center au lieu de d.center');
  process.exit(1);
}

const html = sandbox.PDFGenerator.build(
  { name: '<script>alert(1)</script>', address: '1 rue <b>Test</b>\nParis' },
  'javascript:alert(1)',
  [{ area_m2: 12, confidence: 0.8, label: '<img onerror=alert(1)>' }],
  {
    vat_rate: 0.2,
    company_name: '<b>Société</b>',
    company_address: 'Adresse & Co',
    company_siret: '123',
    company_logo: '"><script>',
    roi_prod_kwh: 200,
    roi_price_kwh: 0.25,
    roi_loss_percent: 15,
    next_quote_number: 4,
    quote_validity_days: 45,
  },
  [{ label: '<i>option</i>', type: 'fixed', value: 10, checked: true }],
  () => ({ price_ht: 30, unitPrice: 2.5, cleaning_min: 20 })
);

const forbidden = ['<script>', '<b>Société', '<img', 'javascript:'];
forbidden.forEach((snippet) => {
  if (html.includes(snippet)) {
    console.error('HTML non échappé : ' + snippet);
    process.exit(1);
  }
});
if (!html.includes('DEV-') || !html.includes('45 jours') || !html.includes('&lt;script&gt;')) {
  console.error('Numéro de devis ou validité absents');
  process.exit(1);
}

const sheet = sandbox.PDFGenerator.buildTourSheet(
  [{ name: '<script>', address: 'Rue &amp; déjà', price: 10 }],
  null,
  { company_name: 'Atelier' }
);
if (sheet.includes('<script>')) {
  console.error('Feuille de route non échappée');
  process.exit(1);
}

const near = [
  { confidence: 0.9, area_m2: 20, center: { lat: 45.0, lng: 2.0 } },
  { confidence: 0.4, area_m2: 50, center: { lat: 45.00005, lng: 2.0 } },
  { confidence: 0.8, area_m2: 10, center: { lat: 45.01, lng: 2.0 } },
];
const merged = sandbox.GeoUtils.mergeCloseDetections(near, 15);
if (merged.length !== 2) {
  console.error('Fusion des doublons : attendu 2, obtenu ' + merged.length);
  process.exit(1);
}
if (merged[0].confidence !== 0.9) {
  console.error('La détection la plus confiante doit être conservée');
  process.exit(1);
}

console.log('Tests frontend 1.5 OK');
