"""
paths.py — Dossiers inscriptibles de SolarScan.

En version installée, le dossier du programme (et le dossier temporaire
PyInstaller) est souvent en lecture seule. Réglages, cache de tuiles et
modèle IA vivent donc dans un dossier utilisateur.

Electron transmet ce dossier via SOLARSCAN_DATA_DIR
(app.getPath('userData')). Sans cette variable, on retombe sur le même
emplacement que l'application bureau.
"""

import os
import shutil
import sys
from pathlib import Path

APP_DIR_NAME = "SolarScan"


def data_dir() -> Path:
    """Dossier utilisateur inscriptible (réglages, cache, modèle)."""
    raw = os.environ.get("SOLARSCAN_DATA_DIR", "").strip()
    if raw:
        path = Path(raw).expanduser()
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / APP_DIR_NAME
    elif sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        path = Path(base) / APP_DIR_NAME
    else:
        config = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
        path = Path(config) / APP_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def settings_path() -> Path:
    return data_dir() / "settings.json"


def cache_dir() -> Path:
    path = data_dir() / "cache"
    path.mkdir(parents=True, exist_ok=True)
    return path


def log_path() -> Path:
    """Journal du moteur, dans le dossier utilisateur."""
    return data_dir() / "backend.log"


def model_path() -> Path:
    """Emplacement du poids YOLO, toujours dans le dossier utilisateur."""
    path = data_dir() / "model" / "solar_detector.pt"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def bundled_model_path() -> Path:
    """
    Emplacement du poids YOLO livré avec l'application.
    Dans l'exécutable PyInstaller, le fichier est extrait dans _MEIPASS/model/.
    """
    candidates = []
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidates.append(Path(meipass) / "model" / "solar_detector.pt")
        candidates.append(Path(sys.executable).resolve().parent / "model" / "solar_detector.pt")
    candidates.append(
        Path(__file__).resolve().parent.parent / "assets" / "model" / "solar_detector.pt"
    )
    for path in candidates:
        if path.exists():
            return path
    return candidates[-1]


def legacy_model_path() -> Path:
    """Ancien emplacement (dépôt / paquet), souvent en lecture seule."""
    return bundled_model_path()


def resolve_model_path() -> Path:
    """
    Utilise le modèle du dossier utilisateur.
    S'il n'existe pas encore, on recopie le poids embarqué (bundle ou assets/).
    """
    dest = model_path()
    if dest.exists():
        return dest
    bundled = bundled_model_path()
    if bundled.exists() and bundled.resolve() != dest.resolve():
        try:
            shutil.copy2(bundled, dest)
            return dest
        except OSError:
            return bundled
    return dest
