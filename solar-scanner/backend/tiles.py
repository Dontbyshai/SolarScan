"""
tiles.py — Téléchargement et assemblage de tuiles IGN Géoplateforme

Cache SQLite pour éviter de re-télécharger des tuiles déjà connues.
Délai de 100ms entre les requêtes pour respecter le rate-limiting IGN.
"""

import asyncio
import io
import logging
import math
import os
import sqlite3
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import aiohttp
from PIL import Image

from geo_utils import tile_to_bounds, pixel_coords_to_geo

logger = logging.getLogger(__name__)

# ── Cache ──────────────────────────────────────────────────────────────────────

CACHE_DIR = Path(__file__).parent.parent / "assets" / "cache"
CACHE_DB_PATH = CACHE_DIR / "tiles.db"
IGN_DELAY_SECS = 0.1  # 100ms entre requêtes IGN

_db_conn: Optional[sqlite3.Connection] = None


def _get_db() -> sqlite3.Connection:
    global _db_conn
    if _db_conn is None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _db_conn = sqlite3.connect(str(CACHE_DB_PATH), check_same_thread=False)
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
        return CACHE_DB_PATH.stat().st_size / (1024 * 1024) if CACHE_DB_PATH.exists() else 0.0
    except Exception:
        return 0.0


# ── HTTP Download ──────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": "SolarScanner/1.0 (solar panel detection app; contact: admin@solarscanner.fr)",
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
        logger.warning(f"Timeout downloading tile: {url}")
        return None
    except Exception as e:
        logger.error(f"Error downloading tile {url}: {e}")
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

    connector = aiohttp.TCPConnector(limit=4, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
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
