# -*- mode: python ; coding: utf-8 -*-
"""
Build PyInstaller du moteur SolarScan.

Embarque OpenCV, Ultralytics, torch/torchvision (y compris les libs
C++ _C_stable / image_stable nécessaires à NMS) et le poids YOLO
(solar_detector.pt). Une copie du poids est ensuite placée dans le
dossier utilisateur, inscriptible.
"""

from pathlib import Path

from PyInstaller.utils.hooks import (
    collect_all,
    collect_data_files,
    collect_dynamic_libs,
    collect_submodules,
)

datas = []
binaries = []
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "cv2",
    "numpy",
    "PIL",
    "aiohttp",
    "fastapi",
    "starlette",
    "pydantic",
    "ultralytics",
    "torch",
    "torchvision",
    "torchvision.ops",
    "torchvision.extension",
    "scipy",
    "shapely",
    "certifi",
]

# Ces paquets sont importés tardivement (YOLO) ou livrent des fichiers
# que PyInstaller ne suit pas tout seul. Sans eux, l'installeur démarre
# puis tombe sur l'heuristique, ou ne démarre pas du tout.
for package in ("cv2", "ultralytics", "torch", "torchvision", "aiohttp", "uvicorn"):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
    except Exception as exc:
        raise SystemExit(
            f"Impossible d'embarquer {package}. "
            f"Installez requirements.txt avant PyInstaller. Détail : {exc}"
        )
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

hiddenimports += collect_submodules("ultralytics")
hiddenimports += collect_submodules("torchvision")
binaries += collect_dynamic_libs("torchvision")
binaries += collect_dynamic_libs("torch")

# torchvision 0.29+ livre _C_stable / image_stable, chargés par
# torch.ops.load_library (pas par « import torchvision._C »).
# PyInstaller ne les suit souvent pas : on les place explicitement
# à côté du paquet, là où extension._get_extension_path les cherche.
import torchvision as _tv  # noqa: E402

_tv_dir = Path(_tv.__file__).resolve().parent
_tv_exts = {".so", ".dylib", ".dll", ".pyd"}
for _pattern in ("_C*", "_C_stable*", "image_stable*", "*.so", "*.dylib", "*.dll", "*.pyd"):
    for _f in _tv_dir.glob(_pattern):
        if _f.is_file() and _f.suffix.lower() in _tv_exts:
            binaries.append((str(_f), "torchvision"))

# cacert.pem : sans ce fichier, le contexte SSL de http_ssl.py
# ne trouve aucune autorité dans l'exécutable gelé.
datas += collect_data_files("certifi")

# Poids YOLOv8 (finloop/yolov8s-seg-solar-panels) : sans lui, /health
# annonce « heuristique » et le scan est beaucoup moins fiable.
_model = Path(SPEC).resolve().parent.parent / "assets" / "model" / "solar_detector.pt"
if not _model.is_file():
    raise SystemExit(f"Modèle YOLO manquant : {_model}")
datas += [(str(_model), "model")]

_hook = Path(SPEC).resolve().parent / "pyi_rth_torchvision_ops.py"
if not _hook.is_file():
    raise SystemExit(f"Runtime hook torchvision manquant : {_hook}")

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[str(_hook)],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="solar_backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
