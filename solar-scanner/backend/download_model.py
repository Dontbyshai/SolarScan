"""
Télécharge le poids YOLOv8 de détection de panneaux et l'enregistre
dans le dossier utilisateur (pas dans le dossier de l'application).

Usage, depuis solar-scanner/backend, environnement virtuel activé :

    python download_model.py

Au prochain lancement, SolarScan charge ce fichier. Sans lui, l'application
utilise l'heuristique de couleur.
"""

import shutil

from huggingface_hub import hf_hub_download

from paths import model_path

REPO_ID = "finloop/yolov8s-seg-solar-panels"
CANDIDATES = ("best.pt", "weights/best.pt")


def main() -> None:
    destination = model_path()
    print("Téléchargement du modèle YOLOv8 (panneaux solaires)…")
    print(f"Destination : {destination}")

    last_error = None
    for filename in CANDIDATES:
        try:
            downloaded = hf_hub_download(repo_id=REPO_ID, filename=filename)
            shutil.copy(downloaded, destination)
            print(f"Modèle enregistré : {destination}")
            return
        except Exception as exc:
            last_error = exc
            print(f"Fichier « {filename} » introuvable dans le dépôt ({exc}).")

    print("Échec du téléchargement. L'heuristique de couleur sera utilisée.")
    if last_error:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
