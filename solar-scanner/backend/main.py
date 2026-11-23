"""
main.py — Serveur FastAPI pour SolarScan

Le serveur n'écoute que sur 127.0.0.1. Quand Electron le lance, il transmet
un jeton (SOLARSCAN_TOKEN) exigé sur toutes les routes sauf /health.
"""

import hmac
import json
import logging
import os
import signal
import time
from collections import OrderedDict
from logging.handlers import RotatingFileHandler
from typing import Dict, List
from urllib.parse import urlparse

import aiohttp
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from detector import analyze_image, engine_name
from http_ssl import client_session
from paths import data_dir, log_path, settings_path
from tiles import (
    assemble_tiles,
    clear_tile_cache,
    download_failure_message,
    download_tiles_batch,
    get_cache_size_mb,
    sanitize_tiles,
)

APP_VERSION = "1.5.1"
GEO_CACHE_MAX = 256
OSRM_HOST = "router.project-osrm.org"

# ── Logging ───────────────────────────────────────────────────────────────────

_LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"


def setup_logging() -> None:
    """Journal console + fichier dans le dossier utilisateur."""
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    formatter = logging.Formatter(_LOG_FORMAT)
    if not any(isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler) for h in root.handlers):
        stream = logging.StreamHandler()
        stream.setFormatter(formatter)
        root.addHandler(stream)
    try:
        path = log_path()
        already = any(
            isinstance(h, logging.FileHandler)
            and os.path.abspath(getattr(h, "baseFilename", "")) == os.path.abspath(path)
            for h in root.handlers
        )
        if not already:
            file_handler = RotatingFileHandler(
                path,
                maxBytes=2_000_000,
                backupCount=2,
                encoding="utf-8",
            )
            file_handler.setFormatter(formatter)
            root.addHandler(file_handler)
    except OSError as exc:
        root.warning("Impossible d'écrire le journal fichier : %s", exc)


setup_logging()
logger = logging.getLogger("solar-scanner")

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="SolarScan API",
    description="Détection de panneaux solaires par imagerie IGN (France uniquement)",
    version=APP_VERSION,
)

# L'interface Electron est servie en file:// : le navigateur envoie Origin: null.
# On n'ouvre pas l'API aux autres sites.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "X-SolarScan-Token"],
)

# ── Garde locale ──────────────────────────────────────────────────────────────

def _is_loopback(request: Request) -> bool:
    host = request.client.host if request.client else ""
    return host in {"127.0.0.1", "::1", "localhost"}


@app.middleware("http")
async def local_guard(request: Request, call_next):
    """Refuse tout ce qui ne vient pas de la machine, et exige le jeton local."""
    if request.method == "OPTIONS":
        return await call_next(request)

    if not _is_loopback(request):
        return JSONResponse(status_code=403, content={"detail": "Accès local uniquement"})

    if request.url.path == "/health":
        return await call_next(request)

    expected = os.environ.get("SOLARSCAN_TOKEN", "")
    if expected:
        provided = request.headers.get("x-solarscan-token", "")
        if not hmac.compare_digest(provided, expected):
            return JSONResponse(status_code=401, content={"detail": "Jeton local invalide"})
    elif request.url.path == "/shutdown":
        # Sans jeton (lancement manuel), on ne laisse personne éteindre le processus.
        return JSONResponse(status_code=403, content={"detail": "Arrêt désactivé"})

    return await call_next(request)


# ── Settings ──────────────────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    "price_per_m2": 3.0,
    "vat_rate": 0.20,
    "cleaning_time_per_m2": 2,
    "currency": "EUR",
    "cache_max_size_mb": 500,
    "max_tiles_auto": 20,
    "quote_validity_days": 30,
    "next_quote_number": 1,
}
MAX_SETTINGS_BYTES = 2_500_000


def load_settings() -> Dict:
    try:
        saved = json.loads(settings_path().read_text("utf-8"))
        if not isinstance(saved, dict):
            return DEFAULT_SETTINGS.copy()
        return {**DEFAULT_SETTINGS, **saved}
    except Exception:
        return DEFAULT_SETTINGS.copy()


def save_settings(settings: Dict) -> None:
    if not isinstance(settings, dict):
        raise ValueError("Réglages invalides")
    payload = json.dumps(settings, indent=2, ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_SETTINGS_BYTES:
        raise ValueError("Réglages trop volumineux")
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload, "utf-8")


# ── Schemas ───────────────────────────────────────────────────────────────────

class TileInfo(BaseModel):
    url: str = ""
    x: int
    y: int
    z: int
    bounds: Dict[str, float] = {}


class AnalyzeRequest(BaseModel):
    tiles: List[TileInfo]


class Detection(BaseModel):
    polygon: List[List[float]]
    area_m2: float
    confidence: float
    center: Dict[str, float]
    bounds: Dict[str, float]


class AnalyzeResponse(BaseModel):
    detections: List[Detection]
    tiles_processed: int
    tiles_failed: int
    elapsed_ms: int


class RoutePoint(BaseModel):
    lat: float
    lng: float


class RouteRequest(BaseModel):
    points: List[RoutePoint]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "SolarScan",
        "version": APP_VERSION,
        "engine": engine_name(),
        "note": "Données IGN — France uniquement",
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    if not request.tiles:
        raise HTTPException(status_code=400, detail="Aucune tuile fournie")

    start = time.time()
    try:
        tiles_data = sanitize_tiles([t.model_dump() for t in request.tiles])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    logger.info(f"Analyse : {len(tiles_data)} tuiles, zoom={tiles_data[0]['z']}")

    try:
        downloaded, download_errors = await download_tiles_batch(tiles_data)
    except Exception as exc:
        logger.error(
            "Erreur de téléchargement des tuiles IGN : %s: %s",
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        raise HTTPException(status_code=502, detail="Erreur de téléchargement des tuiles IGN")

    tiles_failed = len(tiles_data) - len(downloaded)
    logger.info(f"Tuiles reçues : {len(downloaded)}/{len(tiles_data)} ({tiles_failed} en échec)")

    if not downloaded:
        detail = download_failure_message(download_errors)
        logger.error(
            "Aucune tuile IGN reçue (%s demandées). %s Erreurs : %s",
            len(tiles_data),
            detail,
            " | ".join(download_errors) if download_errors else "(aucune)",
        )
        raise HTTPException(status_code=502, detail=detail)

    zoom = tiles_data[0]["z"]
    assembled = assemble_tiles(tiles_data, downloaded, zoom)

    if assembled is None:
        return AnalyzeResponse(
            detections=[],
            tiles_processed=len(downloaded),
            tiles_failed=tiles_failed,
            elapsed_ms=int((time.time() - start) * 1000),
        )

    composite_image, composite_bounds = assembled
    logger.info(f"Image assemblée : {composite_image.size}")

    try:
        raw_detections = analyze_image(composite_image, composite_bounds, zoom)
    except Exception as exc:
        logger.error(f"Erreur de détection : {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur de détection")

    elapsed = int((time.time() - start) * 1000)
    logger.info(f"Analyse terminée : {len(raw_detections)} détection(s) en {elapsed} ms")

    return AnalyzeResponse(
        detections=[Detection(**d) for d in raw_detections],
        tiles_processed=len(downloaded),
        tiles_failed=tiles_failed,
        elapsed_ms=elapsed,
    )


@app.get("/settings")
async def get_settings():
    return load_settings()


@app.put("/settings")
async def put_settings(settings: Dict):
    try:
        save_settings(settings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True}


@app.get("/cache/info")
async def cache_info():
    return {
        "size_mb": round(get_cache_size_mb(), 2),
        "ok": True,
    }


@app.delete("/cache/clear")
async def cache_clear():
    count = clear_tile_cache()
    return {"ok": True, "cleared": count}


@app.post("/shutdown")
async def shutdown():
    """Arrêt propre. Electron envoie le jeton ; un site web ne l'a pas."""
    logger.info("Arrêt demandé")
    os.kill(os.getpid(), signal.SIGTERM)
    return {"ok": True, "message": "Arrêt en cours"}


# ── Géocodage (proxy Nominatim, cache borné) ──────────────────────────────────

GEO_CACHE: "OrderedDict[str, object]" = OrderedDict()
NOMINATIM = "https://nominatim.openstreetmap.org"
NOMINATIM_HEADERS = {
    "User-Agent": "SolarScan/1.5 (application locale ; https://github.com/Dontbyshai/SolarScan)",
    "Accept-Language": "fr",
}


def _cache_get(key: str):
    if key not in GEO_CACHE:
        return None
    GEO_CACHE.move_to_end(key)
    return GEO_CACHE[key]


def _cache_set(key: str, value) -> None:
    GEO_CACHE[key] = value
    GEO_CACHE.move_to_end(key)
    while len(GEO_CACHE) > GEO_CACHE_MAX:
        GEO_CACHE.popitem(last=False)


async def _nominatim_get(path: str, params: Dict):
    timeout = aiohttp.ClientTimeout(total=12)
    async with client_session(timeout=timeout) as session:
        async with session.get(NOMINATIM + path, params=params, headers=NOMINATIM_HEADERS) as resp:
            if resp.status != 200:
                raise HTTPException(status_code=502, detail="Géocodage indisponible")
            return await resp.json()


@app.get("/geocode/search")
async def geocode_search(q: str):
    query = q.strip()
    if not query or len(query) > 200:
        raise HTTPException(status_code=400, detail="Recherche invalide")
    cached = _cache_get(f"s:{query}")
    if cached is not None:
        return cached
    try:
        data = await _nominatim_get("/search", {"format": "json", "q": query, "limit": "1"})
    except HTTPException:
        raise
    except Exception:
        logger.exception("Géocodage recherche")
        raise HTTPException(status_code=502, detail="Géocodage indisponible")
    _cache_set(f"s:{query}", data)
    return data


@app.get("/geocode/reverse")
async def geocode_reverse(lat: float, lon: float):
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(status_code=400, detail="Coordonnées invalides")
    key = f"r:{lat:.5f},{lon:.5f}"
    cached = _cache_get(key)
    if cached is not None:
        return cached
    try:
        data = await _nominatim_get("/reverse", {
            "format": "json",
            "lat": f"{lat:.5f}",
            "lon": f"{lon:.5f}",
            "zoom": "18",
            "addressdetails": "1",
        })
    except HTTPException:
        raise
    except Exception:
        logger.exception("Géocodage inverse")
        raise HTTPException(status_code=502, detail="Géocodage indisponible")
    _cache_set(key, data)
    return data


# ── Itinéraire (OSRM, hôte fixé) ──────────────────────────────────────────────

@app.post("/route")
async def route(body: RouteRequest):
    """Calcule un itinéraire routier. Les coordonnées sont les seules entrées."""
    if len(body.points) < 2 or len(body.points) > 25:
        raise HTTPException(status_code=400, detail="Entre 2 et 25 étapes")
    for point in body.points:
        if not (-90 <= point.lat <= 90 and -180 <= point.lng <= 180):
            raise HTTPException(status_code=400, detail="Coordonnées invalides")

    coords = ";".join(f"{point.lng:.6f},{point.lat:.6f}" for point in body.points)
    url = f"https://{OSRM_HOST}/route/v1/driving/{coords}"
    if urlparse(url).hostname != OSRM_HOST:
        raise HTTPException(status_code=400, detail="Hôte d'itinéraire refusé")

    timeout = aiohttp.ClientTimeout(total=20)
    try:
        async with client_session(timeout=timeout) as session:
            async with session.get(url, params={"overview": "full", "geometries": "geojson"}) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="Calcul d'itinéraire indisponible")
                return await resp.json()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Itinéraire")
        raise HTTPException(status_code=502, detail="Calcul d'itinéraire indisponible")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Passer l'objet `app` (et pas la chaîne "main:app") : PyInstaller
    # ne sait pas réimporter le module une fois l'exécutable gelé.
    logger.info("Dossier de données : %s", data_dir())
    logger.info("Journal : %s", log_path())
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("SOLARSCAN_PORT", "8765")),
        log_level="info",
    )
