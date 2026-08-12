/**
 * geo_utils.js — Conversion géographique pixels / mètres / coords
 * Uniquement France métropolitaine + DOM-TOM (IGN Géoplateforme)
 */

window.GeoUtils = (() => {
  'use strict';

  const TILE_SIZE = 256;
  const EARTH_RADIUS_M = 6378137; // WGS-84

  /**
   * Résolution au sol en m/pixel pour un zoom et une latitude donnés.
   * Formule : C * cos(lat) / 2^zoom   où C = 2π * R / 256
   */
  function resolutionAtZoom(zoom, latDeg) {
    const C = (2 * Math.PI * EARTH_RADIUS_M) / TILE_SIZE;
    const latRad = (latDeg * Math.PI) / 180;
    return (C * Math.cos(latRad)) / Math.pow(2, zoom);
  }

  /**
   * Convertit des pixels détectés en mètres carrés.
   */
  function pixelsToM2(pixels, zoom, latDeg) {
    const res = resolutionAtZoom(zoom, latDeg);
    return pixels * res * res;
  }

  /**
   * Tile (X, Y, Z) → bounds { north, south, east, west } en degrés.
   * Projection Web Mercator (EPSG:3857 / PM).
   */
  function tileToBounds(x, y, z) {
    const n = Math.pow(2, z);

    function xToLng(tx) {
      return (tx / n) * 360 - 180;
    }

    function yToLat(ty) {
      const sinLat = Math.tanh(Math.PI * (1 - (2 * ty) / n));
      return (Math.asin(sinLat) * 180) / Math.PI;
    }

    return {
      west: xToLng(x),
      east: xToLng(x + 1),
      north: yToLat(y),
      south: yToLat(y + 1),
    };
  }

  /**
   * Lat/Lng + zoom → tile XY.
   */
  function latLngToTile(latDeg, lngDeg, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor(((lngDeg + 180) / 360) * n);
    const latRad = (latDeg * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );
    return { x, y, z: zoom };
  }

  /**
   * Retourne toutes les tuiles XYZ contenues dans des bounds géographiques.
   * @param {object} bounds { north, south, east, west }
   * @param {number} zoom
   * @returns {Array<{x, y, z}>}
   */
  function tilesInBounds(bounds, zoom) {
    const nw = latLngToTile(bounds.north, bounds.west, zoom);
    const se = latLngToTile(bounds.south, bounds.east, zoom);

    const tiles = [];
    for (let tx = nw.x; tx <= se.x; tx++) {
      for (let ty = nw.y; ty <= se.y; ty++) {
        tiles.push({ x: tx, y: ty, z: zoom });
      }
    }
    return tiles;
  }

  /**
   * Construit l'URL d'une tuile IGN Géoplateforme (pas de clé requise, France uniquement).
   */
  function ignTileUrl(x, y, z) {
    return (
      `https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile` +
      `&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM` +
      `&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}` +
      `&FORMAT=image%2Fjpeg&STYLE=normal`
    );
  }

  /**
   * Centre (lat, lng) d'une tuile.
   */
  function tileCenter(x, y, z) {
    const b = tileToBounds(x, y, z);
    return {
      lat: (b.north + b.south) / 2,
      lng: (b.west + b.east) / 2,
    };
  }

  /**
   * Formate un nombre de m² en texte lisible (m² ou ha).
   */
  function formatArea(m2) {
    if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`;
    return `${m2.toFixed(1)} m²`;
  }

  /**
   * Formate un prix en euros.
   */
  function formatPrice(eur) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(eur);
  }

  return {
    resolutionAtZoom,
    pixelsToM2,
    tileToBounds,
    latLngToTile,
    tilesInBounds,
    ignTileUrl,
    tileCenter,
    formatArea,
    formatPrice,
  };
})();
