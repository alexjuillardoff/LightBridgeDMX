# LightBridgeDMX

Hub d'éclairage qui unifie **DMX512** scénique, **Apple HomeKit** et **smart lights WiFi** (Nanoleaf et au-delà). Tableau de bord React pour contrôler tout depuis le navigateur, painter de zones, éditeur 3D de la disposition des LED strips et moteur d'effets position-aware (chase / wave / gradient).

---

## Sommaire

1. [À quoi ça sert ?](#à-quoi-ça-sert-)
2. [Comment ça fonctionne ?](#comment-ça-fonctionne-)
3. [Architecture du projet](#architecture-du-projet)
4. [Prérequis](#prérequis)
5. [Installation pas à pas](#installation-pas-à-pas)
6. [Configuration](#configuration)
7. [Démarrage](#démarrage)
8. [Utiliser le tableau de bord](#utiliser-le-tableau-de-bord)
9. [Intégration HomeKit](#intégration-homekit)
10. [Smart Lights (Nanoleaf)](#smart-lights-nanoleaf)
11. [Bibliothèque QXF](#bibliothèque-qxf)
12. [Services persistants (macOS)](#services-persistants-macos)
13. [API REST](#api-rest)
14. [WebSocket temps réel](#websocket-temps-réel)
15. [Dépannage](#dépannage)
16. [Roadmap](#roadmap)

---

## À quoi ça sert ?

### Le problème

Tu as des projecteurs DMX (PAR LED, lyres, dimmers…) que tu veux contrôler depuis ton iPhone/iPad via l'application **Maison (Home)** d'Apple, ou simplement depuis une interface web moderne. Or, le protocole DMX512 est un standard professionnel de l'éclairage scénique — il n'est pas nativement compatible avec les écosystèmes maison connectée.

### La solution

**LightBridgeDMX** fait le lien entre les deux mondes :

- Il lit la configuration de tes projecteurs (adresses DMX, types de canaux)
- Il expose chaque projecteur RGB comme une **ampoule HomeKit** (Hue/Saturation/Luminosité)
- Il expose chaque lyre comme un **accessory HomeKit multi-contrôles** (dimmer, pan, tilt, roue couleur, gobo)
- Il envoie les commandes de couleur en **DMX réel** vers tes projecteurs via le protocole Art-Net
- Il fournit un **tableau de bord web** pour monitorer et contrôler en direct les 512 canaux DMX
- Il **coupe/rétablit automatiquement l'alimentation** d'une prise connectée Meross (en local sur le LAN) selon l'activité DMX des projecteurs qu'elle alimente

### Cas d'utilisation typiques

- Contrôler l'éclairage d'une salle de répétition, d'un studio ou d'une scène depuis l'app Maison
- Créer des ambiances lumineuses pilotables par Siri ("Hey Siri, allume la scène concert")
- Visualiser et ajuster les canaux DMX depuis un navigateur web sur n'importe quel appareil
- Importer des définitions de projecteurs depuis la bibliothèque QLC+ (plus de 3000 modèles)
- **Piloter une Nanoleaf Lightstrip Essentials (NL72K3) en temps réel** : sliders couleur, painter par zone, effets dynamiques (chase / wave / gradient), édition 3D de la disposition physique
- **Mixer mondes DMX et WiFi dans une même scène** : un projecteur Stairville DMX et un strip Nanoleaf prennent la même couleur grâce au mirror DMX bidirectionnel
- **Allumer/éteindre une prise Meross automatiquement** : la prise se met sous tension dès qu'un projecteur surveillé change en DMX, et se coupe après un blackout complet prolongé (5 min) — configurable dans la vue Setup

---

## Comment ça fonctionne ?

### Vue d'ensemble du flux

```
iPhone/iPad (App Maison)
        │
        │ HomeKit (protocole HAP via Wi-Fi/LAN)
        ▼
┌─────────────────────┐
│  LightBridgeDMX     │
│  Backend (port 5000)│◄──── Tableau de bord web (port 5173)
│                     │
│  Pont HomeKit       │      L'utilisateur peut aussi
│  (hap-nodejs)       │      contrôler les canaux DMX
│                     │      directement depuis le navigateur
│  Service DMX        │
│  (Art-Net UDP)      │
└──────┬──────────────┘
       │ Art-Net (UDP port 6454)
       ▼
┌─────────────────────┐
│  QLC+               │  Logiciel libre de contrôle DMX
│  (bridge Art-Net    │  qui tourne sur le même Mac ou
│   → USB Enttec)     │  une autre machine du réseau
└──────┬──────────────┘
       │ DMX512 (câble XLR)
       ▼
┌─────────────────────┐
│  Projecteurs DMX    │  PAR LED RGB, lyres, dimmers,
│  (fixtures)         │  strobes, etc.
└─────────────────────┘
```

### Ce qui se passe techniquement

1. **Backend Fastify** : Le cœur de l'application. Il maintient l'état des projecteurs en mémoire, gère les commandes DMX, expose une API REST et un flux WebSocket.

2. **Service DMX** : Il maintient un univers de 512 canaux (valeurs 0–255). À chaque frame (30 fois/seconde par défaut), il envoie les valeurs via le protocole Art-Net vers QLC+.

3. **QLC+** : Ce logiciel libre reçoit le flux Art-Net et le retransmet sur l'interface DMX physique (câble USB Enttec → XLR → projecteurs).

4. **Pont HomeKit** : Utilise la bibliothèque `hap-nodejs` pour créer un pont domotique. Chaque projecteur RGB devient une ampoule dans l'app Maison. Chaque lyre devient un accessory avec des contrôles pan/tilt/couleur/gobo. Les changements sont appliqués en temps réel sur les canaux DMX correspondants.

5. **Frontend React** : Tableau de bord web avec actualisation en temps réel via WebSocket. Permet de voir les 512 canaux avec des sliders, d'importer des projecteurs depuis la bibliothèque QXF, et de surveiller l'état du pont HomeKit.

---

## Architecture du projet

LightBridgeDMX est un **monorepo pnpm** avec trois packages :

```
LightBridgeDMX/
├── backend/          ← API Fastify + services DMX/HomeKit
├── frontend/         ← Tableau de bord React/Vite
└── packages/
    └── shared/       ← Types TypeScript et schémas Zod partagés
```

### Backend (`backend/`)

| Fichier | Rôle |
|---------|------|
| `src/index.ts` | Point d'entrée : initialise Fastify, enregistre les routes, démarre DMX et HomeKit |
| `src/state/store.ts` | Stockage en mémoire des fixtures, scènes et presets |
| `src/websocket.ts` | Diffuse l'état DMX en temps réel à tous les clients connectés |
| `src/services/dmx.ts` | Boucle d'émission DMX (Art-Net ou Enttec USB) |
| `src/services/homekit.ts` | Pont HomeKit : crée les accessories, gère la synchro bidirectionnelle |
| `src/services/homekit-utils.ts` | Conversions HSB↔RGB, résolution des canaux RGB d'une fixture |
| `src/services/meross-plug.ts` | Allume une prise Meross (pilotage local LAN) quand un projecteur surveillé change en DMX |
| `src/services/qxf.ts` | Parsing XML des fichiers QXF (définitions de projecteurs QLC+) |
| `src/services/qxf-library.ts` | Téléchargement et cache de la bibliothèque QXF depuis GitHub |
| `src/routes/` | Tous les endpoints REST (fixtures, scènes, presets, univers, HomeKit, Meross) |

### Frontend (`frontend/`)

Le tableau de bord React reprend l'apparence d'un **pupitre grandMA2** (fond noir, liserés ambre, barres
de titre bleues, ligne de commande turquoise) et s'organise en **3 vues responsive** avec routing par hash URL :

| Onglet | Hash | Contenu |
|--------|------|---------|
| Live | `#live` | Le pupitre : plan de travail de fenêtres déplaçables (sheet, encodeurs, pools, playbacks) |
| Patch | `#patch` | Le plateau entier : projecteurs DMX, inventaire du LAN, lampes connectées |
| Setup | `#setup` | QR code HomeKit, prise Meross (config + état), infos système, redémarrage |

**Patch** se subdivise en trois volets, eux aussi dans l'URL : *Projecteurs* (`#patch`), *Inventaire
réseau* (`#patch/inventaire`) et *Lampes connectées* (`#patch/lampes`). Découvrir une Nanoleaf,
l'appairer puis lui donner une adresse DMX se fait ainsi sans changer d'onglet.

Les anciens liens (`#dashboard`, `#projecteurs`, `#reseau`, `#lampes`, `#appareils`, `#reglages`) restent
valides et redirigent vers la vue — ou le volet — correspondant : un signet ou un raccourci d'écran
d'accueil continue de marcher.

Sur desktop/tablet : barre de vues numérotées en haut. Sur mobile (<640px) : navigation basse.
En permanence : la **barre d'état** en haut (sortie DMX, canaux actifs, sélection, horloge, Blackout) et la
**ligne de commande** en bas ; au-delà de 1280 px de large s'ajoute le **rail de touches** à droite
(Fixture, Group, Thru, At, pavé numérique, Store/Go/Off, Please, B.O.).

| Fichier | Rôle |
|---------|------|
| `src/App.tsx` | Empile les providers : AppData → Selection → Console → Command → AppShell |
| `src/shell/AppShell.tsx` | Châssis : StatusBar + TabBar + vue active + KeypadRail + CommandLine + BottomNav |
| `src/shell/TabBar.tsx` / `BottomNav.tsx` | Navigation desktop / mobile |
| `src/shell/KeypadRail.tsx` | Rail de touches (≥1280px) : désignation, syntaxe, pavé, Store/Go/Off, Please |
| `src/shell/useHashTab.ts` | Routing par hash URL (sans react-router), traduit les anciens hashs |
| `src/contexts/AppDataContext.tsx` | État partagé : queries, mutations, WS handlers |
| `src/contexts/SelectionContext.tsx` | Le *programmer* — sélection, refus des projecteurs verrouillés |
| `src/contexts/ConsoleContext.tsx` | Pools : groupes, executors, playbacks, presets (STORE / GO / OFF) |
| `src/contexts/UniverseStateContext.tsx` | Universe DMX isolé pour absorber les ticks 30 Hz (+ ref stable sans abonnement) |
| `src/pages/*.tsx` | 3 pages (LivePage, PatchPage, SetupPage) + `pages/patch/SmartLightsPane.tsx` |
| `src/components/console/Workspace.tsx` | Gestionnaire de fenêtres de la vue Live + Views rappelables |
| `src/components/console/ConsoleWindow.tsx` | Cadre de fenêtre déplaçable / redimensionnable |
| `src/lib/console/layout.ts` | Modèle de disposition (grille 24 colonnes) + Views d'origine |
| `src/lib/console/scenes.ts` | Capture (STORE) et rappel à niveau (master d'intensité) |
| `src/lib/fixtureGuard.ts` | Projecteurs verrouillés (chambre) — garde-fou structurel |
| `src/hooks/useDmxWebsocket.ts` | WebSocket + log history rolling 10 |
| `src/components/ChannelGrid.tsx` | Grille des 512 canaux (16 → 12 → 8 → 4 colonnes selon viewport) |
| `src/components/QxfLibraryPanel.tsx` | Navigateur de la bibliothèque de projecteurs |
| `src/components/HomeKitCard.tsx` | Statut HomeKit avec QR code de couplage |
| `src/components/MerossCard.tsx` | Config (IP, device key, canal) + état de la prise Meross |
| `src/components/SmartLightsPanel.tsx` | Section smart lights (Nanoleaf + futurs) |
| `src/components/smart-lights/backendRegistry.ts` | Registre extensible des backends affichables |
| `src/lib/api.ts` | Client fetch vers l'API backend |

### Shared (`packages/shared/`)

Contient tous les **types TypeScript** et **schémas de validation Zod** utilisés à la fois par le backend et le frontend : `Fixture`, `Scene`, `Preset`, `UniverseState`, `WsEvent`, etc.

### Pourquoi ces choix techniques ?

En bref (détail complet dans [ARCHITECTURE.md](ARCHITECTURE.md#choix-techniques-et-pourquoi)) :

- **Tout en TypeScript** — les types attrapent les erreurs *en écrivant le code*, dans l'éditeur, plutôt qu'en production. Ils sont ensuite effacés à la transpilation : Node et le navigateur n'exécutent que du JavaScript.
- **Backend en Node.js (un choix)** — pour partager **un seul langage et les mêmes types** avec le frontend, et profiter de l'écosystème Node (`hap-nodejs`, `artnet`, `dmx-ts`, Prisma…).
- **Frontend en JS (forcé)** — un navigateur n'exécute que du JavaScript ; le TS y est transpilé par Vite.
- **Monorepo + package `shared`** — une **source unique de vérité** pour la forme des données : changer une fixture casse la compilation des deux côtés tout de suite, au lieu d'un bug runtime.

---

## Prérequis

Avant d'installer LightBridgeDMX, vérifie que tu as :

| Prérequis | Version | Vérification |
|-----------|---------|--------------|
| Node.js | 18 ou plus | `node --version` |
| pnpm | dernière version | `pnpm --version` |
| QLC+ | 4.x | [qlcplus.org](https://www.qlcplus.org) |
| Interface DMX | Enttec Open/Pro DMX USB | (matériel) |

### Installer Node.js et pnpm

```bash
# Installer Node.js via nvm (recommandé)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20

# Installer pnpm
npm install -g pnpm
```

### Installer QLC+

Télécharge QLC+ depuis [qlcplus.org](https://www.qlcplus.org) et installe-le sur le Mac qui possède l'interface DMX USB.

---

## Installation pas à pas

### Étape 1 : Cloner le projet

```bash
git clone https://github.com/alexjuillardoff/LightBridgeDMX.git
cd LightBridgeDMX
```

### Étape 2 : Installer les dépendances

```bash
pnpm install
```

Cette commande installe les dépendances des trois packages (`backend`, `frontend`, `shared`) en une seule fois.

### Étape 3 : Configurer QLC+

Pour que LightBridgeDMX puisse envoyer du DMX à tes projecteurs, tu dois configurer QLC+ en mode "passthrough" :

1. Ouvre QLC+
2. Va dans **Inputs/Outputs** (menu Patch)
3. Configure un **Input** Art-Net :
   - Type : Art-Net
   - Net : 0, Subnet : 0, Universe : 0
4. Configure un **Output** vers ton interface DMX USB (Enttec)
5. Active les deux et coche **"Passthrough"** pour que les signaux Art-Net reçus soient retransmis directement en DMX

QLC+ doit rester ouvert et actif pour que le DMX fonctionne.

### Étape 4 : (Optionnel) Configurer HomeKit

Si tu veux utiliser l'intégration HomeKit :

```bash
# Dans le fichier de démarrage ou en variables d'env :
export HOMEKIT_ENABLED=true
export HOMEKIT_NAME="Mon Studio"
export HOMEKIT_PIN="031-45-154"   # PIN de couplage (modifie-le)
```

> **Note :** Le PIN par défaut `031-45-154` est fonctionnel mais tu devrais le personnaliser.

---

## Configuration

Toute la configuration du backend se fait via des **variables d'environnement**.

### Variables DMX

| Variable | Valeur par défaut | Description |
|----------|------------------|-------------|
| `DMX_OUTPUT` | `enttec` | Mode de sortie : `artnet` (recommandé) ou `enttec` |
| `DMX_FPS` | `30` | Fréquence de rafraîchissement DMX (1–60 Hz) |
| `ARTNET_HOST` | `127.0.0.1` | Adresse IP de la machine faisant tourner QLC+ |
| `ARTNET_PORT` | `6454` | Port Art-Net (standard, ne pas changer) |
| `ARTNET_UNIVERSE` | `0` | Numéro d'univers DMX (0-based) |
| `DMX_PORT` | auto-détecté | Port série de l'interface Enttec (si mode `enttec`) |

### Variables HomeKit

| Variable | Valeur par défaut | Description |
|----------|------------------|-------------|
| `HOMEKIT_ENABLED` | `false` | Activer le pont HomeKit (`true` / `false`) |
| `HOMEKIT_NAME` | `LightBridgeDMX Bridge` | Nom affiché dans l'app Maison |
| `HOMEKIT_PIN` | `031-45-154` | Code de couplage HomeKit (format XXX-XX-XXX) |
| `HOMEKIT_USERNAME` | `11:22:33:44:55:66` | Adresse MAC du pont (format XX:XX:XX:XX:XX:XX) |
| `HOMEKIT_PORT` | auto | Port réseau du pont HAP |
| `HOMEKIT_STORAGE` | `.homekit/` | Dossier de stockage des données de couplage |

---

## Démarrage

### Mode développement (tout en une fois)

```bash
pnpm dev
```

Cela démarre simultanément le backend (port 5000) et le frontend (port 5173).

### Démarrer un seul service

```bash
# Backend seul
pnpm -C backend dev

# Frontend seul
pnpm -C frontend dev
```

### Avec Art-Net (configuration typique)

```bash
DMX_OUTPUT=artnet ARTNET_HOST=127.0.0.1 ARTNET_UNIVERSE=0 DMX_FPS=30 pnpm -C backend dev
```

> Si QLC+ tourne sur la même machine, utilise `127.0.0.1`. Sinon, l'IP de la machine QLC+ sur ton réseau local.

### Avec HomeKit activé

```bash
HOMEKIT_ENABLED=true HOMEKIT_PIN="031-45-154" DMX_OUTPUT=artnet pnpm -C backend dev
```

### Accéder au tableau de bord

Ouvre ton navigateur sur **[http://localhost:5173](http://localhost:5173)**

Depuis un autre appareil du réseau (téléphone, tablette), utilise l'IP de la machine : **http://192.168.0.200:5173**. Le serveur Vite est configuré avec `host: true`, il écoute donc sur toutes les interfaces.

#### Via un nom de domaine (optionnel)

Un **reverse proxy Caddy** installé sur la machine sert aussi le tableau de bord sous un nom de domaine, en HTTPS, avec un certificat Let's Encrypt automatique :

```
Navigateur ──HTTPS/WSS──► Caddy (:443) ──► Vite (:5173) ──► Backend (:5000)
```

L'accès est **restreint au réseau local** : le proxy ne répond qu'aux appareils dont l'IP est dans les plages privées. Depuis Internet (4G par exemple), la page affiche un message d'accès refusé au lieu du tableau de bord. Pratique pour avoir une URL mémorisable sur son téléphone sans exposer l'installation.

> ⚠️ La configuration du proxy **ne fait pas partie de ce dépôt** : elle vit dans `/usr/local/etc/Caddyfile`. Les détails techniques (réécriture du `Host` pour Vite, filtre par IP, exemption Let's Encrypt) sont documentés dans [DEVELOPMENT.md → Exposition réseau](DEVELOPMENT.md#exposition-réseau-reverse-proxy).

---

## Utiliser le tableau de bord

### Vue d'ensemble de l'interface

L'interface imite un pupitre lumière **grandMA2** : fond noir, fenêtres cernées d'ambre avec barre de titre
bleue, valeurs en jaune, ligne de commande turquoise en bas d'écran. Elle est organisée en **3 vues**
accessibles via la barre de navigation (barre de vues sur desktop/tablet, navigation basse sur mobile
<640px). Chaque vue a une URL dédiée pour le bookmarking et le partage de lien :

| Onglet | URL | Contenu |
|--------|-----|---------|
| **Live** | `/#live` | Le pupitre : fenêtres déplaçables — Fixture Sheet, encodeurs, groupes, presets, executors, playbacks |
| **Patch** | `/#patch` | Projecteurs patchés (création manuelle, import QXF), inventaire du LAN, lampes connectées |
| **Setup** | `/#setup` | QR code HomeKit, PIN, prise Meross, infos système, redémarrage |

La vue **Patch** se parcourt par volets, chacun avec son URL : *Projecteurs* (`/#patch`), *Inventaire
réseau* (`/#patch/inventaire`) et *Lampes connectées* (`/#patch/lampes`).

L'application s'ouvre sur **Live**.

#### La ligne de commande

En bas de l'écran, la barre turquoise se pilote comme celle d'un pupitre : on tape une phrase courte,
puis **Entrée** (ou la touche **Please** du rail de droite). Les valeurs sont en **pourcent** ; ajouter
`d` donne une valeur DMX brute (`pan 51d`).

| Exemple | Effet |
|---------|-------|
| `fix 1 thru 3` | sélectionne les projecteurs 1 à 3 (les numéros affichés dans la Fixture Sheet) |
| `fix 1 + 4 at 50` | sélectionne les projecteurs 1 et 4 et met leur dimmer à 50 % |
| `at 50` · `full` · `out` | règle le dimmer de la sélection courante |
| `red 100` · `pan 51d` | règle un attribut de la sélection |
| `ch 12 thru 20 at 75` | écrit directement des canaux de l'univers |
| `all` · `clear` | sélectionne tout (hors verrouillés) / vide la sélection |
| `store 1 Ambiance` | mémorise l'état courant dans l'executor 1 |
| `go 1` · `off 1` | rejoue / éteint l'executor 1 |
| `store group 2 Salon` · `group 2` | mémorise / rappelle un groupe de sélection |
| `store preset 3 Bleu` · `preset 3` | mémorise / applique un preset |
| `blackout` | remet les 512 canaux à zéro |
| `goto patch` | change de vue (`live`, `patch`, `setup`) ; `goto reseau`, `goto appareils` et `goto lampes` ouvrent le volet correspondant de Patch |
| `help` | rappelle la liste des commandes |

Les mots-clés fonctionnent aussi en français (`projecteur`, `canal`, `rouge`, `couleur`…), les flèches
haut/bas rappellent les commandes précédentes, et la ligne au-dessus de la saisie affiche le résultat de
la dernière commande (ou le dernier message du backend).

#### Vue Live — le pupitre

C'est la vue par défaut, et ce n'est **pas une page qui défile** : c'est un plan de travail sur lequel on
pose des fenêtres, comme sur l'écran Live d'un grandMA. On regarde la sélection, les encodeurs et les
executors *en même temps*, parce qu'on s'en sert ensemble.

##### Fenêtres et Views

- **Glisser la barre de titre** déplace une fenêtre ; **glisser le coin bas-droit** la redimensionne.
  Tout s'accroche à une grille, donc rien ne se pose de travers et deux fenêtres voisines s'alignent
  toutes seules.
- La croix ferme une fenêtre, **+ Fenêtre** en rouvre une (dix types disponibles), **Reset** rétablit la
  disposition d'origine de la view courante.
- La barre du haut porte quatre **Views** rappelables par leur numéro :
  **1 Programmer** (sheet + encodeurs + les trois pools + playbacks), **2 Playback** (executors et faders
  en grand), **3 DMX** (fader view + DMX sheet), **4 Effets** (Mode Dance).
- La disposition est mémorisée par navigateur : on la range une fois, on la retrouve.

> Sous 1024 px de large, les fenêtres sont simplement **empilées** : on ne déplace pas des fenêtres au
> pouce sur un téléphone, mais tout reste accessible.

##### Fixture Sheet

Une cellule par projecteur, **regroupée par pièce** (Salon, Bureau, Non assigné) : son numéro, son nom,
son niveau de dimmer en %, une barre de niveau, sa couleur RGB courante et son adresse.
**Cliquer une cellule la sélectionne** (cadre jaune) ; la sélection est la cible des encodeurs, de la
ligne de commande et de Store, et elle est conservée quand on change de vue.

> Le numéro affiché (001, 002…) est celui qu'on tape dans la ligne de commande : `fix 2 at 50`. Il reste
> le même quel que soit le regroupement.

Un projecteur **verrouillé** (voir plus bas) apparaît hachuré, avec un cadenas rouge : il reste lisible,
mais on ne peut pas le sélectionner ni l'allumer.

##### Encodeurs

Des molettes agissant sur la **sélection courante**, regroupées par famille d'attributs
(1 Dimmer, 2 Color, 3 Position, 4 Beam). On tourne une molette en glissant dessus (haut/droite = plus),
au clavier avec les flèches (Maj = pas de 10, Début/Fin = 0 / 100 %). Sous chaque molette, une rangée de
valeurs rapides (**0 / 25 / 50 / 75 / FL**) évite de viser au pixel près. Seuls les attributs réellement
présents sur les projecteurs sélectionnés sont affichés.

##### Executors — mémoriser et rejouer une ambiance

C'est le cœur du pupitre. Chaque emplacement numéroté peut contenir une **scène** :

1. Sélectionne les projecteurs à mémoriser (ou personne : c'est alors tout le plateau).
2. Règle-les comme tu veux.
3. Clique un emplacement **libre** (ou tape `store 3`) et donne un nom — « Apéro », « Ciné », « Soirée ».
4. Plus tard, un **clic sur la tuile** (ou `go 3`) rejoue l'ambiance.

Les trois petites touches sous chaque tuile : **■** éteint uniquement ce que cette scène pilote,
**💾** ré-enregistre l'état courant par-dessus, **🗑** libère l'emplacement (la scène reste enregistrée).

Les scènes sont stockées côté backend : elles survivent au redémarrage et sont les mêmes depuis le
téléphone et depuis l'ordinateur. Rejouer une scène passe aussi par le backend, donc **tous les écrans
ouverts se mettent à jour**.

##### Playbacks — les faders master

Un fader par executor. Le monter rejoue la scène à un niveau intermédiaire : c'est un **master
d'intensité**, il n'atténue que la lumière (intensité, rouge, vert, bleu, blanc). La position d'une lyre,
sa roue de gobos et sa roue de couleurs restent là où la scène les a mises — baisser un playback baisse
la lumière, ça ne fait pas dériver le projecteur à mi-course.

##### Groups — mémoriser une sélection

« Les trois PAR du salon » ne se re-sélectionnent pas vingt fois par soirée. Sélectionne-les, clique un
emplacement libre du pool **Groups** (ou tape `store group 2 Salon`), et un clic sur la tuile — ou
`group 2` — restitue la sélection.

> Les groupes et la disposition des fenêtres sont propres au **navigateur** (ils décrivent une habitude
> de travail) ; les scènes et les presets vivent côté serveur.

##### Presets — mémoriser des valeurs

Différence avec un executor, à ne pas confondre : un **executor** mémorise un état de projecteurs et se
rejoue avec un master ; un **preset** mémorise une carte canal → valeur brute, réappliquée telle quelle.
Le preset sert aux valeurs de référence qu'on repose souvent : une teinte, une position de lyre, une
ouverture de faisceau.

##### Fader view (canaux DMX)

La grille affiche les **512 canaux DMX** page par page, en faders verticaux :
- Chaque fader contrôle un canal de 0 à 255 (glisser dessus, ou saisir la valeur sous le fader)
- Les canaux appartenant à un projecteur sont **colorés** et annotés avec le nom du projecteur et du canal
- **Page − / Page +** pour naviguer (32 canaux à la fois), ou le sélecteur **Aller au projecteur** pour sauter directement sur la plage de canaux d'un projecteur (utile pour les gros patchs comme un strip Nanoleaf exposé par zone : 150 canaux d'un coup)
- Tout projecteur patché y apparaît, **même s'il ne correspond pas à du DMX physique** — la vue lit l'univers, pas le matériel
- Le layout s'adapte : 16 colonnes sur grand écran, 12 / 8 sur écran moyen, 4 sur mobile

##### DMX Sheet

Les 512 canaux de l'univers en une grille compacte, en lecture seule : une case par canal, hauteur =
niveau, liseré ambre sur les canaux patchés.

##### Mode Dance

Strobe coordonné par pièce avec patterns spatiaux (12 patterns : chase, ping-pong, vagues, alternance,
paires, random subset, full hit, strobe synchrone, bookend…). C'est la view **4 Effets**.

##### Projecteurs verrouillés

Certains projecteurs ne doivent **jamais** être allumés depuis le pupitre — typiquement celui d'une
chambre où quelqu'un dort. Plutôt que de les masquer (un projecteur invisible finit par être rallumé par
accident), ils restent **visibles mais verrouillés** : cadenas rouge, cellule hachurée, clic sans effet.

Le verrou tient à tous les niveaux : ils sont refusés par `all`, ignorés par les encodeurs et les
groupes, et exclus des scènes aussi bien à l'enregistrement qu'au rappel. La règle est une **liste
blanche** — verrouillage par pièce (`chambre`), par nom, ou par identifiant, dans
`frontend/src/lib/fixtureGuard.ts`.

#### Vue Patch

Tout ce qui définit le plateau avant de jouer, câblé comme sans fil, en trois volets sélectionnés par
les pastilles en haut de la vue :

| Volet | URL | Contenu |
|-------|-----|---------|
| **Projecteurs** | `/#patch` | Le patch DMX : liste des projecteurs, ajout manuel, import QXF |
| **Inventaire réseau** | `/#patch/inventaire` | Ce que le LAN expose, pilotable ou non, avec la raison |
| **Lampes connectées** | `/#patch/lampes` | Pilotage fin des lampes appairées (Nanoleaf, futurs Hue/Matter) |

Dans le volet *Projecteurs*, la **liste des projecteurs patchés** vient en premier : neuf fois sur dix,
on ouvre cette vue pour vérifier une adresse, pas pour ajouter un projecteur.

##### Liste des projecteurs

Affiche tous les projecteurs configurés avec :
- Nom, adresse DMX, univers
- Badge **"HomeKit"** si le projecteur est exposé dans l'app Maison
- Profil QXF (fabricant, modèle, mode) si importé depuis la bibliothèque
- Bouton **Supprimer** (remet automatiquement les canaux DMX à 0)

Sur mobile, la liste se transforme automatiquement en cartes empilées avec labels.

##### Ajouter un projecteur manuellement

Utilise le formulaire **"Nouveau projecteur"** :
1. **Nom** : nom lisible du projecteur (ex: "PAR Scène Gauche")
2. **Adresse DMX** : adresse de départ (1–512)
3. **Univers** : numéro d'univers (0 par défaut)
4. **Template** : choisis parmi les templates prédéfinis :
   - **RGB** (3 canaux : Rouge, Vert, Bleu)
   - **RGBW** (4 canaux : Rouge, Vert, Bleu, Blanc)
   - **Dimmer** (1 canal : intensité)

##### Importer depuis la bibliothèque QXF

Pour importer un projecteur avec son profil officiel :
1. Va dans la carte **"Bibliothèque QXF"**
2. Sélectionne la **marque** (ex: "Eurolite", "Chauvet")
3. Sélectionne le **modèle** de projecteur
4. Choisis le **mode DMX** (si le projecteur en a plusieurs)
5. Définis l'**adresse DMX** et l'**univers**
6. Clique sur **"Créer ce fixture"**

> La première fois, la bibliothèque est téléchargée automatiquement depuis GitHub (~50 Mo, quelques secondes d'attente).

#### Volets réseau de la vue Patch

Le réseau vit dans la vue **Patch**, avec les projecteurs DMX : découvrir un appareil, l'appairer puis
lui donner une adresse est un seul geste, et « de quoi est fait le plateau ? » une seule question.

##### Volet Inventaire réseau (`/#patch/inventaire`)

Tout ce que LightBridge voit sur le réseau, regroupé par famille (projecteurs DMX, lampes connectées,
prises, ponts et passerelles, détectés non identifiables). Il affiche **aussi ce qui n'est pas
pilotable, avec la raison** : c'est le point de départ quand on se demande « pourquoi ma lampe
n'apparaît nulle part ? ». Le bouton **Rescanner** relance une écoute mDNS (~6 s), et un Nanoleaf en mode
appairage se rattache directement depuis sa ligne.

**Panneau « Ampoules Thread »** — ajout d'une ampoule Nanoleaf Essentials (A19, modèle NL45) en deux
gestes. Ces ampoules ne parlent ni HTTP ni Matter mais HomeKit sur Thread, et n'apparaissent dans aucun
scan IPv4 : il faut devenir leur contrôleur HAP, donc les sortir de la maison Apple.

1. **Appairer** — saisis le nom de l'ampoule (proposé depuis le réseau) et son **code à 8 chiffres**,
   relevé dans l'app Maison (accessoire → réglages → bas de page). Une fenêtre Terminal s'ouvre :
   réinitialise l'ampoule pendant qu'elle cherche — *éteindre 3 s, rallumer 1 s, cinq fois*, jusqu'aux
   trois clignotements rouges. Cette étape reste manuelle car elle exige le Bluetooth, que macOS
   n'accorde jamais à un service sans interface.
2. **Patcher** — l'ampoule apparaît dans *prêtes à patcher*. Un clic déclare la lampe, trouve une
   adresse DMX libre, crée le projecteur, pose le miroir et l'expose dans HomeKit comme une **ampoule
   normale** (une seule, avec teinte et saturation) et non canal par canal. Le menu déroulant permet de
   la **rattacher à un projecteur existant** plutôt que d'en créer un second.

> Sans le code à 8 chiffres, une ampoule réinitialisée n'est réappairable nulle part — ni dans Maison,
> ni dans LightBridge. C'est le seul point de non-retour : relève-le **avant** de réinitialiser.

Prérequis : `THREAD_DATASET` dans `backend/.env` et le sidecar Python démarré. Si le sidecar est
arrêté, le panneau le dit et donne la commande. Procédure détaillée et pièges :
[`tools/homekit-thread/README.md`](tools/homekit-thread/README.md).

##### Volet Lampes connectées (`/#patch/lampes`)

- **Pastilles de filtre** en haut pour afficher uniquement une marque (Nanoleaf, etc.)
- **Carte de pairing** pour ajouter un Nanoleaf : scan mDNS automatique ou IP manuelle
- **Carte par lampe** avec sliders couleur (HSL + température), toggle streaming UDP, et **3 onglets internes** :
  - **Painter** : palette de zones cliquables (drag pour peindre, zones spare en noir)
  - **Effets** : designer d'effets (solid, gradient, chase, wave) avec sliders live
  - **Layout 3D** : éditeur React Three Fiber pour positionner les zones dans l'espace (preset U-shape, loop, etc.)
- **Mirror DMX** : lier les canaux R/G/B/Dimmer d'un strip à 4 canaux DMX → pilote la lampe depuis une scène DMX
- **Projecteur DMX par zone** : bouton *Exposer en DMX* (panneau avancé) → chaque zone du strip reçoit 3 canaux R/G/B, comme un vrai projecteur multi-cellules

> Pour ajouter un nouveau backend (Hue, Matter…) plus tard : ajouter une entrée dans `frontend/src/components/smart-lights/backendRegistry.ts` + un nouveau type dans la discriminated union `SmartLight.config.type` côté `shared/`.

#### Vue Setup

##### Carte HomeKit

Si HomeKit est activé :
- Badge de statut (Actif / Inactif)
- **QR code** à scanner depuis l'app Maison
- **PIN** de couplage
- Liste des projecteurs exposés comme ampoules HomeKit

##### Cartes Système / Variables backend

- État WebSocket en direct + URL utilisée
- API base, mode (dev/prod)
- Variables backend en lecture seule (DMX_OUTPUT, ARTNET_HOST, DMX_FPS, HomeKit on/off) — pour modifier, éditer `backend/.env` ou le plist launchd.

---

## Intégration HomeKit

### Activer le pont HomeKit

1. Démarre le backend avec `HOMEKIT_ENABLED=true`
2. Ouvre l'app **Maison** sur ton iPhone/iPad
3. Appuie sur **"+"** → **"Ajouter un accessoire"**
4. Scanne le QR code affiché dans la carte HomeKit du tableau de bord, **OU** entre le code PIN manuellement

### Quels projecteurs sont exposés ?

Deux types de fixtures sont exposées dans HomeKit, détectés automatiquement :

| Type | Critère de détection | Accessory HomeKit |
|------|---------------------|-------------------|
| **Projecteur RGB** | Capabilities `r` + `g` + `b`, ou `homekit.dmxChannels` explicite | `Lightbulb` (On, Luminosité, Teinte, Saturation) |
| **Lyre / Moving head** | Capability `pan` ou `tilt` présente | Multi-services (voir ci-dessous) |

> Une fixture avec `pan` ou `tilt` est **toujours** traitée comme lyre, même si elle a aussi des canaux RGB.

### Contrôle des projecteurs RGB

Chaque projecteur RGB apparaît comme une **ampoule** dans l'app Maison :
- **On/Off** : allume/éteint (force RGB à 0 si Off)
- **Luminosité** (0–100%) → mappée sur les valeurs DMX
- **Couleur** (Teinte/Saturation) → convertie en R/G/B DMX via l'algorithme HSB→RGB

### Contrôle des lyres (Moving Heads)

Chaque lyre apparaît comme un **accessory unique** avec plusieurs contrôles dans l'app Maison, selon les canaux présents dans son profil QXF :

| Contrôle HomeKit | Type de service | Canal DMX |
|-----------------|----------------|-----------|
| Dimmer (On + Luminosité) | `Lightbulb` | `intensity` |
| Shutter (ouverture via On/Off) | `Lightbulb` | `strobe` |
| Pan (slider 0–100%) | `Lightbulb` nommé "Pan" | `pan` |
| Tilt (slider 0–100%) | `Lightbulb` nommé "Tilt" | `tilt` |
| Roue couleur (slider 0–100%) | `Lightbulb` nommé "Color Wheel" | `color` |
| Gobo (slider 0–100%) | `Lightbulb` nommé "Gobo" | `gobo` |

Les sliders 0–100% de HomeKit sont convertis linéairement en DMX 0–255.

### Bidirectionnel pour tous les types

Les changements sont **bidirectionnels** pour les deux types : si tu modifies un canal DMX depuis le tableau de bord, via une scène ou un preset, l'app Maison se met à jour automatiquement.

### Overrides de canaux HomeKit

Par défaut, les canaux sont déduits automatiquement du profil QXF. Tu peux les surcharger via le champ `homekit` de la fixture :

**Fixture RGB — override des canaux :**
```json
{
  "homekit": {
    "enabled": true,
    "deviceId": "par-rgb-scene",
    "name": "PAR RGB Scène",
    "dmxChannels": { "r": 1, "g": 2, "b": 3 }
  }
}
```

**Lyre — override des canaux (numéros relatifs à l'adresse de la fixture) :**
```json
{
  "homekit": {
    "enabled": true,
    "deviceId": "mh-x20-gauche",
    "name": "MH-X20 Gauche",
    "movingHeadChannels": {
      "dimmerChannel": 8,
      "shutterChannel": 7,
      "panChannel": 1,
      "tiltChannel": 3,
      "colorChannel": 5,
      "goboChannel": 6
    }
  }
}
```

> Le `deviceId` stabilise l'identité HomeKit. Si tu le changes, HomeKit considère que c'est un nouvel accessoire.

---

## Smart Lights (Nanoleaf)

LightBridgeDMX pilote des lampes WiFi (V1 : Nanoleaf, autres backends extensibles) avec **basse latence**, **mirror DMX bidirectionnel** et **effets dynamiques en 3D**.

Modèles testés :
- **Nanoleaf Lightstrip Essentials NL72K3** (50 zones LED addressables) — WiFi, streaming UDP 30 Hz
- **Nanoleaf Essentials A19 NL45** (ampoule) — HomeKit sur Thread, voir [`tools/homekit-thread/`](tools/homekit-thread/README.md)

### Contrôleur unique : pourquoi sortir la lampe de l'app Maison

Le montage recommandé est que **LightBridge soit le seul contrôleur** de la lampe, et que
HomeKit ne l'atteigne plus que par notre pont. Ça n'est pas une préférence esthétique :
c'est ce qui supprime le risque de déconnexion.

Côté Nanoleaf, **tout `PUT /state` ou `PUT /effects` met fin au mode extControl**. Une app
tierce — l'app Nanoleaf, une scène Maison, un automatisme — qui écrit directement fait donc
sortir le strip du streaming UDP, et le pilotage rapide s'arrête.

Quand LightBridge est seul contrôleur, le problème disparaît **par construction** :

- `flushAll()` saute les lampes en streaming — aucune écriture HTTP n'est émise ;
- `streamAll()` pousse l'état voulu en UDP, y compris celui venu de HomeKit ou de l'UI ;
- une commande depuis l'app Maison traverse notre pont, atterrit dans `applyState()` et
  ressort en **trame UDP**, jamais en `PUT /state`.

Le chien de garde du streaming ne sert plus que de second rideau, si quelque chose force
malgré tout un `PUT` depuis l'extérieur : il rétablit l'extControl dans les 10 s.

### Configuration en place (salon)

| | Nanoleaf IML 735 (NL72K3) | Lampe Salon (NL45) |
|---|---|---|
| Transport | HTTP + **streaming UDP**, 50 zones, ~30 Hz | HAP/CoAP sur Thread, ~5 écritures/s |
| Façade DMX | **ch. 108-257** — 3 canaux RVB par zone | ch. 33-37 — dimmer, RVB, température |
| HomeKit | via le pont, une ampoule | via le pont, une ampoule |
| Dans l'app Maison en direct | non | non |

La façade **par zone** est ce qui rend l'UDP rapide réellement exploitable : elle parle le
même langage que le streaming — des couleurs RVB par zone, sans conversion intermédiaire.
Une façade uniforme à 5 canaux aurait gâché la capacité du strip. À l'inverse, l'ampoule
Thread plafonne à quelques écritures par seconde : une façade simple lui suffit largement.

### Vue d'ensemble du flux

```
            Frontend (React)                              Backend (SmartLightService)
┌──────────────────────────────────┐                ┌──────────────────────────────────┐
│ • SmartLightsPanel               │   HTTP/WS      │ • NanoleafClient (HTTP, port 16021)
│ • ZonePainter (50 swatches)      │  ───────────►  │ • NanoleafStreamer (UDP, port 60222)
│ • EffectDesigner (4 effets)      │                │ • EffectEngine (30 Hz, 5 effets)
│ • LayoutEditor3D (Three.js)      │                │ • discovery mDNS (_nanoleafapi._tcp)
└──────────────────────────────────┘                └────────────────┬─────────────────┘
                                                                     │ HTTP + UDP streaming
                                                     ┌───────────────▼──────────────┐
                                                     │  Nanoleaf strip / panels      │
                                                     │  192.168.0.234 (NL72K3)       │
                                                     └───────────────────────────────┘
```

### Pairing d'un Nanoleaf

1. Active l'option **API** dans l'app Nanoleaf (le strip doit être déjà connecté à ton WiFi). Cette option ouvre une fenêtre de 30 s pendant laquelle le pairing est autorisé.
   *Alternative :* maintiens le bouton power du strip ~5–7 s jusqu'à voir la LED pulser.
2. Dans LightBridge à http://localhost:5173/ → section **Smart Lights**, clique **Scanner** (mDNS) ou saisis l'IP manuellement (`192.168.0.234`).
3. Clique **Pairer**. Le backend POST `/api/v1/new` au strip, récupère un `auth_token` qui est persisté en DB.
4. Le strip apparaît comme carte avec sliders couleur, color picker et toggles.

### Latence : HTTP vs UDP streaming

Deux chemins de sortie disponibles via le toggle **Streaming UDP** sur la carte :

| Chemin | Latence perçue | Quand l'utiliser |
|--------|----------------|------------------|
| HTTP coalescé (par défaut) | ~80–150 ms | Sliders UI, ambiances statiques, scènes lentes |
| UDP extControl (streaming) | ~5–15 ms | DMX-mirror, Dance mode, effets continus, music sync |

Le streaming UDP envoie ~30 frames/s via le port 60222 et entre/sort du mode `extControl` automatiquement.

### Le strip comme projecteur DMX (une cellule R/G/B par zone)

Le panneau avancé d'une lampe (bouton **Avancé** sur la carte) contient une section **Projecteur DMX par zone**. Un clic sur **Exposer en DMX** crée un projecteur classique dont chaque zone occupe **3 canaux consécutifs — rouge, vert, bleu** :

```
zone 1 → adresse+0 (R), +1 (G), +2 (B)
zone 2 → adresse+3 (R), +4 (G), +5 (B)
…                                          50 zones = 150 canaux
```

À partir de là le strip se pilote comme n'importe quel projecteur : sliders de la fixture sheet, scènes, presets, Art-Net entrant depuis QLC+.

- Laisse le champ **Adresse** vide pour que le backend alloue automatiquement le premier bloc de canaux libre.
- **Le streaming UDP doit être actif** : les frames par zone partent par ce chemin.
- Le pilotage local (painter, effets, sliders couleur) et le DMX cohabitent en **LTP** : le dernier qui bouge gagne. Dès qu'un canal du bloc change, le DMX prend la main ; dès qu'on touche au painter ou à un effet, il la rend.
- **Retirer** supprime le projecteur généré et débranche le mirror.

### Painter par zone

Pour les strips à zones addressables (NL72K3 : 50 zones) :
- **Click + drag** = peint chaque zone avec la couleur de pinceau
- **Clic droit** = marque une zone comme **spare** (LED non câblée physiquement)
- **Presets** = 8 couleurs prédéfinies + un pinceau "spare" (hachuré)
- **Fill all** = applique la couleur courante sur toutes les zones
- **Appliquer** = envoie la palette via `POST /:id/effect` (kind=`static`) + persiste les zones spare dans le layout

Les zones spare sont :
- Forcées en noir par l'EffectEngine quels que soient les effets actifs
- Cachées dans l'éditeur 3D (option Cacher spare)
- Marquées visuellement par un motif diagonal hachuré dans le painter

### Layout 3D physique

L'éditeur 3D (React Three Fiber, lazy-loaded ~600 KB) permet de définir où chaque zone se trouve physiquement dans l'espace :

- **Mode Linked (défaut)** : 51 points (N+1) qui forment une polyline ; chaque segment est une zone
- **Mode Unlinked** : 100 points (2N) indépendants — pour formes non-connectées
- **Drag** des sphères dans le plan XZ (Y verrouillé) ou XY (Y libéré via shift)
- **OrbitControls** : clic droit = rotation, molette = zoom
- **Reset** : remet en ligne droite (X de -0.5 à +0.5)
- **Preset U-shape** : génère automatiquement un layout en U autour d'une pièce rectangulaire à partir de 4 nombres (zones par côté : fond / droit / avant / gauche) + largeur × profondeur

### Preset U-shape (typique pour strip autour d'une pièce)

Le preset construit 4 segments connectés :

```
       (fond)
   ◄─────────────►   zones 0..n-1 — jaune
  ▲                 ▲
  │                 │
(gauche)        (droit)  zones distribuées sur chaque côté
  │                 │
  ▼                 ▼
   ◄─────────────►   zones (avant) — bleu
```

Le sens du parcours est **horaire vu de dessus** : fond (X+) → droit (Z+) → avant (X−) → gauche (Z−).
Les zones au-delà des actives sont **auto-marquées spare** et placées dans un coin caché.

### Effets position-aware (l'EffectEngine)

Le SmartLightService évalue l'effet courant à 30 Hz et pousse les couleurs par zone via le streamer.

| Effet | Paramètres | Description |
|-------|------------|-------------|
| `static` | palette (50 RgbColor) | Palette figée — alimentée par le ZonePainter |
| `solid` | color, brightness | Une couleur unie sur toutes les zones |
| `gradient` | from, to, direction (X/Y/Z), scrollSpeed | Interpole entre 2 couleurs le long d'un axe 3D. ScrollSpeed > 0 = anime |
| `chase` | color, bgColor, speed, width, bounce | Tête lumineuse qui voyage le long des zones (index) avec falloff |
| `wave` | from, to, direction, wavelength, speed | Onde sinusoïdale colorée qui voyage dans une direction 3D |

Les effets `gradient` et `wave` projettent le **milieu** de chaque zone sur la direction normalisée — donc avec un layout en U, un `wave` dans la direction X (1,0,0) traverse simultanément le fond et l'avant, ce qui peut être contre-intuitif. Préfère une direction alignée sur le parcours du strip si tu veux un effet "qui voyage" le long de la bande.

### DMX-Mirror (lier le strip aux canaux DMX)

Le panneau Avancé d'une carte smart light permet de configurer un mirror DMX :

```
R: canal 509   G: canal 510   B: canal 511   Dimmer: canal 512
```

Ces canaux sont alors lus à chaque tick DMX. La conversion RGB → HSV est appliquée et poussée dans `desired`, qui est ensuite flush via HTTP coalescé (ou UDP si streaming actif). Conséquences :
- Une scène DMX qui touche ces canaux pilote aussi le strip
- Le Dance mode peut inclure les canaux mirror dans ses patterns
- Les sliders du `ChannelGrid` agissent en direct sur le strip

### Effets builtin Nanoleaf

Outre les effets position-aware évalués localement, on peut piloter les effets builtin du device (Cozy Glow, Northern Lights, etc.) :

- Le panneau **Avancé** liste les effets dispo (`GET /:id/effects`)
- Sélectionner un effet appelle `POST /:id/effects/select` → le device prend la main, on sort du mode streaming UDP

---

## Bibliothèque QXF

### Qu'est-ce que QXF ?

QXF est le format XML utilisé par **QLC+** pour décrire les projecteurs DMX. Un fichier QXF contient :
- Le fabricant et le modèle du projecteur
- Un ou plusieurs **modes DMX** (nombre de canaux différents selon le mode choisi)
- Pour chaque canal : son numéro, sa fonction (rouge, vert, bleu, strobe, pan, tilt…)

La bibliothèque QLC+ compte plus de **3000 définitions** de projecteurs de tous les fabricants (Chauvet, Eurolite, ADJ, Martin, Robe…).

### Téléchargement automatique

Lors du premier accès à la bibliothèque QXF depuis le tableau de bord, le backend télécharge automatiquement le dépôt QLC+ depuis GitHub et extrait tous les fichiers `.qxf` dans `backend/data/fixtures/`.

Pour forcer un re-téléchargement (mise à jour de la bibliothèque) :
- Dans le panneau QXF, clique sur **"Rafraîchir la bibliothèque"**
- Ou via l'API : `POST /api/qxf/library/refresh`

### Comment ça fonctionne en interne

1. `GET /api/qxf/library` → `qxf-library.ts` vérifie si `backend/data/fixtures/` existe
2. Si absent : télécharge le ZIP de GitHub, extrait les `.qxf`
3. Parse chaque fichier XML avec `fast-xml-parser`
4. Retourne la liste avec fabricant, modèle, et modes disponibles
5. `POST /api/fixtures/import/qxf-library` → relit le fichier QXF, construit une `Fixture`, l'ajoute au store

---

## Services persistants (macOS)

Pour que LightBridgeDMX démarre automatiquement au démarrage du Mac et reste actif même quand VS Code est fermé, deux agents **launchd** sont disponibles.

### Fichiers plist

- Backend : `~/Library/LaunchAgents/com.lightbridgedmx.backend.dev.plist`
- Frontend : `~/Library/LaunchAgents/com.lightbridgedmx.frontend.dev.plist`

### Commandes de gestion

```bash
# Charger et démarrer les services
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.lightbridgedmx.backend.dev.plist
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.lightbridgedmx.frontend.dev.plist

# Redémarrer un service
launchctl kickstart -k gui/501/com.lightbridgedmx.backend.dev
launchctl kickstart -k gui/501/com.lightbridgedmx.frontend.dev

# Arrêter et décharger
launchctl bootout gui/501 ~/Library/LaunchAgents/com.lightbridgedmx.backend.dev.plist
launchctl bootout gui/501 ~/Library/LaunchAgents/com.lightbridgedmx.frontend.dev.plist

# Vérifier l'état
launchctl list | grep lightbridge

# Voir les logs en direct
tail -f logs/backend-dev.out.log logs/backend-dev.err.log
```

### Activer HomeKit via launchd

Pour modifier les variables d'environnement du service launchd :

```bash
# Activer HomeKit dans le plist backend
plutil -replace EnvironmentVariables.HOMEKIT_ENABLED -string true \
  ~/Library/LaunchAgents/com.lightbridgedmx.backend.dev.plist

# Redémarrer pour prendre en compte
launchctl bootout gui/501 ~/Library/LaunchAgents/com.lightbridgedmx.backend.dev.plist
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.lightbridgedmx.backend.dev.plist
```

---

## API REST

Toutes les requêtes sont en JSON. Le backend tourne sur le port **5000**.

### Projecteurs (Fixtures)

```bash
# Lister tous les projecteurs
GET /api/fixtures

# Créer un projecteur
POST /api/fixtures
{
  "name": "PAR LED Rouge",
  "address": 1,
  "universe": 0,
  "channels": [
    { "channel": 1, "capability": "r" },
    { "channel": 2, "capability": "g" },
    { "channel": 3, "capability": "b" }
  ]
}

# Modifier un projecteur
PUT /api/fixtures/:id
{ "name": "Nouveau nom" }

# Supprimer un projecteur
DELETE /api/fixtures/:id

# Importer depuis la bibliothèque QXF
POST /api/fixtures/import/qxf-library
{
  "path": "Chauvet/COLORband-T3-BT.qxf",
  "mode": "3-channel",
  "address": 10,
  "universe": 0
}
```

### Univers DMX

```bash
# Définir la valeur d'un canal (1-based)
POST /api/universe/1
{ "value": 255 }

# Tester un projecteur avec des valeurs
POST /api/test/fixtures/:id
{ "values": [255, 128, 0] }
```

### Scènes et Presets

```bash
# Créer une scène
POST /api/scenes
{
  "name": "Ambiance Rouge",
  "steps": [
    { "fixtureId": "uuid-du-projecteur", "values": [255, 0, 0] }
  ]
}

# Activer une scène
POST /api/scenes/:id/activate

# Créer un preset
POST /api/presets
{
  "name": "Plein Feux",
  "payload": { "1": 255, "2": 255, "3": 255 }
}

# Appliquer un preset
POST /api/presets/:id/apply
```

### Smart Lights

```bash
# Liste / création / modification / suppression
GET    /api/smart-lights
GET    /api/smart-lights/:id
POST   /api/smart-lights
PUT    /api/smart-lights/:id
DELETE /api/smart-lights/:id

# Pairing Nanoleaf (le strip doit être en mode pairing)
POST /api/smart-lights/pair
{ "host": "192.168.0.234", "name": "Strip salon", "room": "salon" }

POST /api/smart-lights/:id/pair   # re-pair (renouvelle le token)
POST /api/smart-lights/probe      # test reachability sans pairing
{ "host": "192.168.0.234" }

# État (couleur, on/off, brightness, CT)
POST /api/smart-lights/:id/state
{ "on": true, "rgb": { "r": 255, "g": 0, "b": 128 } }

# Streaming UDP (basse latence) — toggle on/off
POST /api/smart-lights/:id/streaming
{ "enabled": true, "zoneCount": 50 }

# Per-zone palette (requiert streaming actif)
POST /api/smart-lights/:id/zones
{ "zones": [{ "index": 0, "r": 255, "g": 0, "b": 0 }, ...] }

# Layout 3D physique des zones
POST /api/smart-lights/:id/layout
{ "mode": "linked", "segments": [...], "spareZones": [36,37,...], "sides": [...] }

# Effet position-aware (EffectEngine)
POST /api/smart-lights/:id/effect
{ "kind": "chase", "color": { "r": 0, "g": 200, "b": 255 }, "speed": 5, "width": 3 }

# Effets builtin Nanoleaf
GET  /api/smart-lights/:id/effects                    # liste les effets du device
POST /api/smart-lights/:id/effects/select { "name": "Cozy Glow" }

# Discovery mDNS (~3s de scan)
POST /api/smart-lights/discover
{ "timeoutMs": 3000 }
```

### Autres

```bash
# Statut HomeKit
GET /api/homekit

# Healthcheck
GET /api/health

# Bibliothèque QXF
GET /api/qxf/library
POST /api/qxf/library/refresh

# Liste des pièces (union fixtures + smart lights)
GET /api/rooms
```

---

## WebSocket temps réel

Le frontend se connecte au WebSocket sur `/ws`, **sur la même origine que la page** : `ws://localhost:5173/ws` en accès direct, `wss://<domaine>/ws` derrière le reverse proxy. Le protocole (`ws` / `wss`) suit celui de la page, ce qui évite tout blocage Mixed Content en HTTPS. La connexion est ensuite relayée jusqu'au backend `:5000`.

Un script externe, lui, peut viser le backend directement sur `ws://localhost:5000/ws`.

### Messages reçus (serveur → client)

```typescript
// Tick de l'univers DMX (N fois par seconde)
{
  type: "universe_tick",
  data: {
    fps: 30,
    universe: 0,
    values: [0, 255, 128, 0, ...],  // 512 valeurs
    timestamp: "2024-01-15T20:30:00.000Z"
  }
}

// Mise à jour d'un projecteur (CRUD)
{
  type: "fixture_updated",
  data: { id: "uuid", name: "...", ...Fixture }
}

// Scène activée
{
  type: "scene_activated",
  data: { sceneId: "uuid" }
}

// Log du backend
{
  type: "log",
  data: { level: "info", message: "...", timestamp: "..." }
}

// État Dance mode (config + running + fixtures actives + pattern)
{
  type: "dance_state",
  data: { config, running, activeFixtureIds, currentPattern, phasesSent }
}

// Mise à jour d'une smart light (après setState / refresh / streaming toggle / effet)
{
  type: "smart_light_updated",
  data: { id, name, backend, config, streaming, zoneLayout, currentEffect, state, ...}
}
```

Pour consommer ces événements en JavaScript/TypeScript :

```typescript
const ws = new WebSocket('ws://localhost:5000/ws');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case 'universe_tick':
      console.log(`Canal 1: ${msg.data.values[0]}`);
      break;
    case 'fixture_updated':
      console.log(`Fixture mise à jour: ${msg.data.name}`);
      break;
  }
};
```

---

## Dépannage

### Le backend ne démarre pas (port déjà utilisé)

```bash
# Trouver le processus sur le port 5000
lsof -i :5000

# Le tuer
kill -9 <PID>
```

### Pas de signal DMX (projecteurs qui ne répondent pas)

1. **Vérifier que QLC+ tourne** et est configuré en passthrough Art-Net
2. **Vérifier la terminaison du bus DMX** : le dernier appareil du bus doit avoir une résistance de terminaison 120 Ω
3. **Vérifier l'adresse DMX** : assure-toi que l'adresse du projecteur dans LightBridgeDMX correspond à l'adresse configurée sur le projecteur physique
4. **Vérifier le câblage** : câbles XLR 3 ou 5 broches, masse blindée

```bash
# Vérifier qu'un seul processus utilise l'interface Enttec
lsof /dev/tty.usbserial-*
```

### HomeKit ne trouve pas le pont

1. Vérifie que `HOMEKIT_ENABLED=true` dans les variables d'environnement
2. Le pont HomeKit et l'iPhone/iPad doivent être sur le **même réseau Wi-Fi**
3. Vérifie qu'aucun pare-feu ne bloque les ports HAP (autour du port 51826)
4. Si le couplage échoue, supprime le dossier `.homekit/` et redémarre :

```bash
rm -rf backend/.homekit/
# Puis redémarrer le backend
```

### La bibliothèque QXF ne se télécharge pas

Le téléchargement nécessite une connexion Internet vers GitHub. En cas d'échec :

```bash
# Voir les erreurs dans les logs
tail -f logs/backend-dev.err.log

# Forcer via API
curl -X POST http://localhost:5000/api/qxf/library/refresh
```

### Le frontend affiche "Connexion perdue"

Le badge dans l'en-tête indique l'état du WebSocket. En cas de déconnexion :
1. Vérifie que le backend tourne sur le port 5000 : `lsof -i :5000`
2. Rafraîchis la page — le frontend se reconnecte automatiquement

### En HTTPS, la page reste vide et la console affiche "Mixed Content"

Symptôme : `Mixed Content: ... attempted to connect to the insecure WebSocket endpoint 'ws://...'` suivi de `SecurityError: Failed to construct 'WebSocket'`. L'exception fait échouer le provider de données et l'interface ne s'affiche pas.

Cause : l'URL du WebSocket est en `ws://` (ou vise le port 5000) alors que la page est servie en HTTPS. Un navigateur refuse toute connexion non chiffrée depuis une page chiffrée.

Correctif : `wsUrl()` dans `frontend/src/lib/api.ts` doit dériver l'URL de l'origine de la page — `wss` quand `location.protocol` vaut `https:`, et `location.host` (qui inclut le port) plutôt que `location.hostname`. Vérifie aussi qu'aucune variable `VITE_WS_URL` ne force une URL `ws://`.

### Performances DMX (jitter)

Si tu observes des scintillements ou un comportement instable :
- Utilise le mode **Art-Net → QLC+** plutôt que le mode Enttec direct
- Réduis le `DMX_FPS` à 25 ou moins
- Assure-toi que QLC+ est la seule application à accéder à l'interface USB

---

## Roadmap

Les fonctionnalités suivantes sont prévues :

- **Éditeur de scènes** : interface UI pour créer/modifier des scènes directement depuis le tableau de bord
- **Contrôles presets** : panneau UI pour gérer et appliquer les presets
- **Authentification** : auth basique pour sécuriser l'interface si exposée hors LAN
- **Multi-univers** : support de plusieurs univers DMX simultanément
- **Timeline / Chase** : séquences automatiques avec timing
- **DMX Input** : lecture de signaux DMX entrants pour enregistrer des scènes
- **Pan/Tilt fine** : support des canaux 16-bit (pan fine, tilt fine) pour les lyres haute résolution

---

## Scripts disponibles

Depuis la racine du projet :

| Commande | Description |
|----------|-------------|
| `pnpm dev` | Démarre tous les services en mode développement |
| `pnpm build` | Compile tous les packages pour la production |
| `pnpm lint` | Vérifie le code avec ESLint |
| `pnpm format` | Formate le code avec Prettier |
| `pnpm test` | Lance les tests (Vitest) |

Commandes spécifiques :

```bash
pnpm -C backend dev     # Backend seul
pnpm -C frontend dev    # Frontend seul
pnpm -C backend test    # Tests backend seuls
pnpm -C backend build   # Build backend (compile TypeScript → dist/)
```

---

## Licence

MIT
