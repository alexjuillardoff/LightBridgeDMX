# Architecture

## Vue d'ensemble
- Monorepo pnpm : backend Fastify/TypeScript + frontend React/Vite + package partagé de types/schemas.
- Backend écoute en **HTTP+WS sur 5000** (forcé), publie DMX en **Art-Net** vers QLC+ qui bridge vers l'interface DMX.
- Frontend dev sur **5173** (Vite) avec proxy `/api` et `/ws` vers le backend.
- État persisté en **SQLite via Prisma** (`backend/data/lightbridge.db`).
- 3 systèmes d'éclairage coexistent : **DMX** (Art-Net → QLC+ → Enttec), **HomeKit** (hap-nodejs, expose fixtures comme accessoires), **Smart Lights WiFi** (Nanoleaf via HTTP OpenAPI + UDP extControl streaming).

## Flux runtime (prod/dev)
1) Frontend appelle l'API REST (`/api/...`) et le WS (`/ws`) du backend.
2) Backend manipule l'état en mémoire (registry SmartLightService + tableau 512 canaux DMX) et diffuse en temps réel via WS (`universe_tick`, `fixture_updated`, `dance_state`, `smart_light_updated`).
3) Backend envoie le DMX en Art-Net (`DMX_OUTPUT=artnet`, `ARTNET_HOST=192.168.0.200`) → QLC+ → interface DMX.
4) Backend pilote les Nanoleaf via HTTP (coalesce 70 ms) ou UDP streaming (30 Hz, latence <15 ms) selon le toggle par lampe.
5) Si aucune interface DMX n'est disponible, le backend passe en simulation.

## Choix techniques (et pourquoi)

Cette section documente les décisions d'architecture structurantes et leur justification — le *pourquoi*, pas seulement le *quoi*.

### TypeScript partout
Tout le projet (backend, frontend, package partagé) est écrit en **TypeScript**, jamais en JavaScript brut.
- **Pourquoi :** les types attrapent une classe entière d'erreurs *au moment de l'écriture* (mauvais nom de champ, mauvais argument, cas oublié) plutôt qu'en production, en pleine session lumière. L'éditeur fournit autocomplétion, navigation et refactos sûres.
- **À noter :** les types sont un outil d'écriture, pas un runtime. Ils sont **effacés** à la transpilation — Node et le navigateur n'exécutent que du JavaScript pur, sans aucune trace des annotations. Le TS ne remplace donc pas les tests : il valide la *forme* des données, pas la *logique* métier (un mauvais calcul de canal DMX reste un bug même bien typé → couvert par Vitest).

### Backend en Node.js — un choix, pas une obligation
Le backend ne tourne pas dans un navigateur : il est exécuté par **Node.js**. Rien n'imposait Node ici — DMX et HomeKit existent aussi en Python, Go, Rust… Node a été choisi pour des raisons précises :
- **Un seul langage des deux côtés** → backend et frontend partagent littéralement les **mêmes types** via `packages/shared` (voir ci-dessous). Impossible si le backend était en Python : il faudrait redéfinir et resynchroniser les types de fixtures à la main.
- **Écosystème déjà là :** `hap-nodejs` (HomeKit natif sans Homebridge), `artnet`, `dmx-ts`, `bonjour-service` (mDNS), `@prisma/client`… tout existait en paquets Node.
- **Modèle événementiel/asynchrone** adapté au temps réel : trames DMX, mirror HomeKit, broadcast WebSocket continu.

### Frontend en JavaScript — là, c'est forcé
Le tableau de bord tourne **dans un navigateur**, qui n'exécute qu'un seul langage : **JavaScript**. Écrit en TS, il est donc transpilé en JS par Vite. C'est la seule moitié du projet où le JS est une contrainte et non un choix. (Pas de Node ici à l'exécution : c'est le navigateur qui exécute.)

### TS → JS : deux chaînes de transpilation
TypeScript n'est exécutable nulle part tel quel ; il faut le traduire en JavaScript.
- **Backend dev :** `ts-node-dev --transpile-only --respawn` transpile en mémoire à la volée et **redémarre** à chaque sauvegarde (⚠️ d'où la prudence sur les éditions rapides — voir `DEVELOPMENT.md`). Pas de fichiers `.js` écrits.
- **Backend build :** `tsc` compile et **vérifie** les types, écrit le JS dans `backend/dist/`.
- **Frontend :** Vite/esbuild transpile et bundle pour le navigateur.

### Monorepo pnpm + package `shared`
Les types et schémas Zod (`Fixture`, `Scene`, `UniverseState`, `WsEvent`…) vivent dans `packages/shared`, importés via l'alias `@lightbridgedmx/shared` par le backend **et** le frontend.
- **Pourquoi :** une **source unique de vérité** pour la forme des données. Changer la structure d'une fixture casse la compilation des deux côtés *immédiatement*, au lieu d'une découverte au runtime. Zod ajoute en prime la validation des entrées API à l'exécution, à partir des mêmes schémas.

### Modules : CJS backend, ESM frontend
Le backend compile en **CommonJS** (`require`), le frontend en **ESM** (`import` natif navigateur). C'est le format attendu par chaque environnement cible ; le `tsconfig` de chaque package fixe son `module` en conséquence.

## Arborescence et rôle des fichiers

### Racine
- `package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml` : scripts racine (`dev|build|lint|format|test`) et workspaces.
- `tsconfig.base.json` : options TypeScript communes (CJS, paths `@lightbridgedmx/shared`).
- `DEVELOPMENT.md` : référence technique exhaustive du projet.
- `README.md` : guide utilisateur (FR).
- `ARCHITECTURE.md` : ce document.
- `logs/` : sortie std/err des services launchd dev.

### Backend (`backend/`)
- `package.json` : scripts (`dev` via ts-node-dev, `build` via tsc), dépendances Fastify, ws, dmx-ts, hap-nodejs, @prisma/client, bonjour-service.
- `tsconfig.json` : compilation CJS vers `dist/`.
- `prisma/schema.prisma` : modèles SQLite — `Fixture`, `Scene`, `Preset`, `DanceConfig`, `SmartLight`, `UniverseSnapshot` (dernier état DMX persisté, 512 bytes par universe).
- `vitest.config.ts` : config tests (Vitest, projet `homekit-utils`).
- `src/index.ts` : point d'entrée Fastify. Init des services (DMX, HomeKit, Dance, SmartLights), wire WS, broadcasts. Port 5000 verrouillé.
- `src/websocket.ts` : gestionnaire WS broadcast (pas Socket.io, package `ws` natif).
- `src/state/store.ts` : couche Prisma — CRUD fixtures / scènes / presets / smart lights / dance config, sérialisation JSON pour champs complexes. `loadUniverseSnapshot()` / `saveUniverseSnapshot()` pour persister/restaurer les 512 canaux DMX en `Bytes`.
- `src/routes/` : enregistrement modulaire des endpoints
  - `fixtures.ts`, `scenes.ts`, `presets.ts`, `universe.ts`, `qxf.ts`, `homekit.ts`, `system.ts`, `dance.ts`
  - `smart-lights.ts` : CRUD + `/pair` + `/state` + `/streaming` + `/zones` + `/layout` + `/effect` + `/effects` + `/discover` + `/probe`
- `src/services/dmx.ts` : DmxService (Art-Net / Enttec / simulation), timer FPS configurable, événement `tick`. Méthode `restoreUniverse(values)` pour appliquer un snapshot persisté avant `start()`.
- `src/services/dance.ts` : DanceService — orchestration de strobes coordonnés par pièce avec patterns spatiaux.
- `src/services/homekit.ts` : pont HomeKit (hap-nodejs). Accessories `Lightbulb` RGB + lyres multi-services (`Lightbulb` dimmer/shutter + `WindowCovering` pan/tilt/color/gobo). Synchro bidirectionnelle via le tick DMX.
- `src/services/homekit-utils.ts` : conversions HSB↔RGB, résolution canaux RGB et moving head.
- `src/services/qxf.ts` + `qxf-library.ts` : parser XML QXF + bibliothèque QLC+ téléchargée de GitHub.
- `src/services/smart-lights/` : sous-package complet (voir section dédiée ci-dessous).

### Smart Lights (`backend/src/services/smart-lights/`)

Le **SmartLightService** est un registry de lampes WiFi avec deux paths de sortie, mirror DMX bidirectionnel et moteur d'effets position-aware.

| Fichier | Rôle |
|---------|------|
| `index.ts` | SmartLightService — registry + 3 timers (flush HTTP 30 ms / stream UDP 33 ms / refresh device 5 s) + DMX tick listener + dispatch effet/streaming/HTTP |
| `nanoleaf-client.ts` | Client HTTP OpenAPI Nanoleaf (port 16021) — pair, getInfo, setState (on/hue/sat/brightness/ct), listEffects, selectEffect, enableExtControl |
| `nanoleaf-streamer.ts` | Streamer UDP extControl v2 (port 60222) — frame `[panelCount:u16BE]([panelId:u16BE][R][G][B][W][transition×100ms:u16BE])×N`, keepalive 250 ms |
| `effect-engine.ts` | Pure function `evaluateEffect(config, layout, time) → RgbColor[]` — 5 effets (static / solid / gradient / chase / wave), spare zones forcées à noir |
| `discovery.ts` | Scan mDNS via `bonjour-service` (`_nanoleafapi._tcp`), retourne IP + port + nom + modèle |

**Priorité des paths de sortie** (dans `streamAll()` à 30 Hz) :
1. `currentEffect` set + streaming actif → EffectEngine évalue contre `zoneLayout`, push frame per-zone
2. `zonePalette` set (via `applyZones()`) sans effet → streamer push la palette telle quelle
3. Streaming actif sans effet ni palette → couleur uniforme depuis `desired.hue/sat/brightness`
4. Sinon → HTTP coalescé via `flushAll()` (rate-limit 1 push / 70 ms)

**Données persistées par smart light** (table SQLite `smart_lights`) :
- `config` (JSON discriminé par `type`) : host, port, token, deviceName
- `dmxMirror` (JSON) : `{ rChannel?, gChannel?, bChannel?, briChannel? }` pour lier aux canaux DMX
- `streaming` (JSON) : `{ enabled, zoneCount }` — toggle utilisateur + nombre de zones du strip
- `zoneLayout` (JSON) : `{ mode, segments[], spareZones[], sides[] }` — disposition 3D des LEDs
- `currentEffect` (JSON) : config d'effet active évaluée à chaque tick UDP

### Frontend (`frontend/`)

L'interface est un **pupitre grandMA2** : 4 vues (Live, Patch, Réseau, Setup), routing par hash URL,
barre de vues desktop/tablet + bottom nav iOS mobile. La vue Live n'est pas une page qui défile mais un
**plan de travail** de fenêtres déplaçables.

- `package.json` : scripts Vite (`dev`, `build`, `preview`), deps React 18 + React Query + qrcode.react + three / @react-three/fiber v8 / @react-three/drei v9 + **lucide-react** (icônes).
- `vite.config.ts` : proxy API/WS vers `http://localhost:5000`, serveur dev `host: true`, port 5173.
- `src/main.tsx` : bootstrap React/Vite + QueryClient.
- `src/App.tsx` : empile les providers dans l'ordre imposé par leurs dépendances — `AppData` → `Selection` → `Console` → `Command` → `AppShell`.
- `src/shell/` : châssis du pupitre
  - `AppShell.tsx` — `StatusBar` + `TabBar` + vue active (lazy `LivePage`) + `KeypadRail` + `CommandLine` + `BottomNav` ; met à jour `document.title` selon la vue
  - `StatusBar.tsx` — barre d'état haute (univers, sortie DMX, canaux actifs, projecteurs, sélection, LED Link/HomeKit, horloge, Blackout)
  - `TabBar.tsx` — barre de vues numérotées desktop/tablet (cachée <640px), icônes lucide
  - `BottomNav.tsx` — bottom nav iOS-style mobile (cachée ≥640px), `safe-area-inset-bottom`
  - `KeypadRail.tsx` — rail de touches ≥1280px : Fixture/Group/All, Thru/+/At, pavé numérique, **Store/Go/Off**, Please, B.O., raccourcis de vues, compteurs des pools
  - `CommandLine.tsx` — ligne de commande turquoise (ligne de retour + saisie + touches rapides)
  - `tabs.ts` — source unique des 4 `TabDef` + `resolveTabId()` qui traduit les anciens hashs (`#dashboard`, `#projecteurs`, `#lampes`, `#appareils`, `#reglages`) vers les vues actuelles
  - `useHashTab.ts` — routing hash URL (`useState` + `hashchange` listener), fallback `#live`
  - `navigate.ts` — `setActiveTabHash(id)` pour liens internes et commande `GOTO`
- `src/contexts/` : state partagé entre vues
  - `AppDataContext.tsx` — provider central (queries, mutations, WS handlers, wsBadge, logMessage, logHistory, handleBlackout). Value mémoïzée pour absorber les ticks 30 Hz sans re-render des consommateurs.
  - `SelectionContext.tsx` — le *programmer* : sélection de projecteurs, conservée d'une vue à l'autre. **Refuse les projecteurs verrouillés** (`lib/fixtureGuard`), donc sheet / `ALL` / groupes / encodeurs / ligne de commande héritent du garde-fou sans le réimplémenter.
  - `ConsoleContext.tsx` — les pools du pupitre : groupes, executors, playbacks, presets. STORE (capture → `POST /api/scenes`), GO (`/activate`), OFF, faders master. Persistance partagée : scènes et presets côté backend, groupes / slots / disposition en `localStorage`.
  - `CommandContext.tsx` — saisie et exécution de la ligne de commande, partagée par la barre du bas, le rail de touches et les tuiles des pools (via `report`).
  - `UniverseStateContext.tsx` — expose **deux** accès : `useUniverseState()` (valeur qui change à chaque tick 30 Hz — pour les faders et cellules de sheet uniquement) et `useUniverseValuesRef()` (ref stable, **aucun** re-render — pour lire l'univers dans un handler, ex. STORE).
- `src/pages/` : une page par vue
  - `LivePage.tsx` (lazy via React.lazy) — rend `Workspace`
  - `PatchPage.tsx` — `FixturesTable` (en premier) + `FixtureForm` + `QxfLibraryPanel`
  - `NetworkPage.tsx` — volets *Inventaire* (`DeviceInventory`) et *Lampes* (pastilles de backend + `SmartLightsPanel`)
  - `SetupPage.tsx` — `HomeKitCard` + `MerossCard` + cartes Système / Variables backend / Maintenance
- `src/components/console/` : le pupitre proprement dit
  - `Workspace.tsx` — gestionnaire de fenêtres : Views rappelables, ajout/fermeture, ordre d'empilement, Reset, persistance `localStorage`. Sous 1024 px, les fenêtres sont empilées en cartes.
  - `ConsoleWindow.tsx` — cadre de fenêtre : glisser la barre de titre déplace, glisser le coin bas-droit redimensionne (Pointer Events, accrochage grille, géométrie locale pendant le geste)
  - `windows/registry.tsx` — `WindowKind` → composant de contenu. **Seul endroit à toucher** pour ajouter une fenêtre.
  - `windows/` — `ExecutorsWindow` (Store/Go/Off/libérer), `PlaybacksWindow` (faders master), `GroupsWindow`, `PresetsWindow`, `LogWindow`
- `src/lib/console/` :
  - `layout.ts` — modèle de disposition : grille 24 colonnes × rangées de 30 px, bornes, 4 Views d'origine (Programmer / Playback / DMX / Effets), libellés des fenêtres
  - `scenes.ts` — `captureScene()` (STORE) et `applySceneAtLevel()` (rappel à niveau). Un master **n'atténue que** `intensity/r/g/b/w/uv` : pan, tilt, gobo et roue de couleurs sont rejoués tels quels, sinon baisser un playback ferait dériver la lyre à mi-course.
- `src/lib/api.ts` : client REST (fetch JSON) + `wsUrl()` + namespaces `fixtures` / `scenes` / `presets` / `universe` / `qxf` / `homekit` / `devices` / `meross` / `system` / `rooms` / `dance` / `smartLights`. `wsUrl()` suit **l'origine de la page** (`wss://` si la page est en HTTPS, `host` avec son port) et passe donc par le même proxy `/ws` que les appels `/api` — indispensable derrière un reverse proxy TLS, cf. [Exposition réseau](#exposition-réseau-reverse-proxy).
- `src/lib/fixtureGuard.ts` : projecteurs **verrouillés** (chambre) — liste blanche par pièce / nom / id. Visibles mais non sélectionnables, exclus des scènes à l'enregistrement comme au rappel. À distinguer de `hiddenFixtures.ts`, filtre purement cosmétique.
- `src/lib/commandLine.ts` : parser pur texte → `ParsedCommand`. Verbes `FIX`/`CH`/`AT`/`FULL`/`OUT`/`ALL`/`CLEAR`/`BLACKOUT`/`GOTO` + `STORE`/`GO`/`OFF`/`GROUP`/`PRESET`.
- `src/lib/programmer.ts` : traduction attribut ↔ canaux DMX absolus (groupes d'encodeurs, lecture HTP, écriture sur la sélection).
- `src/lib/localStore.ts`, `feedback.ts`, `fixtures.ts`, `fixtureTemplates.ts`, `math.ts` : helpers UI.
- `src/hooks/useDmxWebsocket.ts` : hook WS — écoute `universe_tick`, `fixture_updated`, `smart_light_updated`, `scene_activated`, `log` ; expose `logHistory: LogEntry[]` (rolling 10).
- `src/hooks/useMediaQuery.ts` : suit une media query — bascule plan de travail / pile mobile sans dupliquer le point de rupture entre la CSS et le JS.
- `src/components/` :
  - `FixtureSheet.tsx` (cellules groupées par pièce, sélection, cadenas des verrouillés), `EncoderBar.tsx` (groupes d'attributs, molettes, valeurs rapides), `ChannelGrid.tsx` (fader view 32 canaux/page), `UniverseMonitor.tsx` (DMX sheet 512 canaux)
  - `ma/MaFader.tsx`, `ma/MaKnob.tsx` : fader et molette maison aux Pointer Events (pas d'`<input type="range">` : rendu identique partout)
  - `FixtureForm.tsx`, `FixturesTable.tsx` (avec `data-label` pour stacked cards mobile), `QxfLibraryPanel.tsx`, `HomeKitCard.tsx`, `MerossCard.tsx`, `DancePanel.tsx`, `DeviceInventory.tsx`
  - `SmartLightsPanel.tsx` : accepte `backendFilter` + `hideSectionTitle` (PairCard + cartes par lampe + onglets Painter/Effets/Layout 3D)
  - `smart-lights/backendRegistry.ts` : registre des backends UI (Nanoleaf aujourd'hui, Hue/Matter futur — ajouter une entrée suffit)
  - `smart-lights/ZonePainter.tsx` : 50 swatches paintable click+drag, brush color + spare, presets, fill all
  - `smart-lights/EffectDesigner.tsx` : onglets solid/gradient/chase/wave + sliders live (chaque changement = PUT effet)
  - `smart-lights/LayoutEditor3D.tsx` : éditeur 3D React Three Fiber (sphères draggables, OrbitControls, modes linked/unlinked, preset U-shape, hide spare)
- `src/styles.css` : feuille unique sans framework — thème pupitre (fond noir, liseré ambre `--edge`, barres de titre bleues, ligne de commande turquoise, zéro arrondi), fenêtres du plan de travail, pools, breakpoints `<640px` / `640-1023px` / `≥1024px` (plan de travail) / `≥1280px` (rail), `.channels` adaptatif (16 → 12 → 8 → 4 colonnes), `.table` en cartes empilées sur mobile.

### Shared (`packages/shared/`)
- `src/index.ts` : types et schémas Zod partagés. Sections :
  - DMX : `Capability`, `FixtureChannel`, `FixtureHomeKit*`, `Fixture`, `Scene`, `SceneStep`, `Preset`, `UniverseState`, `LogEvent`, `WsEvent`
  - Dance : `DanceLyrePosition`, `DanceLyreMode`, `DanceConfig`, `DanceState`, `DancePatternId`
  - Smart Lights : `SmartLightBackendType`, `NanoleafHttpConfig`, `SmartLightDmxMirror`, `SmartLightStreaming`, `SmartLightStateInput`, `SmartLightZonePalette`, `NanoleafDiscovered`
  - 3D Layout : `Point3D`, `ZoneSegment`, `SmartLightZoneLayout` (avec `spareZones[]` et `sides[]`)
  - Effets : `RgbColor`, `EffectStatic/Solid/Gradient/Chase/Wave`, `SmartLightEffectConfig`
  - Smart Light agrégé : `SmartLight`, `SmartLightInput`, `SmartLightPairInput`
  - Helpers pure : `buildLinearLayout(zoneCount)`, `buildUShapeLayout(opts)` — réutilisés frontend + backend
- `dist/index.js` + `dist/index.d.ts` : build CJS du package partagé.

## Ops / services persistants (macOS)
- LaunchAgents :
  - `~/Library/LaunchAgents/com.lightbridgedmx.backend.dev.plist` → `pnpm -C backend dev` avec `DMX_OUTPUT=artnet ARTNET_HOST=<ip-qlc>  ARTNET_UNIVERSE=0 DMX_FPS=30 DATABASE_URL=file:<chemin-absolu-du-repo>/backend/data/lightbridge.db`.
  - `~/Library/LaunchAgents/com.lightbridgedmx.frontend.dev.plist` → `pnpm -C frontend dev`.
- Logs : `logs/backend-dev.{out,err}.log`, `logs/frontend-dev.{out,err}.log`.
- Commandes utiles : `launchctl kickstart -k gui/501/com.lightbridgedmx.backend.dev`, `launchctl bootout gui/501 ~/Library/LaunchAgents/com.lightbridgedmx.backend.dev.plist` (idem frontend), `lsof -i :5000|:5173` pour vérifier l'écoute.

## Exposition réseau (reverse proxy)

Le tableau de bord est joignable sous un nom de domaine en plus de `192.168.0.200:5173`, via un **reverse proxy Caddy** installé sur la même machine. Sa configuration vit **hors du dépôt**, dans `/usr/local/etc/Caddyfile` (service launchd `homebrew.mxcl.caddy`, logs `/usr/local/var/log/caddy.log`).

```
Navigateur ──HTTPS/WSS──► Caddy (:443) ──HTTP/WS──► Vite (:5173) ──proxy──► Fastify (:5000)
```

Trois points de conception :

1. **Un seul upstream.** Caddy vise uniquement `:5173` ; c'est le dev server Vite qui proxie déjà `/api` et `/ws` vers Fastify. Le WebSocket traverse donc deux proxys, ce qui fonctionne (`ws: true` côté Vite, relais d'upgrade natif côté Caddy).
2. **Réécriture du `Host`.** Vite ≥ 5.4.12 renvoie 403 sur tout `Host` absent de `server.allowedHosts`. Le proxy présente donc à Vite son propre `IP:port` (`header_up Host {upstream_hostport}`) — une IP littérale est toujours acceptée. Le nom réel reste lisible dans `X-Forwarded-Host`.
3. **Restriction au réseau local.** Un matcher `remote_ip` limite l'accès aux sources privées et renvoie sinon une page 403. La règle porte sur les **plages privées**, pas sur l'IP publique de la box : en hairpin NAT, les clients du LAN arrivent avec l'IP de la box (`192.168.0.254`), pas avec l'IP publique. Le chemin `/.well-known/acme-challenge/*` est exempté, sans quoi le renouvellement Let's Encrypt échouerait.

Conséquence côté frontend : `wsUrl()` doit suivre l'origine de la page. Une URL en dur du type `ws://<host>:5000` casse l'accès HTTPS (blocage Mixed Content, et le port 5000 n'est pas exposé par le proxy).

## Schéma de flux complet

```
┌─────────────────────────────────────────────────────────────────────┐
│                       FRONTEND (React 18 + Vite)                     │
│  App.tsx → React Query → api.ts → fetch /api/*                      │
│  useDmxWebsocket → {ws,wss}://<origine de la page>/ws               │
│  ChannelGrid (sliders DMX) → POST /api/universe/:channel            │
│  SmartLightsPanel → POST /api/smart-lights/:id/{state,effect,zones} │
│  LayoutEditor3D (lazy R3F) → POST /api/smart-lights/:id/layout      │
└───────────┬─────────────────────────────────────────────────────────┘
            │ HTTP REST + WebSocket
┌───────────▼─────────────────────────────────────────────────────────┐
│                         BACKEND (Fastify)                            │
│  routes/ → store.ts (SQLite via Prisma)                             │
│                                                                      │
│  DmxService  →  Universe[512]  →  push @ N FPS  →  "tick" emit     │
│  HomeKitBridge ↔ hap-nodejs ↔ Apple Home app (mirror via tick)      │
│  DanceService → scheduler → grouped DMX writes                       │
│  SmartLightService :                                                 │
│    • DMX-tick listener (mirror R/G/B chans → desired)               │
│    • flushAll  @ 30 ms → HTTP PUT /state (coalesce + rate-limit)    │
│    • streamAll @ 33 ms → UDP extControl frame per zone              │
│    • refreshAll @ 5 s if quiescent → GET device state               │
│    • EffectEngine.evaluate(effect, layout, time) → RgbColor[50]     │
│  WebSocket → broadcast universe_tick / smart_light_updated / …      │
└──┬──────────────────────────────────────────────┬──────────────────┘
   │ Art-Net UDP:6454                              │ HTTP :16021 + UDP :60222
┌──▼─────────────────┐                  ┌──────────▼──────────────────┐
│  QLC+ (externe)    │                  │  Nanoleaf NL72K3 Lightstrip  │
│  Passthrough →     │                  │  Essentials — 50 zones,      │
│  Enttec USB → DMX  │                  │  192.168.0.234, fw 4.0.11    │
└──┬─────────────────┘                  └──────────────────────────────┘
   │ DMX512                                              ▲
┌──▼──────────────────────┐                              │ HAP
│  Projecteurs DMX        │                  ┌───────────┴──────────┐
│  PAR LED RGB, lyres…    │                  │  Apple Home app      │
└─────────────────────────┘                  └──────────────────────┘
```
