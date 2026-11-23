"""
Contexte SSL partagé pour les requêtes HTTPS du moteur (tuiles IGN,
Nominatim, OSRM).

Dans l'exécutable PyInstaller, surtout sur macOS, OpenSSL ne trouve
souvent aucun certificat d'autorité système. On pointe donc
explicitement vers le cacert.pem de certifi, embarqué dans l'app.
La vérification SSL reste activée : on ne désactive pas ssl.
"""

from __future__ import annotations

import ssl
from typing import Optional

import aiohttp
import certifi


def ssl_context() -> ssl.SSLContext:
    """Contexte TLS qui vérifie les certificats avec le bundle certifi."""
    return ssl.create_default_context(cafile=certifi.where())


def client_session(
    *,
    timeout: Optional[aiohttp.ClientTimeout] = None,
    limit: int = 100,
    **kwargs,
) -> aiohttp.ClientSession:
    """Session aiohttp avec vérification SSL via certifi."""
    connector = aiohttp.TCPConnector(ssl=ssl_context(), limit=limit)
    return aiohttp.ClientSession(connector=connector, timeout=timeout, **kwargs)
