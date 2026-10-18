# Ampoules HomeKit-sur-Thread (Nanoleaf Essentials NL45)

Comment appairer une ampoule Nanoleaf A19 à LightBridge, puis la rendre pilotable
depuis l'interface web, la console DMX et l'app Maison.

---

## 1. Pourquoi ce détour

Ces ampoules ne parlent **ni HTTP ni Matter**, mais **HAP sur CoAP/UDP:5683**, au bout
du maillage Thread. Elles s'annoncent en `_hap._udp` — jamais en `_hap._tcp` — donc
aucun scan IPv4 ne les voit.

Le NL45 **n'aura jamais Matter** : limitation matérielle confirmée par Nanoleaf, il
faudrait une autre puce. La voie multi-admin est donc fermée, et devenir contrôleur
HAP impose de sortir l'ampoule de la maison Apple.

La seule implémentation exploitable de HAP-sur-CoAP est `aiohomekit`, en Python. D'où
l'architecture : un **sidecar** Python tient les connexions CoAP, le backend Node lui
parle en HTTP sur la boucle locale.

```
navigateur ──▶ backend Fastify :5000
                   │  (SmartLightService : état voulu, coalescence 250 ms)
                   ▼  HTTP local :5056
             sidecar.py (aiohomekit, HAP/CoAP)
                   ▼  Thread / IPv6
             Nanoleaf A19
```

---

## 2. Prérequis — à réunir AVANT de toucher à une ampoule

**Le code HomeKit à 8 chiffres.** App Maison → accessoire → roue crantée → bas de page,
« Code de configuration ». **Sans lui, une ampoule réinitialisée n'est réappairable
nulle part.** C'est le seul point de non-retour de toute la procédure.

**Le dataset Thread.** Il faut le réseau complet, pas seulement le nom :

| Champ | Où | Piège |
|---|---|---|
| Nom du réseau | `nn=` de `_meshcop._udp` | — |
| Canal radio | app Maison / Home Assistant | absent du mDNS |
| PAN ID (16 bits) | idem | s'écrit `1a2b` ou `0x1a2b` — les deux sont acceptés |
| Extended PAN ID | `xp=` de `_meshcop._udp` | 16 car. hexa |
| **Clé réseau** | app Maison / HA | 32 car. hexa |
| ~~PSKc~~ | — | **PIÈGE : ce n'est PAS la clé réseau** |

> La clé réseau et le PSKc font tous deux 32 caractères hexadécimaux et sont affichés
> côte à côte. Se tromper produit une ampoule réinitialisée qui ne rejoindra jamais le
> maillage. Si l'outil source affiche le **dataset complet en hexa**, utiliser
> `--dataset` : ça court-circuite toute saisie et supprime le risque.

**Un vrai Terminal.** L'appairage exige le Bluetooth, et macOS n'accorde jamais
l'autorisation à un processus sans interface (serveur VS Code, launchd). Lancer depuis
**Terminal.app**, qui obtient la permission au premier essai. Une seule fois par ampoule :
**le pilotage courant n'utilise aucun Bluetooth.**

---

## 3. La voie normale : depuis l'interface

Tout ce qui suit (§4, §5) est la **procédure manuelle**, utile pour comprendre ou
déboguer. Au quotidien, passer par **`#patch` → volet Inventaire réseau → panneau
« Ampoules Thread »** :

1. **Appairer** — saisir le nom de l'ampoule (proposé par le réseau) et son code à
   8 chiffres, puis cliquer. Une fenêtre Terminal s'ouvre : réinitialiser l'ampoule
   pendant qu'elle cherche. Cette étape ne peut pas être automatisée davantage — elle
   exige le Bluetooth, et macOS ne l'accorde jamais à un service sans interface.
2. **Patcher** — l'ampoule apparaît dans « prêtes à patcher ». Un clic déclare la
   lampe, lui trouve une adresse DMX derrière les vrais projecteurs, crée le projecteur, pose le miroir et
   l'expose dans HomeKit. Le menu déroulant permet de **rattacher** la lampe à un
   projecteur existant plutôt que d'en créer un second.

Prérequis : `THREAD_DATASET` dans `backend/.env` (le dataset MeshCoP en hexa, cf. §2)
et le sidecar démarré. Si le sidecar est arrêté, le panneau le dit explicitement.

Endpoints : `GET /api/smart-lights/thread/candidates`,
`POST /api/smart-lights/thread/adopt`, `POST /api/smart-lights/thread/pair`.

---

## 4. Appairer une ampoule (manuel)

### 4.1 Relever son nom

    ./.venv/bin/python -m aiohomekit discover

Repérer la ligne `Nanoleaf A19 XXXX`. **Noter le NOM, pas le Device ID** : voir §6.

### 4.2 Réinitialiser

Temporisation contre-intuitive, c'est la cause d'échec la plus fréquente :

> **éteindre 3 s → rallumer 1 s maximum → répéter 5 fois**

L'ampoule clignote alors **rouge trois fois**. Elle doit être sur un interrupteur
physique classique : ni variateur, ni prise connectée.

Supprimer d'abord l'accessoire dans l'app Maison est l'étape officielle et facilite les choses.

### 4.3 Appairer + provisionner Thread

Depuis **Terminal.app** :

    cd /Users/alex/LightBridgeDMX/tools/homekit-thread
    ./.venv/bin/python pair_bulb.py \
      --alias a19-xxxx \
      --name "Nanoleaf A19 XXXX" \
      --pin 12345678 \
      --transport ble \
      --timeout 240 \
      --dataset <dataset MeshCoP en hexa>

Le script enchaîne : découverte BLE → appairage HAP → provisionnement Thread →
**bascule automatique de l'appairage vers CoAP** → vérification. Compter 2 à 4 minutes ;
l'ampoule met ~1 min à rejoindre le maillage.

Le code est accepté avec ou sans tirets. Le PAN ID avec ou sans préfixe `0x`.

### 4.4 Sauvegarder les clés

`pairings.json` contient des clés **irremplaçables** : les perdre impose un nouveau
reset matériel. Gitignoré. **En faire une copie hors du dépôt.**

---

## 5. Rendre l'ampoule pilotable

### 4.1 Démarrer le sidecar

Il tourne en service launchd, `~/Library/LaunchAgents/com.lightbridgedmx.thread-sidecar.plist`
(démarrage à la session, `KeepAlive`, journal dans `logs/sidecar.out.log`) :

    launchctl kickstart -k gui/501/com.lightbridgedmx.thread-sidecar   # relancer
    ./.venv/bin/python sidecar.py          # à la main, service arrêté (bootout) d'abord

Il écoute sur 127.0.0.1:5056. Vérifier : `curl -s localhost:5056/lights`. Il résout les `iid` **par type de
caractéristique**, jamais en dur — ils varient d'un modèle et d'un firmware à l'autre.

### 4.2 Déclarer la lampe dans LightBridge

    curl -X POST http://127.0.0.1:5000/api/smart-lights \
      -H 'Content-Type: application/json' -d '{
        "name": "Nanoleaf A19 XXXX",
        "room": "Salon",
        "backend": "homekit-thread",
        "config": {"type": "homekit-thread", "alias": "a19-xxxx"}
      }'

Elle apparaît aussitôt dans l'onglet **Lampes**, sous la pastille *Thread*, et devient
**automatiquement un accessoire HomeKit** — un seul, avec teinte et saturation natives.

### 4.3 (Optionnel) La piloter comme un projecteur DMX

Créer un projecteur de 4 canaux sur des adresses libres, puis lier la lampe par un
miroir DMX :

    curl -X POST http://127.0.0.1:5000/api/fixtures \
      -H 'Content-Type: application/json' -d '{
        "name": "Nanoleaf A19 XXXX", "address": 40, "universe": 0, "room": "Salon",
        "channels": [
          {"channel": 1, "capability": "intensity", "name": "Dimmer"},
          {"channel": 2, "capability": "r", "name": "Rouge"},
          {"channel": 3, "capability": "g", "name": "Vert"},
          {"channel": 4, "capability": "b", "name": "Bleu"}
        ],
        "homekit": {"enabled": false}
      }'

`homekit.enabled: false` est **important** : sans ça le pont exposerait aussi un
accessoire par canal, soit quatre variateurs en doublon de la vraie ampoule.

Puis ajouter à la lampe :

    "dmxMirror": {"universe": 0, "briChannel": 40,
                  "rChannel": 41, "gChannel": 42, "bChannel": 43}

Elle hérite alors de la console, des scènes et des presets.

Le projecteur devient ainsi la **façade** de la lampe : s'il est placé entre deux vrais
projecteurs (comme l'adresse 40 de l'exemple), le backend le range aussitôt derrière le
dernier vrai canal DMX, et le miroir suit. Inutile donc de chercher une adresse : celle
qu'on donne n'est qu'un point de départ.

**Arbitrage entre sources** : le miroir ne s'applique qu'au **changement** des canaux
DMX. Bouger un fader reprend la main ; tant que le DMX ne bouge pas, Maison et l'onglet
Lampes gardent le contrôle. Le dernier qui écrit gagne.

---

## 6. Limites — ne pas promettre l'impossible

**Pas de 30 Hz. Jamais.** Trois plafonds cumulés :

- 802.15.4 plafonne à 250 kbps PHY, ~125 kbps utiles ;
- la spec Matter 1.4 bride les remontées à 1 Hz pendant les fondus ;
- le firmware n'a aucun mode streaming : chaque commande est acquittée.

Aucun maillage d'ampoules ne fait 30 Hz, Hue Entertainment compris (25 Hz au pont,
~12,5 fps réels). Le 30 Hz appartient au WiFi avec protocole dédié (Nanoleaf extControl
UDP) et au DMX512.

**Mesuré ici :** ~57-90 ms par écriture, cadence bridée à 250 ms
(`THREAD_PUSH_INTERVAL_MS`). Pour un rendu lisse, compter sur le **fondu interne de
l'ampoule** plutôt que sur le débit.

Les effets par zone et le miroir DMX par zone ne conviennent pas à ces ampoules.

---

## 7. Identifier une ampoule réinitialisée (sans dépenser de tentative)

Un reset fait perdre à l'ampoule le nom donné dans Maison — elle redevient
`Nanoleaf Light Bulb` — et **régénère son Device ID**. Plus rien ne permet de dire
laquelle on a en face. D'où :

    ./.venv/bin/python scan_ble.py 30        # depuis Terminal.app

Lecture seule : aucun appairage tenté, donc rien de prélevé sur les 100 tentatives
avant refus définitif. Sortie typique :

    id            : d0:7e:1c:15:cd:f6
    name          : Nanoleaf Light Bulb
    category      : 5
    status_flags  : 1 -> NON APPAIREE (appairable)
    setup_hash    : 1de8df87 -> Setup ID 1W1D

Deux renseignements décisifs :

- **`status_flags` bit 0** — à 1, l'ampoule est bien en attente d'appairage. À 0, elle
  est encore rattachée à une maison : inutile d'aller plus loin.
- **`setup_hash`** — HAP le définit comme `SHA-512(setupID || deviceID)[0:4]`, avec le
  deviceID en majuscules au format `XX:XX:XX:XX:XX:XX`. Le Setup ID ne fait que
  4 caractères alphanumériques, soit 36⁴ = 1 679 616 possibilités : le script l'inverse
  par force brute en quelques secondes. Ce Setup ID est **gravé en usine et imprimé sur
  l'étiquette, à côté du code à 8 chiffres**. Il dit donc si on lit la bonne étiquette
  *avant* de dépenser une tentative.

**Le code de configuration, lui, reste hors d'atteinte** — c'est tout l'objet de SRP.
Le sel et la clé publique renvoyés en M2 ne permettent aucune vérification hors ligne.
Le seul recours face à un code refusé est de le relire, ou de décoder le QR de
l'étiquette (il encode la charge utile `X-HM://`, code compris).

**Lire l'échec au bon endroit.** `aiohomekit` traduit fidèlement la table 4-5 de la
spec, donc l'exception nomme l'étape fautive :

| Exception | Ce que dit l'ampoule |
|---|---|
| `AuthenticationError` à l'étape M4 | preuve SRP refusée — voir ci-dessous, **deux causes** |
| `UnavailableError` | déjà appairée, sortir d'abord de Maison |
| `BackoffError` / `MaxTriesError` | trop d'échecs, elle temporise |
| `MaxPeersError` | plus de place pour un contrôleur |

**⚠️ `AuthenticationError` en M4 ne signifie PAS forcément que le code est faux.** Le
piège a coûté cher : le bon code a été rejeté trois fois de suite, et le QR a fini par
prouver qu'il était bon depuis le début. Les deux causes produisent une erreur
rigoureusement identique :

1. le code est réellement faux ;
2. **la session SRP est périmée** — l'ampoule a gardé le sel et la clé publique d'un
   échange précédent, ou le lien BLE s'est rompu entre M2 et M3. La preuve est alors
   calculée contre un `B` mort, et l'ampoule la refuse.

Le second cas survient dès qu'on enchaîne les tentatives : chaque échec laisse l'ampoule
dans un état bancal, et **tous les essais suivants échouent, code correct compris**.

> **Règle : entre deux tentatives d'appairage, couper puis rétablir l'alimentation de
> l'ampoule.** Un simple cycle, pas les cinq coupures du reset. C'est ce qui a débloqué
> `1W1D` : même code, ampoule rebranchée, appairage réussi en 2 secondes.

Le même cycle la remet en annonce quand elle a cessé d'émettre en BLE après une série
d'échecs.

**En cas de doute sur le code, décoder le QR plutôt que le relire :**

    ./.venv/bin/python qr_code.py photo.jpeg

    ===> CODE HOMEKIT : 988-01-473  (98801473)
         Setup ID   : 1W1D
         catégorie  : 5   drapeaux : 4

Il attaque l'image avec une quinzaine de rehaussements (gris, auto-contraste,
égalisation, seuillages, agrandissements, rotations) — la gravure Nanoleaf est en
pointillés très peu contrastés. Photographier **en lumière rasante** : c'est le relief
qui porte le contraste, un éclairage frontal l'écrase.

Le Setup ID lu dans le QR doit correspondre à celui que `scan_ble.py` retrouve. Sinon,
l'étiquette photographiée n'est pas celle de l'ampoule qu'on essaie d'appairer.

---

## 8. Pièges rencontrés — tous coûteux, tous réels

**Le reset régénère le Device ID HAP.** Trois valeurs différentes en trois resets pour
la même ampoule. → Toujours `--name`, jamais `--device-id`.

**Bug aiohomekit 4.0.1** : `BleController.async_find()` crée une future d'attente sans
jamais l'enregistrer dans `_ble_futures` ; `_device_detected()` ne la résout donc jamais
et l'appel expire **toujours**, sauf si l'appareil est déjà en cache. Contourné en
scrutant `backend.discoveries`.

**Course entre transports** : `controller.async_find()` interroge tous les transports en
parallèle et le CoAP gagne sur un cache mDNS périmé — on tente alors l'appairage sur une
adresse morte. → Forcer `--transport ble`.

**`AIOCOAP_SERVER_TRANSPORT=udp6` obligatoire sur macOS.** aiocoap n'active `udp6` que
sur Linux et retombe sur `simplesocketserver`, qui refuse de se lier à `::` — ce
qu'exige aiohomekit. Sans ça : *« The transport can not be bound to any-address »*.
Le script et le sidecar le posent eux-mêmes.

**`save_data()` ne sérialise que `controller.aliases`** (niveau haut). En appairant via
un backend de transport, l'alias reste sur le backend et le fichier vaut `{}` : **les
clés sont perdues**, reset matériel obligatoire. Un garde-fou relit désormais le fichier
et échoue bruyamment.

**L'appairage naît en `Connection: BLE`.** Sans bascule vers CoAP, tout usage ultérieur
repasserait par le Bluetooth — donc par une autorisation que le service n'a pas.
Automatisé dans `pair_bulb.py`.

**Bruit connu, sans impact** : le sidecar logue des `Transaction N failed with error 6
(Invalid request)`. Mesures à l'appui, la latence reste stable à ~85 ms et les écritures
aboutissent. Origine non élucidée.

---

## 9. État actuel

| Ampoule | Alias | État |
|---|---|---|
| Nanoleaf A19 26N3 | `a19-26n3` | « Lampe Salon » — projecteur « Lampe Canapé », DMX 259-263 |
| Nanoleaf A19 1W1D | `a19-1w1d` | « Plafonnier Canapé » — DMX 264-268 |
| Nanoleaf A19 6IX7 | `a19-6ix7` | « Lampe 6IX7 » — projecteur « Plafonnier Cuisine », DMX 269-273 |

Les trois sont appairées, joignables en CoAP/Thread et pilotables depuis la console,
les scènes, les presets et l'app Maison. Cinq canaux chacune : Dimmer, R, V, B,
température de couleur.

**Le sidecar ne relit `pairings.json` qu'au démarrage.** Une ampoule fraîchement
appairée lui reste donc invisible — et `POST /thread/adopt` répond « alias inconnu du
sidecar » — tant qu'il n'a pas été relancé (`launchctl kickstart -k
gui/501/com.lightbridgedmx.thread-sidecar`). S'il est arrêté, la lampe passe
`reachable: false` sans rien casser d'autre.

### Chien de garde : le sidecar se relance seul

Le 2026-09-15, après onze jours de service, les trois ampoules ont échoué en boucle
(`failed to connect`, rafales de `Retransmission`) — elles ne répondaient plus dans
Maison. Pourtant `ping6` répondait, `dns-sd -L` montrait `sf=0` (toujours appairées),
l'adresse n'avait pas bougé, et aiohomekit retentait bien la vérification de paire à
chaque appel. L'état fautif était **interne au processus** : un simple redémarrage a
tout rétabli en deux secondes.

Le sidecar reproduit donc ce remède : si **toutes** les ampoules échouent depuis
2 minutes (`--watchdog`) **et** qu'au moins une répond au ping, il se termine (code 75)
et launchd le relance. Une seule ampoule débranchée ne déclenche rien ; une panne de
maillage ou de courant non plus (aucun ping). Une ampoule hors tension au démarrage
n'est plus oubliée : elle est retentée à chaque tour de relecture.

### Adresse périmée : le chien de garde se croyait aveugle (2026-10-05)

« Lampe Salon » a cessé de répondre à 19 h 11, les deux autres ampoules à 20 h 38. Le
chien de garde répétait « aucune ampoule ne répond au ping, panne réseau ou courant »,
alors qu'un `ping6` lancé à la main répondait en 22 ms. En cause : les ampoules avaient
brièvement annoncé en mDNS une adresse dans un **second préfixe Thread**
(`fd3c:b774:c3f0:1::/64`), que le Mac ne sait pas router. aiohomekit adopte toujours la
**dernière** adresse annoncée : il l'a prise et n'en est jamais revenu. Le chien de
garde pingeait cette même adresse morte, d'où son faux diagnostic.

Pour voir l'adresse réellement visée par le sidecar, inutile de deviner :

    ps -o command -ax | grep "ping6 -c 1"     # pendant un tour du chien de garde

Désormais, chaque ampoule en échec depuis 2 minutes est diagnostiquée **seule**, sur
toutes ses adresses connues (celle en service, celles annoncées en mDNS, celle de
`pairings.json`) :

| Verdict | Signe | Remède |
|---|---|---|
| adresse périmée | l'adresse en service est muette, une autre répond | bascule sur place (`… muette, bascule sur …`) |
| session | l'adresse en service répond | redémarrage, si **toutes** les ampoules en sont là |
| hors service | aucune adresse ne répond | rien : courant ou maillage |

La panne a eu un effet de bord : chaque requête abandonnée par le backend (au bout de
4 s) gardait sa socket ouverte derrière le verrou d'écriture, jusqu'à épuiser les
256 descripteurs que launchd accorde (`Too many open files`). Le sidecar ne pouvait plus
ni répondre au backend, ni même lancer un ping. Une requête n'attend donc plus le verrou
que 3 s (`503` ensuite, que le backend renvoie à sa poussée suivante), toute socket est
fermée quoi qu'il arrive, et le sidecar relève sa limite à 4 096 descripteurs.

Autre effet de bord corrigé : le backend pousse toutes les 250 ms et abandonne après 4 s.
Pendant une reconnexion lente, les écritures s'empilaient derrière le verrou et étaient
rejouées une à une. Elles sont désormais **fusionnées** : seules les dernières valeurs
partent.
