"""
geo_utils.py — Conversion géographique pixels / mètres / coordonnées

Note : Uniquement France métropolitaine + DOM-TOM via IGN Géoplateforme.
"""

import math
from typing import Tuple, List, Dict, Any


TILE_SIZE = 256
EARTH_RADIUS_M = 6_378_137.0  # WGS-84


def resolution_at_zoom(zoom: int, lat_deg: float) -> float:
    """
    Résolution au sol en m/pixel pour un zoom et une latitude.
    C × cos(lat) / 2^zoom    où C = 2π × R / TILE_SIZE
    """
    C = (2 * math.pi * EARTH_RADIUS_M) / TILE_SIZE
    lat_rad = math.radians(lat_deg)
    return (C * math.cos(lat_rad)) / (2 ** zoom)


def pixels_to_m2(pixel_count: int, zoom: int, lat_deg: float) -> float:
    """Convertit un nombre de pixels en mètres carrés."""
    res = resolution_at_zoom(zoom, lat_deg)
    return pixel_count * res * res


def tile_to_bounds(x: int, y: int, z: int) -> Dict[str, float]:
    """Tuile XYZ → bounds géographiques {north, south, east, west} en degrés."""
    n = 2 ** z

    def x_to_lng(tx: float) -> float:
        return (tx / n) * 360.0 - 180.0

    def y_to_lat(ty: float) -> float:
        sin_lat = math.tanh(math.pi * (1 - (2 * ty) / n))
        return math.degrees(math.asin(sin_lat))

    return {
        "west": x_to_lng(x),
        "east": x_to_lng(x + 1),
        "north": y_to_lat(y),
        "south": y_to_lat(y + 1),
    }


def lat_lng_to_tile(lat_deg: float, lng_deg: float, zoom: int) -> Tuple[int, int]:
    """Lat/Lng + zoom → coordonnées tuile (x, y)."""
    n = 2 ** zoom
    x = int((lng_deg + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat_deg)
    y = int(
        (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n
    )
    return x, y


def tiles_in_bounds(bounds: Dict[str, float], zoom: int) -> List[Tuple[int, int]]:
    """Retourne toutes les tuiles XYZ dans des bounds géographiques."""
    nw_x, nw_y = lat_lng_to_tile(bounds["north"], bounds["west"], zoom)
    se_x, se_y = lat_lng_to_tile(bounds["south"], bounds["east"], zoom)

    tiles = []
    for tx in range(nw_x, se_x + 1):
        for ty in range(nw_y, se_y + 1):
            tiles.append((tx, ty))
    return tiles


def ign_tile_url(x: int, y: int, z: int) -> str:
    """URL d'une tuile IGN Géoplateforme (sans clé, France uniquement)."""
    return (
        f"https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile"
        f"&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM"
        f"&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
        f"&FORMAT=image%2Fjpeg&STYLE=normal"
    )


def tile_center(x: int, y: int, z: int) -> Dict[str, float]:
    """Coordonnées du centre d'une tuile."""
    b = tile_to_bounds(x, y, z)
    return {
        "lat": (b["north"] + b["south"]) / 2,
        "lng": (b["west"] + b["east"]) / 2,
    }


def pixel_coords_to_geo(
    pixel_x: float,
    pixel_y: float,
    img_width: int,
    img_height: int,
    bounds: Dict[str, float]
) -> Tuple[float, float]:
    """
    Convertit des coordonnées pixel (dans une image composite) en lat/lng.
    """
    lng = bounds["west"] + (pixel_x / img_width) * (bounds["east"] - bounds["west"])
    lat = bounds["north"] - (pixel_y / img_height) * (bounds["north"] - bounds["south"])
    return lat, lng


def geo_polygon_center(polygon: List[List[float]]) -> Dict[str, float]:
    """Centre géométrique d'un polygone en coordonnées [lng, lat]."""
    lats = [p[1] for p in polygon]
    lngs = [p[0] for p in polygon]
    return {"lat": sum(lats) / len(lats), "lng": sum(lngs) / len(lngs)}
