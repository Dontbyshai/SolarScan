"""
detector.py — Pipeline de détection de panneaux solaires

Mode 1 (ONNX) : si solar_detector.onnx est présent dans assets/model/
Mode 2 (Heuristique MVP) : segmentation par couleur/texture (bleu foncé / gris-bleuté)

Le pipeline retourne des détections GeoJSON-compatible.
"""

import logging
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

from geo_utils import (
    pixels_to_m2,
    pixel_coords_to_geo,
    resolution_at_zoom,
    geo_polygon_center,
)

logger = logging.getLogger(__name__)

# ── Model paths ────────────────────────────────────────────────────────────────
MODEL_PATH = Path(__file__).parent.parent / "assets" / "model" / "solar_detector.pt"
MIN_PANEL_AREA_PX = 400     # Filtre les trop petits objets (~6m² à zoom 19)
MAX_PANEL_AREA_PX = 200_000  # Filtre les régions aberrantes
CONFIDENCE_HEURISTIC = 0.65   # Confiance assignée au mode heuristique


# ─────────────────────────────────────────────────────────────────────────────
# ONNX Detector (si modèle disponible)
# ─────────────────────────────────────────────────────────────────────────────

class YoloDetector:
    def __init__(self, model_path: Path):
        from ultralytics import YOLO
        self.model = YOLO(str(model_path))
        logger.info(f"YOLOv8 model loaded from: {model_path.name}")

    def detect(self, image: Image.Image) -> List[Dict]:
        # iou=0.45 ensures that overlapping overlapping panels are suppressed
        results = self.model(image, verbose=False, conf=0.25, iou=0.45)
        detections = []
        
        for r in results:
            if r.masks is None or r.boxes is None:
                continue
            
            # Retrieve polygon coordinates from mask
            for mask, box in zip(r.masks.xy, r.boxes):
                poly_px = mask.tolist()  # list of [x, y]
                conf = float(box.conf[0])
                
                # Simplify the polygon to remove jagged edges (make it more rectangular/straight)
                if len(poly_px) >= 3:
                    pts = np.array(poly_px, dtype=np.float32)
                    epsilon = 0.008 * cv2.arcLength(pts, True)
                    approx = cv2.approxPolyDP(pts, epsilon, True)
                    poly_px = approx.squeeze().tolist()
                    # Ensure poly_px is a list of lists even if only 1 point (though we need >=3)
                    if len(poly_px) > 0 and not isinstance(poly_px[0], list):
                        poly_px = [poly_px]

                # Bounding box
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                bbox = (int(x1), int(y1), int(x2 - x1), int(y2 - y1))
                
                # Create a black mask to compute exact pixel area
                w, h = image.size
                region_mask = np.zeros((h, w), dtype=np.uint8)
                if len(poly_px) >= 3:
                    pts_int = np.array(poly_px, dtype=np.int32)
                    cv2.fillPoly(region_mask, [pts_int], 255)
                area_px = int(np.sum(region_mask) / 255)

                detections.append({
                    "mask": region_mask.astype(bool),
                    "polygon_px": poly_px,
                    "bbox": bbox,
                    "area_px": area_px,
                    "confidence": round(conf, 3),
                })
                
        logger.info(f"YOLOv8 detected {len(detections)} regions")
        return detections


# ─────────────────────────────────────────────────────────────────────────────
# Heuristic Detector (MVP, no model required)
# ─────────────────────────────────────────────────────────────────────────────

class HeuristicDetector:
    """
    Détection de panneaux solaires par analyse visuelle de couleur/texture.
    
    Les panneaux solaires photovoltaïques ont une signature visuelle distinctive :
    - Teinte bleu-gris à noir-bleuté (silicium et cellules PV)
    - Surface uniforme et réfléchissante
    - Bords rectilignes
    - Contraste avec la toiture environnante
    
    Pipeline :
    1. Conversion BGR → LAB + HSV
    2. Masque de couleur (teinte bleu-gris, faible saturation, faible luminosité)
    3. Nettoyage morphologique
    4. Extraction des contours + filtrage géométrique
    5. Calcul de confiance basé sur rectangularité et compacité
    """

    def detect(self, image: Image.Image) -> List[Dict]:
        """
        Retourne une liste de régions détectées :
        [{"mask": np.array(bool), "confidence": float, "bbox": (x,y,w,h)}]
        """
        img_bgr = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)
        img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
        img_lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2Lab)

        h, w = img_bgr.shape[:2]

        # ── Masque couleur PV ──────────────────────────────────────────────
        # Bleu / Violet (tolérance totale sur Saturation et Luminosité)
        mask_pv_blue = cv2.inRange(img_hsv,
            np.array([70, 0, 0]),
            np.array([160, 255, 255])
        )

        # Gris / Noir / Blanc (toute teinte, mais saturation faible/moyenne < 85)
        mask_dark_gray = cv2.inRange(img_hsv,
            np.array([0, 0, 0]),
            np.array([180, 85, 255])
        )

        # Combine masks
        mask_combined = cv2.bitwise_or(mask_pv_blue, mask_dark_gray)
        
        # ── EXCLUSION VEGETATION ───────────────────────────────────────────
        # Rejeter l'herbe et les arbres (teinte verte / jaune-verte) avec une saturation > 40
        mask_veg = cv2.inRange(img_hsv, np.array([35, 40, 0]), np.array([85, 255, 255]))
        mask_final = cv2.bitwise_and(mask_combined, cv2.bitwise_not(mask_veg))

        # (On supprime le masque de texture car les grilles des gros panneaux créent trop de variance)

        # ── Morphologie ────────────────────────────────────────────────────
        # Un kernel de 15x15 fusionnait trop les panneaux adjacents et les ombres
        kernel_close = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        kernel_open = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        mask_final = cv2.morphologyEx(mask_final, cv2.MORPH_CLOSE, kernel_close)
        mask_final = cv2.morphologyEx(mask_final, cv2.MORPH_OPEN, kernel_open)

        # ── Contours ───────────────────────────────────────────────────────
        contours, _ = cv2.findContours(mask_final, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        detections = []
        for cnt in contours:
            area_px = cv2.contourArea(cnt)
            # Accepter les panneaux beaucoup plus grands (MAX 1_000_000)
            if area_px < MIN_PANEL_AREA_PX or area_px > 1000000:
                continue

            # Rectangularité (ratio aire réelle / aire minAreaRect orientée)
            x, y, bw, bh = cv2.boundingRect(cnt)
            rect = cv2.minAreaRect(cnt)
            box = cv2.boxPoints(rect)
            box_area = cv2.contourArea(box)
            rect_ratio = area_px / box_area if box_area > 0 else 0

            # Si ce n'est pas très rectangulaire (ex: végétation résiduelle, ombres), on ignore
            # Pour les grands panneaux, les ombres ou les découpes par la limite de la tuile déforment
            # fortement la bounding box. On est très tolérant sur le ratio.
            if area_px > 2000:
                if rect_ratio < 0.30:
                    continue
            else:
                if rect_ratio < 0.60:
                    continue

            # Compacité (circulaire = 1, carré = ~0.785)
            perimeter = cv2.arcLength(cnt, True)
            compactness = (4 * math.pi * area_px) / (perimeter ** 2) if perimeter > 0 else 0

            # Aspect ratio (les panneaux ont un ratio raisonnable)
            aspect = max(bw, bh) / max(min(bw, bh), 1)

            # Score de confiance heuristique
            conf = CONFIDENCE_HEURISTIC
            if rect_ratio > 0.7:
                conf = min(conf + 0.1, 0.88)
            if aspect > 5:
                conf = max(conf - 0.15, 0.40)
            if area_px < 800:
                conf = max(conf - 0.10, 0.40)

            # Approx polygone
            epsilon = 0.02 * cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, epsilon, True)
            poly_px = approx.squeeze().tolist()
            if not isinstance(poly_px[0], list):
                poly_px = [poly_px]  # Single point edge case

            # Mask de cette région (pour calcul pixel exact)
            region_mask = np.zeros((h, w), dtype=np.uint8)
            cv2.drawContours(region_mask, [cnt], -1, 255, -1)

            detections.append({
                "mask": region_mask.astype(bool),
                "polygon_px": poly_px,
                "bbox": (x, y, bw, bh),
                "area_px": area_px,
                "confidence": round(conf, 3),
            })

        logger.info(f"Heuristic detected {len(detections)} regions")
        return detections

    @staticmethod
    def _local_std(gray: np.ndarray, ksize: int = 7) -> np.ndarray:
        """Écart-type local dans un voisinage ksize×ksize."""
        mean = cv2.boxFilter(gray, -1, (ksize, ksize))
        mean_sq = cv2.boxFilter(gray ** 2, -1, (ksize, ksize))
        variance = np.maximum(mean_sq - mean ** 2, 0)
        return np.sqrt(variance)


# ─────────────────────────────────────────────────────────────────────────────
# Main pipeline
# ─────────────────────────────────────────────────────────────────────────────

_yolo_detector: Optional[YoloDetector] = None
_heuristic_detector = HeuristicDetector()


def _get_detector():
    global _yolo_detector
    if MODEL_PATH.exists() and _yolo_detector is None:
        try:
            _yolo_detector = YoloDetector(MODEL_PATH)
            logger.info("Using YOLOv8 detector")
        except Exception as e:
            logger.warning(f"Failed to load YOLO model: {e}. Falling back to heuristic.")
            _yolo_detector = None

    return _yolo_detector if _yolo_detector else None


def analyze_image(
    image: Image.Image,
    composite_bounds: Dict,
    zoom: int,
) -> List[Dict]:
    """
    Analyse une image composite et retourne les détections GeoJSON.
    
    Returns:
        List of {
            "polygon": [[lng, lat], ...],   # GeoJSON order
            "area_m2": float,
            "confidence": float,
            "center": {"lat": float, "lng": float},
            "bounds": {...}
        }
    """
    img_w, img_h = image.size
    lat_center = (composite_bounds["north"] + composite_bounds["south"]) / 2

    detector = _get_detector()

    if detector:
        # ONNX pipeline (à compléter avec fine-tuned model)
        raw_detections = detector.detect(image)
    else:
        # Heuristic pipeline
        raw_detections = _heuristic_detector.detect(image)

    results = []

    for det in raw_detections:
        poly_px = det.get("polygon_px", [])
        area_px = det.get("area_px", 0)
        confidence = det.get("confidence", CONFIDENCE_HEURISTIC)
        mask: Optional[np.ndarray] = det.get("mask")

        # Pixel area from mask (more accurate than bbox)
        if mask is not None:
            area_px = int(np.sum(mask))

        # Convert area to m²
        area_m2 = pixels_to_m2(area_px, zoom, lat_center)

        # Skip implausible panels (< 1m² or > 5000m²)
        if area_m2 < 1.0 or area_m2 > 5000.0:
            continue

        # Convert pixel polygon to geographic coords [lng, lat]
        geo_polygon = []
        if poly_px and len(poly_px) >= 3:
            for pt in poly_px:
                if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                    lat, lng = pixel_coords_to_geo(pt[0], pt[1], img_w, img_h, composite_bounds)
                    geo_polygon.append([lng, lat])
            # Close the polygon
            if geo_polygon and geo_polygon[0] != geo_polygon[-1]:
                geo_polygon.append(geo_polygon[0])
        else:
            # Fallback: use bbox
            x, y, bw, bh = det.get("bbox", (0, 0, 1, 1))
            corners = [(x, y), (x+bw, y), (x+bw, y+bh), (x, y+bh), (x, y)]
            for px, py in corners:
                lat, lng = pixel_coords_to_geo(px, py, img_w, img_h, composite_bounds)
                geo_polygon.append([lng, lat])

        if len(geo_polygon) < 4:
            continue

        center = geo_polygon_center(geo_polygon)

        # Compute geographic bounds of this detection
        lats = [p[1] for p in geo_polygon]
        lngs = [p[0] for p in geo_polygon]
        det_bounds = {
            "north": max(lats), "south": min(lats),
            "east": max(lngs), "west": min(lngs),
        }

        results.append({
            "polygon": geo_polygon,
            "area_m2": round(area_m2, 2),
            "confidence": confidence,
            "center": center,
            "bounds": det_bounds,
        })

    logger.info(f"Final: {len(results)} valid solar panel detections")
    return results
