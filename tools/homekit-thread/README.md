# Ampoules HomeKit-sur-Thread (Nanoleaf Essentials NL45)

Appairage des ampoules Nanoleaf A19 à LightBridge, hors de la maison Apple.

## Pourquoi ce détour

Ces ampoules ne parlent ni HTTP ni Matter, mais **HAP sur CoAP/UDP:5683**, au bout
du maillage Thread. Le NL45 ne recevra jamais de firmware Matter (limitation
matérielle confirmée par Nanoleaf), donc la voie multi-admin Matter est fermée :
il faut devenir le contrôleur HAP de l'ampoule.

Un accessoire HAP déjà appairé ne peut pas être repris par un second contrôleur.
L'ampoule doit donc être **réinitialisée**, ce qui lui fait quitter le maillage
Thread. Elle n'est alors joignable qu'en Bluetooth, le temps qu'on lui redonne
des identifiants réseau :

    reset ──▶ BLE : appairage HAP ──▶ BLE : provisionnement Thread ──▶ CoAP

Après quoi elle rejoint le **même** réseau Thread et redevient routeur du maillage.
Seul le contrôleur a changé.

## Avant de réinitialiser quoi que ce soit

Relève le **code HomeKit à 8 chiffres** de chaque ampoule : app Maison →
accessoire → roue crantée → « Code de configuration ». Sans lui, une ampoule
réinitialisée n'est réappairable nulle part. C'est le seul point de non-retour.

## Le Bluetooth ne sert qu'ici

À lancer depuis **Terminal.app** : macOS ne peut pas accorder l'autorisation
Bluetooth à un processus lancé par le serveur VS Code. Une fois par ampoule.
Le service qui pilote les ampoules ensuite n'utilise que Thread.

## Usage

    cd tools/homekit-thread
    ./.venv/bin/python pair_bulb.py \
        --alias a19-35q2 --device-id 83:54:1d:8b:e5:b2 --pin 123-45-678 \
        --dataset <dataset MeshCoP en hexa>

`--dataset` est préférable à la saisie champ par champ : aucun risque de
confondre la **clé réseau** et le **PSKc**, deux valeurs de 32 caractères hexa
qui se ressemblent et que les outils affichent côte à côte.

Device IDs : `./.venv/bin/python -m aiohomekit discover`

## Fichiers produits

`pairings.json` contient les clés long-terme des appairages — **jamais commité**
(déjà dans `.gitignore`), c'est l'équivalent d'un trousseau.
