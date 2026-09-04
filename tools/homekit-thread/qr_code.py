"""Decode le QR d'une etiquette HomeKit et en extrait le code de configuration.

    ./.venv/bin/python qr_code.py photo.jpeg

Sert quand le code a 8 chiffres est illisible : la gravure des Nanoleaf est en
pointillés peu contrastés sur plastique blanc, et 9/8, 8/0, 6/5, 1/7 s'y
confondent. Le QR, lui, porte le code exact.

Charge utile HAP : "X-HM://" + 9 caracteres base36 + 4 caracteres de Setup ID.
Les 9 caracteres encodent un entier de 46 bits :

    bits 0-26  (27) : code de configuration, en decimal
    bits 27-30 ( 4) : drapeaux de transport
    bits 31-38 ( 8) : categorie d'accessoire
    bits 39-45 ( 7) : version + reserve

Les etiquettes recentes ajoutent un suffixe apres le Setup ID (vu ici : 18
caracteres, vraisemblablement l'appairage Matter). On ne l'interprete pas, mais
il ne faut surtout pas rejeter la charge a cause de lui : le code a 8 chiffres
reste dans les neuf premiers caracteres.
"""
import re, sys, string
import zxingcpp
from PIL import Image, ImageOps, ImageEnhance

B36 = string.digits + string.ascii_uppercase

def decode_xhm(charge: str):
    m = re.fullmatch(r"X-HM://([0-9A-Z]{9})([0-9A-Z]{4})?([0-9A-Z]*)", charge.strip().upper())
    if not m:
        return None
    valeur = int(m.group(1), 36)
    return {
        "code": f"{valeur & 0x7FFFFFF:08d}",
        "drapeaux": (valeur >> 27) & 0xF,
        "categorie": (valeur >> 31) & 0xFF,
        "setup_id": m.group(2),
        "suffixe": m.group(3) or None,
    }

def variantes(img):
    """Le QR est grave en pointilles sur du plastique blanc : peu de contraste.
    On tente plusieurs rehaussements avant d'abandonner."""
    g = ImageOps.grayscale(img)
    yield "brut", img
    yield "gris", g
    yield "auto-contraste", ImageOps.autocontrast(g)
    yield "egalise", ImageOps.equalize(g)
    for f in (2.0, 3.0, 4.0):
        yield f"contraste x{f}", ImageEnhance.Contrast(ImageOps.autocontrast(g)).enhance(f)
    for seuil in (100, 120, 140, 160, 180):
        yield f"seuil {seuil}", g.point(lambda p, s=seuil: 255 if p > s else 0)
    for angle in (90, 180, 270):
        yield f"rotation {angle}", g.rotate(angle, expand=True)
    for ech in (2, 3):
        yield f"agrandi x{ech}", g.resize((g.width * ech, g.height * ech), Image.LANCZOS)

def main(chemin):
    img = Image.open(chemin)
    img = ImageOps.exif_transpose(img)
    print(f"{chemin} — {img.width}x{img.height}")
    for nom, essai in variantes(img):
        for r in zxingcpp.read_barcodes(essai):
            print(f"\n  détecté ({nom}) [{r.format}] : {r.text}")
            info = decode_xhm(r.text)
            if info:
                print(f"\n  ===> CODE HOMEKIT : {info['code'][:3]}-{info['code'][3:5]}-{info['code'][5:]}"
                      f"  ({info['code']})")
                print(f"       Setup ID   : {info['setup_id']}")
                print(f"       catégorie  : {info['categorie']}   drapeaux : {info['drapeaux']}")
                if info["suffixe"]:
                    print(f"       suffixe    : {info['suffixe']} (non interprété)")
            return 0
    print("\n  Aucun QR décodé, même après rehaussement.")
    return 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
