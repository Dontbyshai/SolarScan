"""
tiles.py — Téléchargement et assemblage de tuiles IGN Géoplateforme

Cache SQLite pour éviter de re-télécharger des tuiles déjà connues.
Délai de 100ms entre les requêtes pour respecter le rate-limiting IGN.
"""

import asyncio
import io
import logging
import sqlite3
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import aiohttp
from PIL import Image

from geo_utils import ign_tile_url, tile_to_bounds
from http_ssl import client_session
from paths import cache_dir

logger = logging.getLogger(__name__)

# ── Cache ──────────────────────────────────────────────────────────────────────

IGN_DELAY_SECS = 0.1  # 100ms entre requêtes IGN
MAX_TILES_PER_REQUEST = 80
MIN_ZOOM = 12
MAX_ZOOM = 22
ALLOWED_TILE_HOST = "data.geopf.fr"

_db_conn: Optional[sqlite3.Connection] = None
_db_path: Optional[Path] = None


def cache_db_path() -> Path:
    return cache_dir() / "tiles.db"


def _get_db() -> sqlite3.Connection:
    global _db_conn, _db_path
    path = cache_db_path()
    if _db_conn is not None and _db_path == path:
        return _db_conn
    if _db_conn is not None:
        _db_conn.close()
    path.parent.mkdir(parents=True, exist_ok=True)
    _db_conn = sqlite3.connect(str(path), check_same_thread=False)
    _db_path = path
    _db_conn.execute("""
        CREATE TABLE IF NOT EXISTS tiles (
            url     TEXT PRIMARY KEY,
            data    BLOB NOT NULL,
            created INTEGER NOT NULL
        )
    """)
    _db_conn.commit()
    return _db_conn


def get_cached_tile(url: str) -> Optional[bytes]:
    try:
        row = _get_db().execute("SELECT data FROM tiles WHERE url = ?", (url,)).fetchone()
        return row[0] if row else None
    except Exception as e:
        logger.warning(f"Cache read error: {e}")
        return None


def set_cached_tile(url: str, data: bytes) -> None:
    try:
        _get_db().execute(
            "INSERT OR REPLACE INTO tiles (url, data, created) VALUES (?, ?, ?)",
            (url, data, int(time.time()))
        )
        _get_db().commit()
    except Exception as e:
        logger.warning(f"Cache write error: {e}")


def clear_tile_cache() -> int:
    """Efface le cache, retourne le nombre d'entrées supprimées."""
    try:
        db = _get_db()
        count = db.execute("SELECT COUNT(*) FROM tiles").fetchone()[0]
        db.execute("DELETE FROM tiles")
        db.commit()
        logger.info(f"Cache cleared: {count} tiles removed")
        return count
    except Exception as e:
        logger.error(f"Cache clear error: {e}")
        return 0


def get_cache_size_mb() -> float:
    try:
        path = cache_db_path()
        return path.stat().st_size / (1024 * 1024) if path.exists() else 0.0
    except Exception:
        return 0.0


def sanitize_tiles(tile_infos: List[Dict]) -> List[Dict]:
    """
    Reconstruit chaque tuile à partir de x/y/z uniquement.

    L'URL envoyée par l'interface est ignorée : le backend ne télécharge
    que la tuile IGN canonique. Ça empêche de faire télécharger une adresse
    arbitraire (fichier interne, autre site, etc.).
    """
    if len(tile_infos) > MAX_TILES_PER_REQUEST:
        raise ValueError(
            f"Trop de tuiles ({len(tile_infos)}). Maximum {MAX_TILES_PER_REQUEST}. Zoomez davantage."
        )

    cleaned: List[Dict] = []
    for tile in tile_infos:
        try:
            z = int(tile["z"])
            x = int(tile["x"])
            y = int(tile["y"])
        except (KeyError, TypeError, ValueError):
            raise ValueError("Tuile invalide : x, y et z sont requis")

        if z < MIN_ZOOM or z > MAX_ZOOM:
            raise ValueError(f"Zoom {z} hors plage ({MIN_ZOOM}–{MAX_ZOOM})")

        limit = 2 ** z
        if not (0 <= x < limit and 0 <= y < limit):
            raise ValueError("Coordonnées de tuile hors grille")

        url = ign_tile_url(x, y, z)
        if ALLOWED_TILE_HOST not in url:
            raise ValueError("Hôte de tuile non autorisé")

        cleaned.append({
            "x": x,
            "y": y,
            "z": z,
            "url": url,
            "bounds": tile_to_bounds(x, y, z),
        })
    return cleaned


# ── HTTP Download ──────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": "SolarScan/1.5 (application locale ; https://github.com/Dontbyshai/SolarScan)",
    "Accept": "image/jpeg,image/*",
    "Referer": "https://www.geoportail.gouv.fr/",
}


async def download_tile(session: aiohttp.ClientSession, url: str) -> Optional[bytes]:
    """Télécharge une tuile IGN (avec cache)."""
    cached = get_cached_tile(url)
    if cached:
        return cached

    try:
        async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status == 200:
                data = await resp.read()
                set_cached_tile(url, data)
                return data
            else:
                logger.warning(f"Tile {url} returned HTTP {resp.status}")
                return None
    except asyncio.TimeoutError:
        logger.warning("Délai dépassé pour la tuile %s", url)
        return None
    except Exception as e:
        logger.error(
            "Erreur de téléchargement de tuile %s : %s: %s",
            url,
            type(e).__name__,
            e,
            exc_info=True,
        )
        return None


async def download_tiles_batch(
    tile_infos: List[Dict],
    progress_callback=None
) -> Dict[str, bytes]:
    """
    Télécharge une liste de tuiles avec délai IGN et retourne {url: bytes}.
    tile_infos: [{"url": "...", "x": int, "y": int, "z": int, "bounds": {...}}]
    """
    results: Dict[str, bytes] = {}
    total = len(tile_infos)

    # SSL vérifié avec le bundle certifi (voir http_ssl.py).
    async with client_session(limit=4) as session:
        for i, tile in enumerate(tile_infos):
            url = tile["url"]
            logger.debug(f"Downloading tile {i+1}/{total}: {url}")

            data = await download_tile(session, url)
            if data:
                results[url] = data

            if progress_callback:
                pct = (i + 1) / total * 50  # 0-50% = download phase
                await progress_callback(pct, f"Téléchargement tuile {i+1}/{total}")

            # Rate limiting IGN
            if i < total - 1:
                await asyncio.sleep(IGN_DELAY_SECS)

    return results


# ── Tile Assembly ──────────────────────────────────────────────────────────────

def assemble_tiles(
    tile_infos: List[Dict],
    tile_data: Dict[str, bytes],
    zoom: int,
) -> Optional[Tuple[Image.Image, Dict]]:
    """
    Assemble des tuiles téléchargées en une image composite.
    Retourne (image PIL, bounds composite).
    """
    if not tile_data:
        return None

    # Find grid extent
    xs = [t["x"] for t in tile_infos if t["url"] in tile_data]
    ys = [t["y"] for t in tile_infos if t["url"] in tile_data]

    if not xs:
        return None

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    cols = max_x - min_x + 1
    rows = max_y - min_y + 1

    TILE_SIZE = 256
    canvas = Image.new("RGB", (cols * TILE_SIZE, rows * TILE_SIZE), color=(30, 30, 30))

    for tile in tile_infos:
        url = tile["url"]
        if url not in tile_data:
            continue
        try:
            img = Image.open(io.BytesIO(tile_data[url])).convert("RGB")
            col = tile["x"] - min_x
            row = tile["y"] - min_y
            canvas.paste(img, (col * TILE_SIZE, row * TILE_SIZE))
        except Exception as e:
            logger.warning(f"Cannot open tile image {url}: {e}")

    # Compute composite geographic bounds
    nw_bounds = tile_to_bounds(min_x, min_y, zoom)
    se_bounds = tile_to_bounds(max_x, max_y, zoom)

    composite_bounds = {
        "north": nw_bounds["north"],
        "south": se_bounds["south"],
        "west": nw_bounds["west"],
        "east": se_bounds["east"],
    }

    return canvas, composite_bounds
