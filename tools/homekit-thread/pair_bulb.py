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
import os
import pathlib
import sys

# Doit etre pose AVANT d'importer aiohomekit : c'est ce drapeau qui active le
# transport BLE (aiohomekit/const.py le lit a l'import).
os.environ.setdefault("AIOHOMEKIT_TRANSPORT_BLE", "1")

import bleak  # noqa: F401  (l'import suffit a activer le transport BLE)
from aiohomekit.controller import Controller
from aiohomekit.controller.abstract import AbstractPairing
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


async def verify(pairing: AbstractPairing) -> None:
    """Relit l'ampoule apres coup pour prouver que le pilotage fonctionne vraiment.

    On ne se contente pas du "pairing established" : tant qu'on n'a pas relu une
    caracteristique, rien ne dit que le basculement vers Thread a abouti.
    """
    accessories = await pairing.list_accessories_and_characteristics()
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

            print(f"Recherche de {args.device_id} (BLE + IP + Thread)…")
            try:
                discovery = await controller.async_find(args.device_id, timeout=args.timeout)
            except HomeKitException as err:
                sys.exit(f"Appareil introuvable : {err}\n"
                         "L'ampoule est-elle bien reinitialisee (3 clignotements rouges) "
                         "et a portee Bluetooth de ce Mac ?")

            print("Appairage HAP…")
            finish = await discovery.async_start_pairing(args.alias)
            pairing = await finish(normalize_pin(args.pin))
            controller.save_data(str(store))
            print(f'  appairage "{args.alias}" enregistre dans {store}')

            # Sans cette etape l'ampoule reste sur BLE seul : joignable de tout pres,
            # inutilisable depuis le backend.
            print("Provisionnement des identifiants Thread…")
            await pairing.thread_provision(dataset)
            print("  envoye — l'ampoule rejoint le maillage (~1 min)")

            print("Verification…")
            await asyncio.sleep(args.settle)
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
    parser.add_argument("--device-id", required=True,
                        help="Device ID HomeKit, donne par `aiohomekit discover`")
    parser.add_argument("--pin", required=True,
                        help="code HomeKit a 8 chiffres, avec ou sans tirets")
    parser.add_argument("--file", default=str(DEFAULT_STORE), help="fichier de stockage des appairages")
    parser.add_argument("--timeout", type=float, default=60.0, help="delai de decouverte, en secondes")
    parser.add_argument("--settle", type=float, default=45.0,
                        help="attente avant verification, le temps que Thread s'etablisse")

    thread = parser.add_argument_group("identifiants Thread")
    thread.add_argument("--dataset", help="dataset MeshCoP complet en hexa (prioritaire)")
    thread.add_argument("--network-name")
    thread.add_argument("--channel", help="canal radio 802.15.4 (11-26)")
    thread.add_argument("--panid", help="PAN ID 16 bits (ex. 0x1234)")
    thread.add_argument("--extpanid", help="Extended PAN ID, 16 caracteres hexa")
    thread.add_argument("--networkkey", help="cle reseau, 32 caracteres hexa")

    return asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
