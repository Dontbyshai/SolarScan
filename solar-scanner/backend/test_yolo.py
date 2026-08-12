from ultralytics import YOLO
import cv2
import numpy as np
from pathlib import Path

MODEL_PATH = Path(__file__).parent.parent / "assets" / "model" / "solar_detector.pt"

print("Loading model...")
model = YOLO(str(MODEL_PATH))

print("Running inference...")
results = model("test_tile.jpg")

for r in results:
    img = r.plot()
    cv2.imwrite("test_yolo_result.jpg", img)
    
    if r.masks is not None:
        print(f"Detected {len(r.masks)} masks")
        for mask in r.masks.xy:
            print(f"Mask polygon points: {len(mask)}")
    else:
        print("No masks detected.")
        
print("Done")
