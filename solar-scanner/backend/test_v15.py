"""Tests hors réseau de SolarScan 1.5 (chemins, tuiles, cache, heuristique, jeton)."""

import os
import tempfile
import unittest
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="solarscan-test-")
os.environ["SOLARSCAN_DATA_DIR"] = _TMP
os.environ["SOLARSCAN_TOKEN"] = "jeton-test"

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

import main  # noqa: E402
from detector import HeuristicDetector  # noqa: E402
from paths import cache_dir, model_path, settings_path  # noqa: E402
from tiles import sanitize_tiles  # noqa: E402


class PathsTests(unittest.TestCase):
    def test_donnees_dans_le_dossier_utilisateur(self):
        self.assertTrue(str(settings_path()).startswith(_TMP))
        self.assertEqual(settings_path().name, "settings.json")
        self.assertEqual(model_path().name, "solar_detector.pt")
        self.assertTrue(str(cache_dir()).startswith(_TMP))
        self.assertFalse(str(settings_path()).endswith("assets/settings.json"))


class TileTests(unittest.TestCase):
    def test_url_client_ignoree(self):
        tiles = sanitize_tiles([{
            "url": "http://169.254.169.254/latest/meta-data",
            "x": 130000,
            "y": 90000,
            "z": 18,
            "bounds": {"north": 0, "south": 0, "east": 0, "west": 0},
        }])
        self.assertEqual(len(tiles), 1)
        self.assertTrue(tiles[0]["url"].startswith("https://data.geopf.fr/"))
        self.assertNotIn("169.254", tiles[0]["url"])
        self.assertNotEqual(tiles[0]["bounds"]["north"], 0)

    def test_zoom_et_volume_refuses(self):
        with self.assertRaises(ValueError):
            sanitize_tiles([{"x": 1, "y": 1, "z": 30}])
        too_many = [{"x": 1, "y": 1, "z": 18} for _ in range(81)]
        with self.assertRaises(ValueError):
            sanitize_tiles(too_many)


class CacheTests(unittest.TestCase):
    def test_cache_nominatim_borne(self):
        main.GEO_CACHE.clear()
        for i in range(main.GEO_CACHE_MAX + 10):
            main._cache_set(f"k{i}", i)
        self.assertEqual(len(main.GEO_CACHE), main.GEO_CACHE_MAX)
        self.assertIsNone(main._cache_get("k0"))
        self.assertEqual(main._cache_get(f"k{main.GEO_CACHE_MAX + 9}"), main.GEO_CACHE_MAX + 9)


class HeuristicTests(unittest.TestCase):
    def test_panneau_bleu_seulement(self):
        img = Image.new("RGB", (320, 320), (46, 140, 52))
        px = img.load()
        for x in range(40, 130):
            for y in range(40, 110):
                px[x, y] = (28, 52, 108)
        for x in range(160, 280):
            for y in range(40, 140):
                px[x, y] = (236, 236, 236)
        for x in range(8, 310):
            for y in range(220, 236):
                px[x, y] = (42, 42, 46)

        found = HeuristicDetector().detect(img)
        self.assertEqual(len(found), 1, f"détections inattendues : {len(found)}")
        self.assertLessEqual(found[0]["confidence"], 0.70)
        self.assertGreaterEqual(found[0]["area_px"], 400)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app, client=("127.0.0.1", 50000))

    def test_health_sans_jeton(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["version"], "1.5.1")
        self.assertIn(body["engine"], ("yolo", "heuristique"))

    def test_analyse_exige_le_jeton(self):
        response = self.client.post("/analyze", json={"tiles": []})
        self.assertEqual(response.status_code, 401)

    def test_shutdown_sans_jeton(self):
        response = self.client.post("/shutdown")
        self.assertEqual(response.status_code, 401)

    def test_shutdown_desactive_sans_configuration(self):
        os.environ.pop("SOLARSCAN_TOKEN", None)
        try:
            response = self.client.post("/shutdown")
            self.assertEqual(response.status_code, 403)
        finally:
            os.environ["SOLARSCAN_TOKEN"] = "jeton-test"

    def test_origine_distante_refusee(self):
        other = TestClient(main.app, client=("8.8.8.8", 50000))
        response = other.get("/health")
        self.assertEqual(response.status_code, 403)


class SpecTests(unittest.TestCase):
    def test_spec_embarque_le_moteur(self):
        text = Path(__file__).with_name("solar_backend.spec").read_text(encoding="utf-8")
        self.assertIn("ultralytics", text)
        self.assertIn('"cv2"', text)
        self.assertIn("collect_all", text)


if __name__ == "__main__":
    unittest.main()
