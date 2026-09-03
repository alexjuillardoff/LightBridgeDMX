#!/usr/bin/env python3
"""
Passerelle HTTP -> HAP/CoAP pour les ampoules HomeKit-sur-Thread.

Le backend Fastify est en TypeScript et ne sait pas parler HAP sur CoAP ; la seule
implementation utilisable de ce protocole est `aiohomekit`, en Python. Ce processus
fait donc le pont : il garde les connexions CoAP ouvertes vers les ampoules et
expose une petite API HTTP sur la boucle locale, que le SmartLightService consomme
comme n'importe quel autre backend de lampe.

Aucun Bluetooth ici : il n'est necessaire qu'a l'appairage (voir pair_bulb.py).
Ce service peut donc tourner sous launchd sans autorisation particuliere.

    GET  /health                 -> {"status":"ok","lights":N}
    GET  /lights                 -> [{alias,name,reachable,on,brightness,hue,sat}, ...]
    POST /lights/<alias>/state   <- {"on":true,"brightness":80,"hue":240,"sat":100}
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import pathlib
import sys

# Doit preceder tout import aiocoap : sur macOS, aiocoap n'active pas `udp6` et
# retombe sur un transport incapable de se lier a "::", ce qu'exige aiohomekit.
os.environ.setdefault("AIOCOAP_SERVER_TRANSPORT", "udp6")

from zeroconf.asyncio import AsyncServiceBrowser, AsyncZeroconf

from aiohomekit.controller import Controller
from aiohomekit.zeroconf import ZeroconfServiceListener

logger = logging.getLogger("sidecar")

# Types de caracteristiques HAP qui nous interessent. On resout les `iid` par TYPE
# au demarrage plutot que de les coder en dur : ils varient d'un modele a l'autre,
# et rien ne garantit qu'ils soient stables entre firmwares.
CHAR_TYPES = {
    "on": "00000025-0000-1000-8000-0026BB765291",
    "brightness": "00000008-0000-1000-8000-0026BB765291",
    "hue": "00000013-0000-1000-8000-0026BB765291",
    "sat": "0000002F-0000-1000-8000-0026BB765291",
}


class Light:
    """Une ampoule appairee, avec ses iid resolus et son verrou d'ecriture."""

    def __init__(self, alias: str, pairing):
        self.alias = alias
        self.pairing = pairing
        self.name = alias
        self.aid = 1
        self.iids: dict[str, int] = {}
        self.state: dict[str, object] = {"reachable": False}
        # Une seule ecriture a la fois par ampoule : Thread est un medium partage
        # et lent, empiler les requetes ne fait qu'allonger la file.
        self.lock = asyncio.Lock()

    async def resolve(self) -> bool:
        """Lit la base d'accessoires et retient les iid des caracteristiques utiles."""
        try:
            data = await self.pairing.list_accessories_and_characteristics()
        except Exception as err:
            logger.warning("%s : lecture impossible (%s)", self.alias, err)
            return False
        if not data:
            return False
        for acc in data:
            for svc in acc.get("services", []):
                for ch in svc.get("characteristics", []):
                    ctype = str(ch.get("type", "")).upper()
                    for key, full in CHAR_TYPES.items():
                        if ctype == full.upper():
                            self.aid = acc["aid"]
                            self.iids[key] = ch["iid"]
                    if str(ch.get("type", "")).upper().startswith("00000023"):
                        if ch.get("value"):
                            self.name = str(ch["value"])
        ok = "on" in self.iids
        logger.info("%s : %s -> iids %s", self.alias, self.name, self.iids)
        return ok

    async def refresh(self) -> None:
        """Relit l'etat courant depuis l'ampoule."""
        if not self.iids:
            return
        pairs = [(self.aid, iid) for iid in self.iids.values()]
        async with self.lock:
            try:
                res = await self.pairing.get_characteristics(pairs)
            except Exception as err:
                logger.debug("%s : refresh echoue (%s)", self.alias, err)
                self.state["reachable"] = False
                return
        rev = {iid: key for key, iid in self.iids.items()}
        for (_aid, iid), val in res.items():
            if iid in rev and "value" in val:
                self.state[rev[iid]] = val["value"]
        self.state["reachable"] = True

    async def apply(self, patch: dict) -> dict:
        """Ecrit les caracteristiques fournies. Renvoie l'etat mis a jour."""
        writes = []
        for key in ("on", "brightness", "hue", "sat"):
            if key not in patch or key not in self.iids:
                continue
            value = patch[key]
            if key == "on":
                value = bool(value)
            elif key == "brightness":
                value = max(0, min(100, int(round(float(value)))))
            elif key == "hue":
                value = max(0.0, min(360.0, float(value)))
            elif key == "sat":
                value = max(0.0, min(100.0, float(value)))
            writes.append((self.aid, self.iids[key], value))
            self.state[key] = value
        if not writes:
            return dict(self.state)
        async with self.lock:
            try:
                await self.pairing.put_characteristics(writes)
                self.state["reachable"] = True
            except Exception as err:
                logger.warning("%s : ecriture echouee (%s)", self.alias, err)
                self.state["reachable"] = False
        return dict(self.state)

    def snapshot(self) -> dict:
        return {"alias": self.alias, "name": self.name, **self.state}


class Sidecar:
    def __init__(self, store: pathlib.Path):
        self.store = store
        self.lights: dict[str, Light] = {}
        self.controller: Controller | None = None

    async def start(self, stack) -> None:
        azc = await stack.enter_async_context(AsyncZeroconf())
        AsyncServiceBrowser(
            azc.zeroconf,
            ["_hap._tcp.local.", "_hap._udp.local."],
            listener=ZeroconfServiceListener(),
        )
        controller = Controller(async_zeroconf_instance=azc)
        await stack.enter_async_context(controller)
        controller.load_data(str(self.store))
        self.controller = controller

        # Laisse zeroconf resoudre les adresses Thread courantes avant de dialoguer.
        await asyncio.sleep(5)

        for alias, pairing in controller.aliases.items():
            light = Light(alias, pairing)
            if await light.resolve():
                await light.refresh()
                self.lights[alias] = light
            else:
                logger.warning("%s ignoree (caracteristiques non resolues)", alias)
        logger.info("%d ampoule(s) prete(s)", len(self.lights))

    async def refresh_loop(self, interval: float) -> None:
        """Relit periodiquement l'etat, pour suivre un changement venu d'ailleurs."""
        while True:
            await asyncio.sleep(interval)
            for light in self.lights.values():
                await light.refresh()


# ─── Serveur HTTP minimal ───────────────────────────────────────────────────
# Volontairement ecrit a la main : ajouter aiohttp pour trois routes sur la boucle
# locale ne se justifie pas, et cela garde le sidecar sans dependance nouvelle.

async def handle(sidecar: Sidecar, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        line = await asyncio.wait_for(reader.readline(), timeout=10)
        if not line:
            return
        parts = line.decode("latin-1").split()
        if len(parts) < 2:
            return
        method, path = parts[0], parts[1]

        length = 0
        while True:
            header = await asyncio.wait_for(reader.readline(), timeout=10)
            if header in (b"\r\n", b"\n", b""):
                break
            name, _, value = header.decode("latin-1").partition(":")
            if name.strip().lower() == "content-length":
                length = int(value.strip() or 0)
        body = await reader.readexactly(length) if length else b""

        status, payload = await route(sidecar, method, path, body)
    except Exception as err:  # noqa: BLE001
        logger.exception("erreur de traitement")
        status, payload = 500, {"error": str(err)}

    raw = json.dumps(payload).encode()
    writer.write(
        b"HTTP/1.1 %d OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n"
        b"Connection: close\r\n\r\n" % (status, len(raw))
    )
    writer.write(raw)
    await writer.drain()
    writer.close()


async def route(sidecar: Sidecar, method: str, path: str, body: bytes):
    if path == "/health":
        return 200, {"status": "ok", "lights": len(sidecar.lights)}
    if path == "/lights" and method == "GET":
        return 200, [light.snapshot() for light in sidecar.lights.values()]
    if path.startswith("/lights/") and path.endswith("/state") and method == "POST":
        alias = path[len("/lights/"): -len("/state")]
        light = sidecar.lights.get(alias)
        if light is None:
            return 404, {"error": f"alias inconnu: {alias}"}
        patch = json.loads(body or b"{}")
        return 200, {"alias": alias, **await light.apply(patch)}
    return 404, {"error": "route inconnue"}


async def main_async(args) -> int:
    from contextlib import AsyncExitStack

    sidecar = Sidecar(pathlib.Path(args.file))
    async with AsyncExitStack() as stack:
        await sidecar.start(stack)
        if not sidecar.lights:
            logger.error("aucune ampoule utilisable — arret")
            return 1

        asyncio.create_task(sidecar.refresh_loop(args.refresh))
        server = await asyncio.start_server(
            lambda r, w: handle(sidecar, r, w), args.host, args.port
        )
        logger.info("sidecar a l'ecoute sur http://%s:%d", args.host, args.port)
        async with server:
            await server.serve_forever()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    here = pathlib.Path(__file__).parent
    parser.add_argument("--file", default=str(here / "pairings.json"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5056)
    parser.add_argument("--refresh", type=float, default=30.0,
                        help="periode de relecture de l'etat, en secondes")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    for noisy in ("zeroconf", "aiocoap", "aiohomekit"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
