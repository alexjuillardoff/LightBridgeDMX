"""Scan BLE en lecture seule : dumpe tout ce que les accessoires HAP annoncent.

Ne tente AUCUN appairage — donc ne consomme aucune des 100 tentatives avant
refus definitif. Sert a trancher : l'ampoule est-elle vraiment non appairee,
et est-ce bien la bonne ?

Le champ le plus utile est `setup_hash` : HAP le definit comme
`SHA-512(setupID || deviceID)[0:4]`. Le Setup ID ne fait que 4 caracteres
alphanumeriques, soit 36^4 = 1 679 616 possibilites — on le retrouve donc par
force brute en quelques secondes, hors ligne. C'est le seul moyen d'identifier
avec certitude une ampoule remise a zero : le reset lui fait perdre le nom
donne dans Maison (elle redevient "Nanoleaf Light Bulb") et REGENERE son
Device ID. Le Setup ID, lui, est grave en usine et imprime sur l'etiquette,
a cote du code a 8 chiffres. Il permet donc de verifier qu'on lit la bonne
etiquette AVANT de depenser une tentative d'appairage.

Le code de configuration, lui, reste hors d'atteinte : c'est tout l'interet de
SRP. Le sel et la cle publique renvoyes en M2 ne permettent aucune verification
hors ligne d'un code candidat.

    ./.venv/bin/python scan_ble.py [duree_en_secondes]

A lancer depuis Terminal.app : le Bluetooth exige une autorisation que macOS
n'accorde jamais a un processus sans interface.
"""
import asyncio, hashlib, itertools, os, string, sys, pathlib
os.environ.setdefault("AIOCOAP_SERVER_TRANSPORT", "udp6")
import bleak  # noqa: F401  (l'import suffit a activer le transport BLE)
from zeroconf.asyncio import AsyncServiceBrowser, AsyncZeroconf
from aiohomekit.controller import Controller
from aiohomekit.controller.abstract import TransportType
from aiohomekit.zeroconf import ZeroconfServiceListener

DUREE = float(sys.argv[1]) if len(sys.argv) > 1 else 25.0
ICI = pathlib.Path(__file__).parent

async def main():
    zeroconf = AsyncZeroconf()
    controller = Controller(async_zeroconf_instance=zeroconf)
    async with zeroconf:
        # Meme montage que pair_bulb.py : sans ce browser, le controleur refuse
        # de demarrer ("no zeroconf browser for _hap._tcp").
        AsyncServiceBrowser(
            zeroconf.zeroconf,
            ["_hap._tcp.local.", "_hap._udp.local."],
            listener=ZeroconfServiceListener(),
        )
        async with controller:
            await scan(controller)

async def scan(controller):
    if True:
        backend = controller.transports.get(TransportType("ble"))
        if backend is None:
            sys.exit("Transport BLE indisponible (lancer depuis Terminal.app).")
        print(f"Scan BLE {DUREE:.0f}s…", flush=True)
        vus = {}
        fin = asyncio.get_running_loop().time() + DUREE
        while asyncio.get_running_loop().time() < fin:
            vus.update(dict(getattr(backend, "discoveries", {})))
            await asyncio.sleep(1.0)
        print(f"\n{len(vus)} accessoire(s) HAP vu(s) :\n")
        for hkid, disco in vus.items():
            d = disco.description
            print(f"  id            : {hkid}")
            for champ in sorted(getattr(d, "__dataclass_fields__", {}) or
                                {k: None for k in dir(d) if not k.startswith("_")}):
                try:
                    v = getattr(d, champ)
                except Exception:
                    continue
                if callable(v):
                    continue
                if champ == "status_flags":
                    v = f"{v} -> {'NON APPAIREE (appairable)' if int(v) & 0x01 else 'DEJA APPAIREE'}"
                if champ == "setup_hash" and v:
                    sids = retrouve_setup_id(v, hkid)
                    v = f"{v.hex()} -> Setup ID {' ou '.join(sids) if sids else 'introuvable'}"
                print(f"  {champ:<14}: {v}")
            print()


def retrouve_setup_id(setup_hash: bytes, device_id: str) -> list[str]:
    """Inverse SHA-512(setupID || deviceID)[0:4] sur les 36^4 Setup ID possibles.

    Le deviceID entre dans le hachage au format majuscule "XX:XX:XX:XX:XX:XX",
    tel que l'exige la spec HAP — pas sous la forme minuscule affichee par bleak.
    """
    cible = bytes(setup_hash[:4])
    suffixe = device_id.upper().encode()
    alphabet = string.digits + string.ascii_uppercase
    return [
        sid for sid in ("".join(q) for q in itertools.product(alphabet, repeat=4))
        if hashlib.sha512(sid.encode() + suffixe).digest()[:4] == cible
    ]

asyncio.run(main())
