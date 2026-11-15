# -*- mode: python ; coding: utf-8 -*-
"""
Build PyInstaller du moteur SolarScan.

Embarque OpenCV et Ultralytics (le code du moteur). Les poids YOLO ne sont
pas inclus : ils se téléchargent avec download_model.py dans le dossier
utilisateur, pour rester inscriptibles une fois l'application installée.
"""

from PyInstaller.utils.hooks import collect_all, collect_submodules

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
    "scipy",
    "shapely",
]

# Ces paquets sont importés tardivement (YOLO) ou livrent des fichiers
# que PyInstaller ne suit pas tout seul. Sans eux, l'installeur démarre
# puis tombe sur l'heuristique, ou ne démarre pas du tout.
for package in ("cv2", "ultralytics", "torch", "aiohttp", "uvicorn"):
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

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
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
