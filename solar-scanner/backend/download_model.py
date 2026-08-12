import os
from huggingface_hub import hf_hub_download
from pathlib import Path

MODEL_DIR = Path(__file__).parent.parent / "assets" / "model"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
MODEL_PATH = MODEL_DIR / "solar_detector.pt"

print("Downloading YOLOv8 solar panel model from HuggingFace...")
try:
    downloaded_path = hf_hub_download(
        repo_id="finloop/yolov8s-seg-solar-panels",
        filename="best.pt", # Usually YOLO models are named best.pt or weights/best.pt. I will try 'best.pt' first.
    )
    import shutil
    shutil.copy(downloaded_path, MODEL_PATH)
    print(f"Model successfully saved to {MODEL_PATH}")
except Exception as e:
    print(f"Error downloading best.pt: {e}")
    try:
        downloaded_path = hf_hub_download(
            repo_id="finloop/yolov8s-seg-solar-panels",
            filename="weights/best.pt",
        )
        import shutil
        shutil.copy(downloaded_path, MODEL_PATH)
        print(f"Model successfully saved to {MODEL_PATH}")
    except Exception as e2:
        print(f"Error downloading weights/best.pt: {e2}")

