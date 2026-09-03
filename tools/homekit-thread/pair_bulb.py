#!/usr/bin/env python3
"""
Appairage d'une ampoule HomeKit-sur-Thread (Nanoleaf Essentials NL45) a LightBridge.

Operation PONCTUELLE, a lancer une fois par ampoule, depuis un Terminal ayant
l'autorisation Bluetooth de macOS. Le service qui pilote les ampoules au quotidien
n'a PAS besoin de Bluetooth : il parle en CoAP sur Thread.

Pourquoi le Bluetooth est indispensable ici : une ampoule qu'on vient de
reinitialiser a quitte le maillage Thread. Elle n'est donc joignable que par BLE,
le temps qu'on lui redonne des identifiants reseau. La sequence est :

    reset ---> BLE: appairage HAP ---> BLE: provisionnement Thread ---> CoAP

A la fin, l'ampoule rejoint le meme reseau Thread qu'avant et redevient routeur
du maillage ; seul le controleur a change (LightBridge au lieu de la maison Apple).

ATTENTION : sans son code a 8 chiffres, une ampoule reinitialisee n'est
reappairable nulle part. Verifier le code AVANT tout reset.

Exemple :
    export AIOHOMEKIT_TRANSPORT_BLE=1
    ./pair_bulb.py \\
        --alias a19-35q2 --device-id 83:54:1d:8b:e5:b2 --pin 123-45-678 \\
        --network-name <nom du reseau Thread> --channel 15 --panid 0xABCD \\
        --extpanid <ext PAN ID, 16 hexa> \\
        --networkkey <cle reseau, 32 hexa>

Les valeurs Thread sont propres a ton maillage et ne doivent jamais finir
dans le depot : les relever depuis Home Assistant ou un routeur OpenThread
au moment de lancer la commande.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import pathlib
import sys

# Doit etre pose AVANT d'importer aiohomekit : c'est ce drapeau qui active le
# transport BLE (aiohomekit/const.py le lit a l'import).
os.environ.setdefault("AIOHOMEKIT_TRANSPORT_BLE", "1")

# aiocoap n'active `udp6` que sur Linux et retombe ailleurs sur `simplesocketserver`,
# qui REFUSE de se lier a l'adresse "any" (::) — or c'est exactement ce que fait
# aiohomekit pour ouvrir son contexte CoAP. Sans ce forcage, tout dialogue Thread
# echoue sur "The transport can not be bound to any-address". udp6 fonctionne
# parfaitement sur macOS ; il perd seulement la remontee des erreurs ICMP.
os.environ.setdefault("AIOCOAP_SERVER_TRANSPORT", "udp6")

import bleak  # noqa: F401  (l'import suffit a activer le transport BLE)
from aiohomekit.controller import Controller
from aiohomekit.controller.abstract import AbstractPairing, TransportType
from aiohomekit.characteristic_cache import CharacteristicCacheFile
from aiohomekit.exceptions import HomeKitException
from aiohomekit.meshcop import Meshcop
from zeroconf.asyncio import AsyncServiceBrowser, AsyncZeroconf
from aiohomekit.zeroconf import ZeroconfServiceListener

DEFAULT_STORE = pathlib.Path(__file__).parent / "pairings.json"


def normalize_pin(raw: str) -> str:
    r"""Remet un code HomeKit au format strict attendu par aiohomekit (778-71-838).

    L'app Maison affiche le code sans tirets, et `check_pin_format()` refuse
    tout ce qui ne colle pas a `\d\d\d-\d\d-\d\d\d`. Sans cette
    normalisation, une faute de frappe cosmetique fait echouer l'appairage
    APRES la reinitialisation de l'ampoule — au pire moment possible.
    """
    digits = "".join(c for c in str(raw) if c.isdigit())
    if len(digits) != 8:
        sys.exit(f"Code HomeKit invalide : {raw!r} — il faut 8 chiffres.")
    return f"{digits[0:3]}-{digits[3:5]}-{digits[5:8]}"


def parse_panid(raw: str) -> int:
    """Lit un PAN ID ecrit avec ou sans prefixe hexadecimal.

    L'app Maison l'affiche nu ("e253"), d'autres outils le prefixent ("0xe253").
    On tente d'abord l'interpretation explicite, puis l'hexadecimal par defaut :
    un PAN ID est toujours hexadecimal, jamais decimal.
    """
    text = str(raw).strip()
    try:
        return int(text, 0)
    except ValueError:
        return int(text, 16)


def build_dataset(args: argparse.Namespace) -> str:
    """Construit le dataset operationnel Thread (format MeshCoP) en hexadecimal.

    `thread_provision()` attend cette chaine. Si l'utilisateur dispose deja du
    dataset complet (Home Assistant, un routeur OpenThread), --dataset court-circuite
    la construction : c'est la voie la plus sure, elle evite toute erreur de saisie.
    """
    if args.dataset:
        return args.dataset.lower().replace(" ", "")

    missing = [
        name
        for name, value in (
            ("--network-name", args.network_name),
            ("--channel", args.channel),
            ("--panid", args.panid),
            ("--extpanid", args.extpanid),
            ("--networkkey", args.networkkey),
        )
        if value in (None, "")
    ]
    if missing:
        sys.exit(f"Dataset Thread incomplet — il manque : {', '.join(missing)}")

    dataset = Meshcop(
        channel=int(args.channel),
        # Le PAN ID se note indifferemment "0xe253" ou "e253" selon l'outil qui
        # l'affiche : on accepte les deux plutot que de pieger l'utilisateur.
        panid=parse_panid(args.panid),
        extpanid=bytes.fromhex(args.extpanid),
        networkname=args.network_name,
        networkkey=bytes.fromhex(args.networkkey),
    )
    return dataset.encode().hex()


async def wait_for_discovery(backend, device_id: str | None, name: str | None, timeout: float):
    """Attend qu'un accessoire apparaisse, en scrutant le cache du transport.

    Contourne un bug d'aiohomekit 4.0.1 : `BleController.async_find()` cree une
    future d'attente mais ne l'enregistre JAMAIS dans `self._ble_futures`, si bien
    que `_device_detected()` ne la resout jamais. L'appel expire donc
    systematiquement, sauf si l'appareil se trouvait deja dans le cache au moment
    de l'appel. Le bloc `finally` de la fonction retire pourtant cette future de
    `_ble_futures` — la preuve que l'enregistrement a ete perdu en cours de route.

    On scrute donc `backend.discoveries` nous-memes, puis on delegue a
    `async_find()` une fois l'appareil present : il repond alors immediatement
    depuis le cache, chemin qui fonctionne.
    """
    deadline = asyncio.get_running_loop().time() + timeout
    waited = 0.0
    while asyncio.get_running_loop().time() < deadline:
        found = dict(getattr(backend, "discoveries", {}))
        # Recherche par nom : plus sure que par identifiant, car une remise a zero
        # d'usine REGENERE l'identifiant HAP de l'ampoule. Celui qu'on lit sur son
        # annonce Thread avant reset ne vaut plus rien apres.
        if name:
            for hkid, disco in found.items():
                if (disco.description.name or "").strip().lower() == name.strip().lower():
                    print(f"  '{name}' vu apres {waited:.0f}s — id={hkid}")
                    return await backend.async_find(hkid, timeout=10)
        elif device_id and device_id in found:
            print(f"  vu apres {waited:.0f}s")
            return await backend.async_find(device_id, timeout=10)

        await asyncio.sleep(1.0)
        waited += 1.0
        if waited % 15 == 0:
            noms = [f"{d.description.name!r}({k})" for k, d in found.items()]
            print(f"  {waited:.0f}s — appairables : {', '.join(noms) or 'aucun'}")

    found = dict(getattr(backend, "discoveries", {}))
    noms = [f"{d.description.name!r}({k})" for k, d in found.items()]
    sys.exit(f"Introuvable apres {timeout:.0f}s (cible: {name or device_id}).\n"
             f"Accessoires appairables vus : {', '.join(noms) or 'aucun'}\n"
             "L'ampoule est-elle bien reinitialisee (3 clignotements rouges) ?")


async def migrate_to_coap(controller, alias: str, store: pathlib.Path, timeout: float = 180.0):
    """Bascule l'appairage du transport BLE vers CoAP une fois l'ampoule sur Thread.

    L'appairage se fait forcement en Bluetooth (l'ampoule fraichement reinitialisee
    n'est joignable que par la), donc `pairing_data["Connection"]` vaut "BLE" et
    pointe une adresse CoreBluetooth. Tel quel, tout usage ulterieur repasserait par
    le Bluetooth — c'est-a-dire par une autorisation macOS que le service n'a pas, et
    par le bug `async_find()`. On reecrit donc l'entree en CoAP des que l'ampoule
    reapparait sur le maillage, avec son adresse IPv6 Thread.

    C'est cette bascule qui rend le pilotage possible depuis un service sans Bluetooth.
    """
    coap = controller.transports.get(TransportType.COAP)
    if coap is None:
        print("  !! transport CoAP indisponible — appairage laisse en BLE")
        return False

    data = json.loads(store.read_text())
    entry = data.get(alias)
    if entry is None:
        return False
    hkid = str(entry.get("AccessoryPairingID", "")).lower()

    print(f"  attente de {hkid} sur le maillage Thread…")
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    waited = 0.0
    while loop.time() < deadline:
        disco = getattr(coap, "discoveries", {}).get(hkid)
        if disco is not None:
            desc = disco.description
            entry["Connection"] = "CoAP"
            entry["AccessoryIP"] = desc.address
            entry["AccessoryPort"] = desc.port
            entry.pop("AccessoryAddress", None)   # adresse BLE, sans objet ici
            store.write_text(json.dumps(data, indent=2))
            print(f"  bascule en CoAP — {desc.address}:{desc.port} (apres {waited:.0f}s)")
            return True
        await asyncio.sleep(2.0)
        waited += 2.0
        if waited % 30 == 0:
            print(f"  {waited:.0f}s — pas encore sur Thread")

    print(f"  !! toujours absente de Thread apres {timeout:.0f}s ; appairage laisse en BLE.")
    print("     Relancer plus tard : la bascule peut se refaire a la main.")
    return False


async def verify(pairing: AbstractPairing) -> None:
    """Relit l'ampoule apres coup pour prouver que le pilotage fonctionne vraiment.

    On ne se contente pas du "pairing established" : tant qu'on n'a pas relu une
    caracteristique, rien ne dit que le basculement vers Thread a abouti.
    """
    accessories = await pairing.list_accessories_and_characteristics()
    if not accessories:
        print("  aucune caracteristique renvoyee — l'ampoule bascule encore vers Thread")
        return
    print(f"  {len(accessories)} accessoire(s) expose(s)")
    for accessory in accessories:
        for service in accessory.get("services", []):
            for char in service.get("characteristics", []):
                if char.get("type", "").lower().startswith("25"):  # On (25)
                    print(f"  caracteristique On -> aid={accessory['aid']} iid={char['iid']}"
                          f" valeur={char.get('value')}")


async def run(args: argparse.Namespace) -> int:
    dataset = build_dataset(args)
    print(f"Dataset Thread ({len(dataset) // 2} octets) : {dataset[:24]}…")

    store = pathlib.Path(args.file)
    zeroconf = AsyncZeroconf()
    controller = Controller(
        async_zeroconf_instance=zeroconf,
        char_cache=CharacteristicCacheFile(store.parent / "charmap.json"),
    )

    async with zeroconf:
        # On surveille les deux transports HAP : `_tcp` (IP) et `_udp` (Thread).
        AsyncServiceBrowser(
            zeroconf.zeroconf,
            ["_hap._tcp.local.", "_hap._udp.local."],
            listener=ZeroconfServiceListener(),
        )
        async with controller:
            if store.exists():
                controller.load_data(str(store))
            if args.alias in controller.aliases:
                sys.exit(f'L\'alias "{args.alias}" existe deja dans {store}')

            # `controller.async_find()` interroge TOUS les transports en parallele et
            # retient le premier qui repond. C'est un piege ici : l'annonce mDNS Thread
            # de l'ampoule survit plusieurs minutes en cache apres un reset, donc le
            # transport CoAP "gagne" la course et on tente l'appairage sur une adresse
            # morte (echec: TimeoutError dans do_pair_setup). Une ampoule fraichement
            # reinitialisee n'est joignable QU'EN Bluetooth : on force donc le transport.
            transport = TransportType(args.transport)
            backend = controller.transports.get(transport)
            if backend is None:
                sys.exit(f"Transport {args.transport} indisponible. "
                         "Pour le BLE : lancer depuis Terminal.app (autorisation Bluetooth macOS).")

            print(f"Recherche de {args.name or args.device_id} via {transport.value.upper()}…")
            discovery = await wait_for_discovery(backend, args.device_id, args.name, args.timeout)

            print("Appairage HAP…")
            finish = await discovery.async_start_pairing(args.alias)
            pairing = await finish(normalize_pin(args.pin))

            # `save_data()` ne serialise que `controller.aliases`. Or on a appaire via
            # le backend de transport directement (pour eviter la course entre CoAP et
            # BLE), et `async_start_pairing()` a donc enregistre l'alias sur le BACKEND,
            # pas sur le controleur de haut niveau. Sans ce report, save_data ecrit un
            # "{}" et les cles long-terme sont perdues : l'ampoule reste appairee a un
            # controleur fantome et il faut la reinitialiser.
            controller.aliases[args.alias] = pairing
            controller.save_data(str(store))

            # Garde-fou : on relit le fichier. Une perte de cles ne doit JAMAIS passer
            # inapercue, puisqu'elle se repare uniquement par un nouveau reset materiel.
            written = json.loads(store.read_text() or "{}")
            if args.alias not in written:
                sys.exit(f"ECHEC CRITIQUE : {store} ne contient pas l'alias "
                         f"{args.alias!r} (contenu : {list(written)}).\n"
                         "Les cles d'appairage sont perdues — l'ampoule devra etre "
                         "reinitialisee puis reappairee.")
            print(f'  appairage "{args.alias}" enregistre dans {store}')

            # Sans cette etape l'ampoule reste sur BLE seul : joignable de tout pres,
            # inutilisable depuis le backend.
            print("Provisionnement des identifiants Thread…")
            await pairing.thread_provision(dataset)
            print("  envoye — l'ampoule rejoint le maillage (~1 min)")

            # L'ampoule met ~1 min a rejoindre le maillage puis a s'annoncer en mDNS.
            print("Bascule vers le transport Thread…")
            await migrate_to_coap(controller, args.alias, store, timeout=args.settle * 4)

            print("Verification…")
            await asyncio.sleep(5)
            try:
                await verify(pairing)
            except Exception as err:  # noqa: BLE001
                print(f"  lecture impossible pour l'instant ({err}).")
                print("  L'ampoule bascule peut-etre encore vers Thread : reessaie "
                      "dans une minute avec `aiohomekit -f pairings.json accessories -a "
                      f"{args.alias}`.")
                return 1

    print("\nTermine. L'ampoule est pilotable par LightBridge en CoAP/Thread.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--alias", required=True, help="nom court de l'appairage (ex. a19-35q2)")
    parser.add_argument("--device-id",
                        help="Device ID HomeKit (change a chaque reset — prefere --name)")
    parser.add_argument("--name",
                        help="nom annonce par l'ampoule, ex. 'Nanoleaf A19 26N3'. "
                             "Stable a travers les resets, contrairement au device-id.")
    parser.add_argument("--pin", required=True,
                        help="code HomeKit a 8 chiffres, avec ou sans tirets")
    parser.add_argument("--file", default=str(DEFAULT_STORE), help="fichier de stockage des appairages")
    parser.add_argument("--timeout", type=float, default=60.0, help="delai de decouverte, en secondes")
    parser.add_argument("--transport", choices=["ble", "coap", "ip"], default="ble",
                        help="transport de decouverte (defaut: ble — le seul valable "
                             "pour une ampoule fraichement reinitialisee)")
    parser.add_argument("--settle", type=float, default=45.0,
                        help="attente avant verification, le temps que Thread s'etablisse")

    thread = parser.add_argument_group("identifiants Thread")
    thread.add_argument("--dataset", help="dataset MeshCoP complet en hexa (prioritaire)")
    thread.add_argument("--network-name")
    thread.add_argument("--channel", help="canal radio 802.15.4 (11-26)")
    thread.add_argument("--panid", help="PAN ID 16 bits (ex. 0x1234)")
    thread.add_argument("--extpanid", help="Extended PAN ID, 16 caracteres hexa")
    thread.add_argument("--networkkey", help="cle reseau, 32 caracteres hexa")

    args = parser.parse_args()
    if not args.name and not args.device_id:
        parser.error("il faut --name (recommande) ou --device-id")
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
