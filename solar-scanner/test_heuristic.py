import math
import cv2
import numpy as np
import urllib.request
import os

def latlng_to_tile(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile

z = 19
x, y = latlng_to_tile(45.91369, 2.66444, z)
print(f"Tile: {z}/{x}/{y}")

url = f"https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fjpeg&STYLE=normal"

req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as response:
    img_data = response.read()

img_array = np.asarray(bytearray(img_data), dtype=np.uint8)
img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

cv2.imwrite("test_tile.jpg", img)

# Run heuristic
img_hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
mask_pv_blue = cv2.inRange(img_hsv, np.array([70, 0, 0]), np.array([160, 255, 255]))
mask_dark_gray = cv2.inRange(img_hsv, np.array([0, 0, 0]), np.array([180, 85, 255]))
mask_combined = cv2.bitwise_or(mask_pv_blue, mask_dark_gray)
mask_veg = cv2.inRange(img_hsv, np.array([35, 40, 0]), np.array([85, 255, 255]))
mask_final = cv2.bitwise_and(mask_combined, cv2.bitwise_not(mask_veg))
kernel_close = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
kernel_open = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
mask_final = cv2.morphologyEx(mask_final, cv2.MORPH_CLOSE, kernel_close)
mask_final = cv2.morphologyEx(mask_final, cv2.MORPH_OPEN, kernel_open)

cv2.imwrite("test_mask.jpg", mask_final)

contours, _ = cv2.findContours(mask_final, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
for cnt in contours:
    area = cv2.contourArea(cnt)
    if area < 100: continue
    rect = cv2.minAreaRect(cnt)
    box = cv2.boxPoints(rect)
    box_area = cv2.contourArea(box)
    ratio = area / box_area if box_area > 0 else 0
    print(f"Area: {area}, Ratio: {ratio}")
    if ratio >= 0.60:
        cv2.drawContours(img, [np.int32(box)], 0, (0, 165, 255), 2)

cv2.imwrite("test_result.jpg", img)
print("Done")
