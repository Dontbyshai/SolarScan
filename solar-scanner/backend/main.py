"""
main.py — Serveur FastAPI pour Solar Scanner

Endpoints :
  GET  /health            → Health check pour Electron
  POST /analyze           → Analyse une liste de tuiles IGN
  GET  /settings          → Lit settings.json
  PUT  /settings          → Écrit settings.json
  GET  /cache/info        → Info sur le cache
  DELETE /cache/clear     → Vide le cache de tuiles
"""

import json
import logging
import time
from pathlib import Path
from typing import Dict, List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from detector import analyze_image
from tiles import download_tiles_batch, assemble_tiles, clear_tile_cache, get_cache_size_mb

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("solar-scanner")

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Solar Scanner API",
    description="Détection de panneaux solaires par imagerie IGN (France uniquement)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Settings ──────────────────────────────────────────────────────────────────

SETTINGS_PATH = Path(__file__).parent.parent / "assets" / "settings.json"

DEFAULT_SETTINGS = {
    "price_per_m2": 3.0,
    "vat_rate": 0.20,
    "cleaning_time_per_m2": 2,
    "currency": "EUR",
    "cache_max_size_mb": 500,
    "max_tiles_auto": 20,
}


def load_settings() -> Dict:
    try:
        return {**DEFAULT_SETTINGS, **json.loads(SETTINGS_PATH.read_text("utf-8"))}
    except Exception:
        return DEFAULT_SETTINGS.copy()


def save_settings(settings: Dict) -> None:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(settings, indent=2, ensure_ascii=False), "utf-8")


# ── Schemas ───────────────────────────────────────────────────────────────────

class TileInfo(BaseModel):
    url: str
    x: int
    y: int
    z: int
    bounds: Dict[str, float]


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


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "Solar Scanner AI",
        "version": "1.0.0",
        "note": "Données IGN — France uniquement",
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    if not request.tiles:
        raise HTTPException(status_code=400, detail="Aucune tuile fournie")

    start = time.time()
    tiles_data = [t.model_dump() for t in request.tiles]

    logger.info(f"Analyze request: {len(tiles_data)} tiles, zoom={tiles_data[0]['z'] if tiles_data else '?'}")

    # ── Download tiles ─────────────────────────────────────────────────────
    try:
        downloaded = await download_tiles_batch(tiles_data)
    except Exception as e:
        logger.error(f"Download error: {e}")
        raise HTTPException(status_code=502, detail=f"Erreur téléchargement tuiles: {str(e)}")

    tiles_failed = len(tiles_data) - len(downloaded)
    logger.info(f"Downloaded {len(downloaded)}/{len(tiles_data)} tiles ({tiles_failed} failed)")

    if not downloaded:
        raise HTTPException(
            status_code=502,
            detail="Impossible de télécharger les tuiles IGN. Vérifiez votre connexion internet."
        )

    # ── Assemble tiles ─────────────────────────────────────────────────────
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
    logger.info(f"Assembled image: {composite_image.size}, bounds={composite_bounds}")

    # ── AI Detection ───────────────────────────────────────────────────────
    try:
        raw_detections = analyze_image(composite_image, composite_bounds, zoom)
    except Exception as e:
        logger.error(f"Detection error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur détection IA: {str(e)}")

    elapsed = int((time.time() - start) * 1000)
    logger.info(f"Analysis complete: {len(raw_detections)} detections in {elapsed}ms")

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
    save_settings(settings)
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


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8765,
        reload=False,
        log_level="info",
    )
