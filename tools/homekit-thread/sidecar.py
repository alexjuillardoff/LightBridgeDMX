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
import ipaddress
import json
import logging
import os
import pathlib
import resource
import sys
import time

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
    # Temperature de couleur, en MIRED (l'unite HAP) : 153 = blanc froid,
    # 470 = blanc chaud sur un NL45. La conversion depuis les Kelvin se fait
    # cote LightBridge ; le sidecar reste un relais fidele au protocole.
    "ct": "000000CE-0000-1000-8000-0026BB765291",
}

# Bornes de repli si l'ampoule ne declare pas sa plage (valeurs du NL45).
CT_FALLBACK_RANGE = (153, 470)

# Attente maximale du verrou d'ecriture, en secondes. Le backend abandonne au bout de
# 4 s : au-dela, la requete n'a plus personne a qui repondre, mais sa socket restait
# ouverte jusqu'a la fin de l'ecriture en cours. Le 2026-10-05, ces sockets en
# CLOSE_WAIT ont epuise les 256 descripteurs accordes par launchd (« Too many open
# files ») : le sidecar ne pouvait plus ni accepter de requete, ni lancer un ping.
WRITE_WAIT = 3.0


class Light:
    """Une ampoule appairee, avec ses iid resolus et son verrou d'ecriture."""

    def __init__(self, alias: str, pairing):
        self.alias = alias
        self.pairing = pairing
        self.name = alias
        self.aid = 1
        self.iids: dict[str, int] = {}
        # Plage declaree par l'ampoule pour chaque caracteristique bornee : on
        # ecrete dessus plutot que sur des constantes, une autre reference
        # Nanoleaf pouvant annoncer d'autres limites.
        self.ranges: dict[str, tuple[float, float]] = {}
        self.state: dict[str, object] = {"reachable": False}
        # Une seule ecriture a la fois par ampoule : Thread est un medium partage
        # et lent, empiler les requetes ne fait qu'allonger la file.
        self.lock = asyncio.Lock()
        # Ecritures en attente du verrou, fusionnees. Le backend pousse toutes les
        # 250 ms et abandonne apres 4 s : quand une ecriture traine (reconnexion,
        # 8 s et plus), les requetes s'empilaient et etaient rejouees une a une,
        # couleurs perimees comprises. Desormais seules les dernieres valeurs partent.
        self.pending: dict[str, object] = {}
        # Debut de la serie d'echecs en cours (None si le dernier echange a reussi).
        # Lu par le chien de garde du Sidecar.
        self.failing_since: float | None = None
        # Dernier diagnostic du chien de garde, pour ne journaliser que les changements.
        self.verdict: str | None = None

    def _mark(self, ok: bool) -> None:
        self.state["reachable"] = ok
        if ok:
            self.failing_since = None
            self.verdict = None
        elif self.failing_since is None:
            self.failing_since = time.monotonic()

    @property
    def host(self) -> str:
        """Adresse IPv6 courante, telle qu'aiohomekit la suit via zeroconf."""
        return self.pairing.connection.address.rsplit(":", 1)[0].strip("[]")

    @property
    def port(self) -> str:
        return self.pairing.connection.address.rsplit(":", 1)[1]

    def stuck(self, now: float, grace: float) -> bool:
        return self.failing_since is not None and now - self.failing_since > grace

    def candidates(self) -> list[str]:
        """Toutes les adresses connues de l'ampoule, celle en service d'abord.

        aiohomekit ne garde que la DERNIERE adresse annoncee en mDNS. Le 2026-10-05, les
        ampoules ont brievement porte une adresse dans un second prefixe Thread
        (fd3c:b774:c3f0:1::/64) que le Mac ne savait pas router ; aiohomekit l'a adoptee
        et n'en est jamais revenu, alors que l'adresse d'origine repondait toujours.
        """
        desc = getattr(self.pairing, "description", None)
        addrs = [self.host, *(desc.addresses if desc else []),
                 self.pairing.pairing_data.get("AccessoryIP")]
        normalized = []
        for addr in addrs:
            try:
                normalized.append(ipaddress.ip_address(addr).compressed)
            except (TypeError, ValueError):
                continue
        return list(dict.fromkeys(normalized))

    async def diagnose(self) -> str:
        """Pourquoi l'ampoule echoue-t-elle ? Repare sur place ce qui peut l'etre.

        'session' : son adresse repond au ping, l'echec est interne au processus ;
        'moved'   : son adresse est muette mais une autre repond — on y bascule ;
        'down'    : aucune ne repond (courant coupe, maillage en panne).
        """
        addrs = self.candidates()
        alive = await asyncio.gather(*(ping(a) for a in addrs))
        if alive[0]:
            verdict = "session"
        elif any(alive):
            verdict = "moved"
            target = addrs[alive.index(True)]
            logger.warning("%s : %s muette, bascule sur %s", self.alias, addrs[0], target)
            # Le geste d'aiohomekit lui-meme quand zeroconf annonce une nouvelle adresse.
            self.pairing.connection.address = f"[{target}]:{self.port}"
            try:
                await asyncio.wait_for(self.pairing.connection.reconnect_soon(), timeout=5)
            except asyncio.TimeoutError:
                # Contexte CoAP bloque a la fermeture : l'abandonner, la prochaine
                # ecriture en ouvrira un neuf vers la nouvelle adresse.
                self.pairing.connection.enc_ctx = None
            # Nouvelle periode de grace : laisser a la nouvelle adresse le temps de servir.
            self.failing_since = time.monotonic()
        else:
            verdict = "down"
        if verdict != self.verdict and verdict != "moved":
            logger.warning("%s : en echec, %s (adresses testees : %s)", self.alias,
                           "joignable au ping" if verdict == "session"
                           else "aucune adresse ne repond", ", ".join(addrs))
        self.verdict = verdict
        return verdict

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
                            lo, hi = ch.get("minValue"), ch.get("maxValue")
                            if lo is not None and hi is not None:
                                self.ranges[key] = (float(lo), float(hi))
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
                self._mark(False)
                return
        rev = {iid: key for key, iid in self.iids.items()}
        for (_aid, iid), val in res.items():
            if iid in rev and "value" in val:
                self.state[rev[iid]] = val["value"]
        self._mark(True)

    async def apply(self, patch: dict) -> dict | None:
        """Ecrit les caracteristiques fournies. Renvoie l'etat mis a jour, ou None si
        le verrou n'a pas ete obtenu a temps (WRITE_WAIT)."""
        self.pending.update(patch)
        try:
            await asyncio.wait_for(self.lock.acquire(), timeout=WRITE_WAIT)
        except asyncio.TimeoutError:
            # Le patch reste dans `pending` : le prochain appel l'emportera. Le backend
            # renvoie de toute facon tout ecart non confirme a sa prochaine poussee.
            return None
        try:
            # Un appel arrive pendant l'attente a pu emporter ce patch avec le sien.
            if not self.pending:
                return dict(self.state)
            merged, self.pending = self.pending, {}
            await self._write(merged)
        finally:
            self.lock.release()
        return dict(self.state)

    async def _write(self, patch: dict) -> None:
        """Envoie un patch a l'ampoule. Appele verrou tenu."""
        writes = []
        for key in ("on", "brightness", "hue", "sat", "ct"):
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
            elif key == "ct":
                # En mired, borne sur ce que l'ampoule declare elle-meme.
                lo, hi = self.ranges.get("ct", CT_FALLBACK_RANGE)
                value = int(round(max(lo, min(hi, float(value)))))
            writes.append((self.aid, self.iids[key], value))
            self.state[key] = value
        if not writes:
            return
        try:
            await self.pairing.put_characteristics(writes)
            self._mark(True)
        except Exception as err:
            logger.warning("%s : ecriture echouee (%s)", self.alias, err)
            self._mark(False)

    def snapshot(self) -> dict:
        return {"alias": self.alias, "name": self.name, **self.state}


class Sidecar:
    def __init__(self, store: pathlib.Path):
        self.store = store
        self.lights: dict[str, Light] = {}
        # Appairees mais illisibles au demarrage (ampoule hors tension, typiquement) :
        # retentees a chaque tour de refresh plutot qu'oubliees jusqu'au prochain lancement.
        self.unresolved: dict[str, Light] = {}
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
            self.unresolved[alias] = Light(alias, pairing)
        await self.resolve_pending()
        logger.info("%d ampoule(s) prete(s)", len(self.lights))

    async def resolve_pending(self) -> None:
        for alias, light in list(self.unresolved.items()):
            if await light.resolve():
                await light.refresh()
                self.lights[alias] = self.unresolved.pop(alias)
            else:
                logger.warning("%s en attente (caracteristiques non resolues)", alias)

    async def refresh_loop(self, interval: float) -> None:
        """Relit periodiquement l'etat, pour suivre un changement venu d'ailleurs."""
        while True:
            await asyncio.sleep(interval)
            for light in self.lights.values():
                await light.refresh()
            if self.unresolved:
                await self.resolve_pending()

    async def watchdog(self, grace: float) -> None:
        """Termine le processus quand ses sessions HAP sont irrecuperables.

        Le 2026-09-15, apres onze jours de service, toutes les ampoules ont echoue en
        boucle (« failed to connect ») pendant que le ping6 repondait, qu'elles
        restaient appairees et que leur adresse n'avait pas bouge. aiohomekit retentait
        pourtant la verification de paire a chaque appel : l'etat fautif etait interne
        au processus, et seul un redemarrage l'a efface — en deux secondes.

        On reproduit donc ce remede, sous deux conditions pour ne pas boucler a vide :
        TOUTES les ampoules echouent depuis `grace` secondes (une seule ampoule
        debranchee ne suffit pas), et au moins l'une d'elles repond au ping (sinon
        c'est le maillage ou le courant, qu'un redemarrage ne reparerait pas).
        launchd (KeepAlive) relance ensuite le sidecar.

        Le ping ne vise pas seulement l'adresse en service : le 2026-10-05, celle-ci
        etait perimee, le ping echouait donc aussi, et le chien de garde concluait a
        tort a une panne de courant pendant que l'ampoule repondait a son adresse
        d'origine. Chaque ampoule en echec est d'abord diagnostiquee seule
        (`Light.diagnose`), ce qui repare aussi le cas d'UNE ampoule egaree.
        """
        while True:
            await asyncio.sleep(30)
            now = time.monotonic()
            stuck = [l for l in self.lights.values() if l.stuck(now, grace)]
            if not stuck:
                continue
            verdicts = await asyncio.gather(*(l.diagnose() for l in stuck))
            # Une ampoule rebasculee repart avec une periode de grace : `stuck` la
            # relache, et le redemarrage attend de voir si la bascule suffit.
            if not (all(l.stuck(now, grace) for l in self.lights.values())
                    and "session" in verdicts):
                continue
            logger.error("chien de garde : toutes les ampoules echouent depuis plus de "
                         "%d s alors que le reseau Thread repond — redemarrage du sidecar",
                         grace)
            logging.shutdown()
            # Pas de fermeture propre : elle attendrait des contextes CoAP justement
            # bloques. Le sidecar n'ecrit rien sur disque, rien a perdre.
            os._exit(75)


async def ping(host: str) -> bool:
    """Un ping6, borne a 3 s. Vrai si l'hote a repondu."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping6", "-c", "1", host,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
    except OSError:
        return False
    try:
        return await asyncio.wait_for(proc.wait(), timeout=3) == 0
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return False


# ─── Serveur HTTP minimal ───────────────────────────────────────────────────
# Volontairement ecrit a la main : ajouter aiohttp pour trois routes sur la boucle
# locale ne se justifie pas, et cela garde le sidecar sans dependance nouvelle.

async def handle(sidecar: Sidecar, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    # Fermer la socket quoi qu'il arrive : chaque socket oubliee coute un descripteur.
    try:
        await respond(sidecar, reader, writer)
    finally:
        writer.close()


async def respond(sidecar: Sidecar, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
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
    try:
        await writer.drain()
    except ConnectionError:
        # Le backend a abandonne la requete (delai de 4 s) : rien a lui repondre.
        pass


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
        state = await light.apply(patch)
        if state is None:
            return 503, {"error": f"{alias} occupee, ecriture reportee"}
        return 200, {"alias": alias, **state}
    return 404, {"error": "route inconnue"}


async def main_async(args) -> int:
    from contextlib import AsyncExitStack

    sidecar = Sidecar(pathlib.Path(args.file))
    async with AsyncExitStack() as stack:
        await sidecar.start(stack)
        if not sidecar.controller.aliases:
            logger.error("aucune ampoule appairee dans %s — arret", args.file)
            return 1

        # Garder les references : asyncio ne retient les taches que faiblement.
        tasks = [
            asyncio.create_task(sidecar.refresh_loop(args.refresh)),
            asyncio.create_task(sidecar.watchdog(args.watchdog)),
        ]
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
    parser.add_argument("--watchdog", type=float, default=120.0,
                        help="duree d'echec de toutes les ampoules avant redemarrage, en secondes")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # launchd n'accorde que 256 descripteurs. Chaque tentative CoAP en ouvre un, et
    # une ampoule qui traine retient les requetes HTTP : marge de securite.
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    want = 4096 if hard == resource.RLIM_INFINITY else min(4096, hard)
    if soft < want:
        resource.setrlimit(resource.RLIMIT_NOFILE, (want, hard))
    for noisy in ("zeroconf", "aiocoap", "aiohomekit"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
