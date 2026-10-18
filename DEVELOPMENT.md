# DEVELOPMENT.md — LightBridgeDMX

Référence technique du projet : architecture, conventions et décisions de conception.

---

## Vue d'ensemble du projet

**LightBridgeDMX** est un hub d'éclairage qui unifie trois mondes :
1. **DMX512** scénique (Art-Net → QLC+ → Enttec USB)
2. **Apple HomeKit** (expose les fixtures DMX comme accessoires natifs via `hap-nodejs`)
3. **Smart Lights WiFi** (Nanoleaf et au-delà — pilotage HTTP + UDP streaming, effets position-aware en 3D, mirror DMX bidirectionnel)

Il fournit un tableau de bord React qui monitore et contrôle l'univers DMX en temps réel, peint chaque zone d'une LED strip à la souris, édite la position 3D des zones et lance des effets dynamiques (chase / wave / gradient).

**Stack :**
- Backend : Fastify 4 + TypeScript (Node 18+), port **5000** (verrouillé)
- Frontend : React 18 + Vite + React Query, port **5173** (proxy vers :5000)
- Shared : package `@lightbridgedmx/shared` (types Zod partagés)
- Base de données : SQLite via Prisma ORM (`backend/prisma/schema.prisma`, DB dans `backend/data/lightbridge.db`)
- 3D editor : `three` + `@react-three/fiber` v8 + `@react-three/drei` v9 (lazy-loaded)
- mDNS discovery : `bonjour-service` (pour scanner les Nanoleaf sur le LAN)
- Monorepo : pnpm workspaces

**Chemin racine :** racine du repo cloné (`LightBridgeDMX/`).

---

## Structure du monorepo

```
LightBridgeDMX/
├── DEVELOPMENT.md                     ← ce fichier
├── README.md                          ← guide utilisateur (FR)
├── ARCHITECTURE.md                    ← vue d'ensemble architecture
├── package.json                       ← scripts racine (dev/build/lint/format/test)
├── pnpm-workspace.yaml                ← définition des workspaces pnpm
├── tsconfig.base.json                 ← config TypeScript commune (CJS, paths alias)
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts                   ← entrée Fastify (init, routes, WS, DMX, HomeKit)
│   │   ├── websocket.ts               ← gestionnaire WebSocket (broadcast universe_tick)
│   │   ├── state/
│   │   │   └── store.ts               ← store SQLite/Prisma (fixtures, scenes, presets)
│   │   ├── services/
│   │   │   ├── dmx.ts                 ← service DMX (Art-Net, Enttec USB, simulation)
│   │   │   ├── homekit.ts             ← pont HomeKit (hap-nodejs, Lightbulb + WindowCovering)
│   │   │   ├── homekit-utils.ts       ← utilitaires (HSB↔RGB, résolution canaux RGB + moving head)
│   │   │   ├── homekit-utils.spec.ts  ← tests Vitest
│   │   │   ├── qxf.ts                 ← parser XML QXF (définitions projecteurs QLC+)
│   │   │   ├── qxf-library.ts         ← gestionnaire bibliothèque QXF (téléchargement GitHub)
│   │   │   └── smart-lights/          ← service Smart Lights (Nanoleaf et au-delà)
│   │   │       ├── index.ts           ← SmartLightService (registry, HTTP coalesce + UDP stream, refresh)
│   │   │       ├── nanoleaf-client.ts ← client HTTP OpenAPI Nanoleaf (pair, setState, effects, CT)
│   │   │       ├── nanoleaf-streamer.ts ← streamer UDP extControl v2 (port 60222, keepalive 4 Hz)
│   │   │       ├── effect-engine.ts   ← evaluator pure : 5 effets simples + moteur paramétrique "ma"
│   │   │       └── discovery.ts       ← scan mDNS via bonjour-service (_nanoleafapi._tcp)
│   │   └── routes/
│   │       ├── index.ts               ← enregistrement des routes
│   │       ├── types.ts               ← types contexte routes
│   │       ├── errors.ts              ← gestionnaire d'erreurs HTTP
│   │       ├── helpers.ts             ← createFixtureAndSync()
│   │       ├── fixtures.ts            ← CRUD /api/fixtures
│   │       ├── system.ts              ← /api/health, /ws
│   │       ├── homekit.ts             ← GET /api/homekit
│   │       ├── qxf.ts                 ← /api/qxf/library + refresh + import
│   │       ├── scenes.ts              ← CRUD /api/scenes + activate
│   │       ├── presets.ts             ← CRUD /api/presets + apply
│   │       ├── universe.ts            ← POST /api/universe/:channel, test fixture
│   │       └── smart-lights.ts        ← /api/smart-lights (CRUD, pair, state, streaming, effect, layout, discover)
│   └── .homekit/                      ← stockage HAP (pairage, identifiants)
├── frontend/                          ← interface en reconstruction (socle seul)
│   ├── package.json
│   ├── vite.config.ts                 ← proxy /api et /ws vers :5000
│   ├── index.html
│   └── src/
│       ├── main.tsx                   ← bootstrap React
│       └── App.tsx                    ← page d'attente
└── packages/
    └── shared/
        └── src/
            └── index.ts               ← tous les schémas Zod + types TypeScript partagés
```

---
## Architecture UI (frontend)

> 🚧 **Interface en reconstruction.** L'ancienne UI (pupitre grandMA2, ~15 000 lignes) a été supprimée
> le 2026-10-18 ; sa dernière version est au commit `24c1176`. `frontend/` ne contient plus que le socle :
> `vite.config.ts` (port 5173, proxy `/api` + `/ws`, alias vers la source de `shared`), `index.html`,
> `src/main.tsx` et une page d'attente `src/App.tsx`.

### Leçons de l'ancienne UI à reporter dans la nouvelle

Ces règles ne tiennent pas au look de l'ancienne interface mais au matériel et au backend :

- **Projecteurs de la chambre verrouillés** — l'ancienne garde (`lib/fixtureGuard.ts`) vivait **côté
  frontend** : liste blanche par pièce `chambre`, nom `/\bchambre\b/i` ou id ; visibles mais non
  sélectionnables, exclus des scènes à l'enregistrement comme au rappel. La nouvelle UI doit la
  réimplémenter avant de pouvoir piloter quoi que ce soit — ou mieux, la porter dans le backend.
- **Un master n'atténue que** `intensity/r/g/b/w/uv` : pan, tilt, gobo et roue de couleurs sont rejoués
  tels quels, sinon baisser un playback fait dériver la lyre à mi-course.
- **Regrouper les écritures DMX** (un envoi par `requestAnimationFrame`) : un POST par mouvement de
  fader sur une scène contenant le bandeau (150 canaux) sature le navigateur.
- **Isoler l'univers DMX** (ticks WebSocket à 30 Hz) du reste de l'état, pour ne pas re-rendre toute
  l'application à chaque tick.
- **URL WebSocket dérivée de l'origine de la page** (`wss://` en HTTPS, `location.host` avec le port),
  jamais codée en dur — indispensable derrière Caddy, cf. [Exposition réseau](#exposition-réseau-reverse-proxy).

## État applicatif

L'état est persisté dans **SQLite via Prisma**. Il est géré par `backend/src/state/store.ts` (toutes les méthodes sont async). Le fichier de base de données se trouve dans `backend/data/lightbridge.db`.

### Entités

| Entité | Clé | Description |
|--------|-----|-------------|
| `fixtures` | UUID | Projecteurs DMX (adresse 1–512, canaux, profil QXF, config HomeKit, pièce) |
| `scenes` | UUID | Scènes (liste d'étapes fixture → valeurs) |
| `presets` | UUID | Presets (mapping canal → valeur) |
| `smart_lights` | UUID | Lampes WiFi (Nanoleaf etc.) — backend, config, mirror DMX, layout 3D, effet courant |
| `meross_config` | singleton | Config de la prise Meross (enabled, host, key, channel) — pilotage local LAN |
| `universe_snapshots` | universe (int) | Dernier état persisté des 512 canaux DMX (Bytes), restauré au démarrage |

### Univers DMX
- Tableau de 512 valeurs `uint8` (0–255)
- Géré par `DmxService` dans `backend/src/services/dmx.ts`
- Émis en boucle à N FPS (défaut 30) via Art-Net ou Enttec
- **Persistance** : snapshot SQLite mis à jour au maximum 1×/sec, uniquement quand les valeurs changent (debounce dans `index.ts` → `scheduleUniverseSnapshot`). Au démarrage : `Store.loadUniverseSnapshot()` est appelé **avant** `dmx.start()` puis appliqué via `DmxService.restoreUniverse()` → la première frame Art-Net porte déjà les valeurs restaurées. Un snapshot final est aussi pris dans `onClose` (SIGINT/SIGTERM).

---

## Schémas Zod partagés (`packages/shared/src/index.ts`)

```typescript
// Capabilities DMX
type Capability = "intensity" | "r" | "g" | "b" | "w" | "uv" | "strobe"
  | "colorTemp" | "color" | "pan" | "tilt" | "gobo" | "beam"
  | "effect" | "speed" | "prism" | "focus" | "maintenance" | "other"

// Canal d'un projecteur
interface FixtureChannel { channel: 1–512; capability: Capability; name?: string }

// Overrides canaux HomeKit pour lyres (relatifs à l'adresse fixture)
interface FixtureHomeKitMovingHeadChannels {
  dimmerChannel?: number; shutterChannel?: number;
  panChannel?: number; tiltChannel?: number;
  colorChannel?: number; goboChannel?: number;
}

// Config HomeKit d'un projecteur
interface FixtureHomeKit {
  enabled?: boolean; name?: string; deviceId?: string;
  dmxChannels?: { r: number; g: number; b: number }    // override RGB (fixtures couleur)
  movingHeadChannels?: FixtureHomeKitMovingHeadChannels // override canaux lyre
}

// Projecteur complet
interface Fixture {
  id: string (UUID); name: string; address: 1–512; universe: number;
  channels: FixtureChannel[]; createdAt: string (ISO);
  profile?: { source: "qxf"; manufacturer: string; model: string; mode: string }
  homekit?: FixtureHomeKit
}

// Scène
interface Scene { id: string; name: string; steps: { fixtureId: string; values: number[] }[] }

// Preset
interface Preset { id: string; name: string; payload: Record<string, 0–255> }

// État univers (envoyé via WebSocket)
interface UniverseState { fps: number; universe: number; values: number[512]; timestamp: string }

// Événements WebSocket (union discriminée par type)
type WsEvent =
  | { type: "universe_tick"; data: UniverseState }
  | { type: "fixture_updated"; data: Fixture }
  | { type: "scene_activated"; data: { sceneId: string } }
  | { type: "log"; data: { level: "info"|"warn"|"error"; message: string; timestamp: string } }
  | { type: "smart_light_updated"; data: SmartLight }

// ─── Smart Lights ──────────────────────────────────────────────────

type SmartLightBackendType = "nanoleaf-http" // extensible (Matter, hap-controller, Hue…)

interface NanoleafHttpConfig {
  type: "nanoleaf-http";
  host: string;     // ex: "192.168.0.234"
  port?: number;    // défaut 16021
  token?: string;   // auth_token retourné par POST /api/v1/new
  deviceName?: string;
}

// Mirror DMX : lier des canaux DMX à la lampe pour la piloter via scènes / sliders
interface SmartLightDmxMirror {
  universe?: number;
  rChannel?: number; gChannel?: number; bChannel?: number;
  briChannel?: number;
  zones?: SmartLightDmxZoneMirror;  // mirror par zone (le strip devient un projecteur multi-cellules)
}

// Mirror DMX par zone : bloc de canaux consécutifs, 3 canaux (R, G, B) par zone,
// plus un canal de dimmer master optionnel placé APRÈS les zones.
// zone i → startChannel + 3i (R), +1 (G), +2 (B). Passe par le streaming UDP.
interface SmartLightDmxZoneMirror {
  universe?: number;
  startChannel: number;  // 1–512
  zoneCount: number;     // 1–170 (170 × 3 = 510 canaux)
  dimmerChannel?: number; // canal absolu du master — multiplie les couleurs de zone
  fixtureId?: string;    // le projecteur DMX généré pour ce bloc
}

// Streaming UDP extControl (~5–15 ms latence vs ~100 ms HTTP)
interface SmartLightStreaming {
  enabled?: boolean;
  zoneCount?: number; // découvert ou config (NL72K3 = 50)
}

// État runtime (rafraîchi périodiquement depuis le device)
interface SmartLightState {
  on: boolean;
  hue: number;        // 0–360
  sat: number;        // 0–100
  brightness: number; // 0–100
  ct?: number;        // Kelvin (NL72K3 ≈ 2127–6535)
  colorMode?: "hs" | "ct" | "effect";
  currentEffect?: string;  // nom de l'effet builtin Nanoleaf en cours
  reachable?: boolean;
}

// ─── Layout 3D et Effets position-aware ─────────────────────────────

interface Point3D { x: number; y: number; z: number }
interface ZoneSegment { start: Point3D; end: Point3D }

// Placement physique de chaque zone LED dans l'espace 3D
interface SmartLightZoneLayout {
  mode?: "linked" | "unlinked";  // "linked" = polyline (zones se touchent)
  segments: ZoneSegment[];        // 1 par zone (NL72K3 = 50)
}

interface RgbColor { r: 0–255; g: 0–255; b: 0–255 }

// Effets — discriminés par `kind`, évalués par l'EffectEngine à 30 Hz
type SmartLightEffectConfig =
  | { kind: "static"; palette: RgbColor[]; brightness?: 0–100 }
  | { kind: "solid"; color: RgbColor; brightness?: 0–100 }
  | { kind: "gradient"; from: RgbColor; to: RgbColor; direction?: Point3D; scrollSpeed?: number; brightness?: 0–100 }
  | { kind: "chase"; color: RgbColor; bgColor?: RgbColor; speed: number; width: number; bounce?: boolean; brightness?: 0–100 }
  | { kind: "wave"; from: RgbColor; to: RgbColor; direction?: Point3D; wavelength: number; speed: number; brightness?: 0–100 }
  // Moteur paramétrique façon grandMA2 : une forme d'onde + une phase répartie sur les zones.
  | { kind: "ma";
      form: "sin"|"cos"|"rampUp"|"rampDown"|"triangle"|"pwm"|"random";
      target: "dimmer"|"color"|"hue";
      speed: number;                        // BPM — 60 BPM = 1 cycle/s
      direction?: "forward"|"backward";
      low: 0–100; high: 0–100;              // valeurs basse et haute, comme sur le pupitre
      phaseFrom: number; phaseTo: number;   // retard en degrés de la 1re et de la dernière zone
      width: 1–100;                         // % du cycle en position haute (pwm / random)
      attack?: 0–100; decay?: 0–100;        // adoucissement des fronts durs
      matricks?: { blocks?: number; groups?: number; wings?: number };
      spatial?: { mode: "axis"|"radial"|"angular"; direction?: Point3D; origin?: Point3D };
      sides?: string[];                     // ne jouer que sur ces sections du layout
      color?, bgColor?, colorTo?: RgbColor; hueFrom?, hueTo?, saturation?: number;
      seed?: number; brightness?: 0–100 }

// Smart light complète
interface SmartLight {
  id: string (UUID); name: string; room?: string;
  backend: SmartLightBackendType;
  config: NanoleafHttpConfig;  // discriminé par config.type
  dmxMirror?: SmartLightDmxMirror | null;
  streaming?: SmartLightStreaming;
  zoneLayout?: SmartLightZoneLayout | null;
  currentEffect?: SmartLightEffectConfig | null;
  state?: SmartLightState;
  createdAt: string (ISO);
}
```

---

## API REST complète

### Fixtures

| Méthode | Endpoint | Corps | Description |
|---------|----------|-------|-------------|
| `GET` | `/api/fixtures` | — | Liste tous les projecteurs |
| `POST` | `/api/fixtures` | `FixtureInput` | Crée un projecteur (valide overlap) |
| `PUT` | `/api/fixtures/:id` | `Partial<FixtureInput>` | Modifie un projecteur (`room: null` retire la pièce) |
| `POST` | `/api/fixtures/repatch` | `{ moves: { id, address, universe? }[] }` | Repatch groupé : valide la disposition **finale** puis écrit en transaction |

> **Repatch et lampes connectées.** Le miroir DMX uniforme d'une lampe (`rChannel`, `gChannel`…) mémorise
> des canaux **absolus**, sans lien vers le projecteur qui les occupe : repatcher la façade DMX d'une
> Nanoleaf la laissait muette, le miroir écoutant des canaux que plus personne ne pilote.
> `realignSmartLightMirrors()` (`routes/helpers.ts`) décale du même delta les canaux du miroir tombant
> dans l'ancienne empreinte du projecteur, sur `PUT /:id` comme sur `/repatch`. Le miroir par zone, lui,
> porte déjà `fixtureId` : on suit ce lien plutôt que les canaux.
| `DELETE` | `/api/fixtures/:id` | — | Supprime un projecteur |
| `POST` | `/api/fixtures/import/qxf-library` | `{ path, mode?, address, universe, name? }` | Importe depuis la librairie QXF |

### Scènes

| Méthode | Endpoint | Corps | Description |
|---------|----------|-------|-------------|
| `GET` | `/api/scenes` | — | Liste les scènes |
| `POST` | `/api/scenes` | `SceneInput` | Crée une scène |
| `POST` | `/api/scenes/:id/activate` | — | Active la scène (applique les valeurs DMX) |

### Presets

| Méthode | Endpoint | Corps | Description |
|---------|----------|-------|-------------|
| `GET` | `/api/presets` | — | Liste les presets |
| `POST` | `/api/presets` | `PresetInput` | Crée un preset |
| `POST` | `/api/presets/:id/apply` | — | Applique le preset sur l'univers DMX |

### Univers DMX

| Méthode | Endpoint | Corps | Description |
|---------|----------|-------|-------------|
| `POST` | `/api/universe` | `{ values: { "<canal>": 0–255 } }` | **Écriture groupée** : plusieurs canaux en une requête. Utilisée par la console pendant un glissement de fader — un POST par événement de mouvement saturait les ~6 connexions du navigateur et la position finale arrivait en dernier. Max 512 entrées |
| `POST` | `/api/universe/:channel` | `{ value: 0–255 }` | Définit la valeur d'un canal |
| `POST` | `/api/test/fixtures/:id` | `{ values: number[] }` | Teste un projecteur avec les valeurs données |

### Bibliothèque QXF

| Méthode | Endpoint | Corps | Description |
|---------|----------|-------|-------------|
| `GET` | `/api/qxf/library` | — | Liste les fichiers QXF disponibles (télécharge si absent) |
| `POST` | `/api/qxf/library/refresh` | — | Force le re-téléchargement depuis GitHub |

### Smart Lights (Nanoleaf et autres lampes WiFi)

| Méthode | Endpoint | Corps | Description |
|---------|----------|-------|-------------|
| `GET` | `/api/smart-lights` | — | Liste toutes les smart lights avec leur état runtime |
| `GET` | `/api/smart-lights/:id` | — | Une smart light avec état |
| `POST` | `/api/smart-lights` | `SmartLightInput` | Crée une smart light (rarement utilisé en direct, voir `/pair`) |
| `PUT` | `/api/smart-lights/:id` | `Partial<SmartLightInput>` | Met à jour (rename, mirror DMX, etc.) |
| `DELETE` | `/api/smart-lights/:id` | — | Supprime |
| `POST` | `/api/smart-lights/pair` | `{ host, port?, name?, room? }` | Pair un Nanoleaf (le strip doit être en mode pairing) — 201 si OK, 409 si pas en pairing |
| `POST` | `/api/smart-lights/:id/pair` | — | Re-pair un Nanoleaf existant (renouvelle le token) |
| `POST` | `/api/smart-lights/:id/state` | `SmartLightStateInput` | Changement d'état (on/off/hue/sat/brightness/ct/rgb) — coalesce et flush async |
| `POST` | `/api/smart-lights/:id/streaming` | `{ enabled, zoneCount? }` | Active/désactive le streaming UDP extControl (force `on` + luminosité device à 100 % avant d'entrer en extControl) |
| `POST` | `/api/smart-lights/:id/zones` | `{ zones: [{index,r,g,b,w?}] }` | Push direct un palette par-zone (active le streaming automatiquement si besoin) |
| `POST` | `/api/smart-lights/:id/dmx-fixture` | `{ zoneCount?, startChannel?, universe?, name?, room? }` | Expose le strip en projecteur DMX (3 canaux R/G/B par zone + 1 canal de dimmer master en queue) : crée/maj le projecteur et branche `dmxMirror.zones`. Corps entièrement optionnel — adresse auto-allouée. Renvoie `{ light, fixture }` |
| `DELETE` | `/api/smart-lights/:id/dmx-fixture` | — | Supprime le projecteur généré et débranche `dmxMirror.zones` |
| `POST` | `/api/smart-lights/:id/layout` | `SmartLightZoneLayout \| null` | Sauvegarde le placement 3D des zones |
| `POST` | `/api/smart-lights/:id/effect` | `SmartLightEffectConfig \| null` | Active un effet position-aware (l'EffectEngine prend le relais) |
| `POST` | `/api/smart-lights/probe` | `{ host, port? }` | Test rapide de reachability sans pairing |
| `POST` | `/api/smart-lights/discover` | `{ timeoutMs? }` | Scan mDNS (~3 s par défaut) — retourne les Nanoleaf trouvés |

### Ampoules HomeKit-sur-Thread (patch automatisé)

Ces trois endpoints ramènent l'ajout d'une ampoule Nanoleaf Essentials de sept étapes
manuelles à deux clics. Voir `tools/homekit-thread/README.md` pour la procédure complète.

| Méthode | Endpoint | Corps | Description |
|---------|----------|-------|-------------|
| `GET` | `/api/smart-lights/thread/candidates` | — | Ampoules appairées côté sidecar mais pas encore déclarées : la liste « prêtes à patcher ». Renvoie `{ sidecarUp, candidates[], message? }` — `sidecarUp: false` plutôt qu'une liste vide trompeuse si le sidecar est arrêté |
| `POST` | `/api/smart-lights/thread/adopt` | `{ alias, name?, room?, patchDmx?, fixtureId?, universe? }` | Déclare la lampe **et** la patche : adresse DMX libre trouvée par `store.findFreeAddress()`, projecteur 4 canaux créé (`homekit.enabled: false`), miroir posé, accessoire HomeKit exposé. `fixtureId` rattache à un projecteur **existant** au lieu d'en créer un second. Transactionnel : la lampe est retirée si la création du projecteur échoue |
| `POST` | `/api/smart-lights/thread/pair` | `{ name, pin, alias?, timeoutSec? }` | Lance l'appairage. **Ouvre Terminal.app via AppleScript** : l'appairage exige le Bluetooth, que macOS n'accorde jamais à un processus sans interface. Requiert `THREAD_DATASET`. Détaché — la requête n'attend pas les 2-4 min de la procédure |

### Prise Meross

| Méthode | Endpoint | Corps | Description |
|---------|----------|-------|-------------|
| `GET` | `/api/meross` | — | Statut de la prise (`MerossStatus` : enabled, active, host, key, channel, on, reachable, projecteurs surveillés, extinction auto : offWatchedChannelCount/offTimeoutMs/offCountdownMs, lastError) |
| `PUT` | `/api/meross` | `MerossConfigInput` | Met à jour la config (persiste en base) puis reconfigure le service à chaud |
| `POST` | `/api/meross/test` | — | Teste la connexion locale à la prise (`{ reachable, on, error }`) |

### Système

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/health` | Healthcheck (retourne `{ ok: true }`) |
| `GET` | `/api/homekit` | Statut HomeKit (enabled, setupUri, fixtures, QR code) |
| `GET` | `/api/rooms` | Liste des pièces (union des fixtures et smart lights ayant `room`) |
| `POST` | `/api/system/restart` | Redémarre les 3 services launchd (backend, frontend, QLC+) via `launchctl kickstart -k` — macOS uniquement |
| `WS` | `/ws` | WebSocket temps réel |

---

## WebSocket

**Connexion :** `ws://localhost:5000/ws` en direct sur le backend.

Le frontend, lui, ne doit jamais coder cette URL en dur : il dérive l'URL de **l'origine de la page** — `wss://` si la page est servie en HTTPS, et `window.location.host` (port inclus). Il emprunte donc le proxy `/ws` exactement comme les appels `/api` : Vite en dev, reverse proxy en façade. Voir [Exposition réseau](#exposition-réseau-reverse-proxy).

> ⚠️ Ne pas « optimiser » en visant `ws://<host>:5000` en dur. Derrière une façade HTTPS, le navigateur bloque la connexion (Mixed Content) et le port 5000 n'est de toute façon pas exposé par le proxy — l'erreur remonte jusqu'à `AppDataProvider` et vide l'interface.

### Messages serveur → client

```jsonc
// Tick univers (N fois par seconde selon DMX_FPS)
{ "type": "universe_tick", "data": { "fps": 30, "universe": 0, "values": [0,...], "timestamp": "..." } }

// Mise à jour d'un projecteur
{ "type": "fixture_updated", "data": { ...Fixture } }

// Scène activée
{ "type": "scene_activated", "data": { "sceneId": "uuid" } }

// Log
{ "type": "log", "data": { "level": "info", "message": "...", "timestamp": "..." } }

// Mise à jour smart light (après setState / refresh / streaming toggle)
{ "type": "smart_light_updated", "data": { ...SmartLight } }
```

Le client (`useDmxWebsocket.ts`) écoute ces événements et met à jour l'état React.

---

## Service DMX (`backend/src/services/dmx.ts`)

- Étend `EventEmitter`
- Maintient un tableau de 512 valeurs (`Uint8Array` ou `number[]`)
- **Modes de sortie :**
  - `artnet` : envoie des frames Art-Net via le package `artnet` vers `ARTNET_HOST:ARTNET_PORT/ARTNET_UNIVERSE`
  - `enttec` : interface série via `dmx-ts` + `serialport` (USB FTDI, latencyTimer=1ms)
  - **simulation** : fallback automatique si aucun hardware détecté
- Émet l'événement `"tick"` avec `UniverseState` à chaque frame
- Méthodes clés :
  - `setChannel(channel: number, value: number)` : 1-indexed, valeur 0–255
  - `applyWrite(values: Record<string, number>)` : applique un mapping canal→valeur
  - `setFrameRate(fps: number)` : change le FPS à chaud
  - `start()` / `stop()` : démarrage/arrêt de la boucle

---

## Service HomeKit (`backend/src/services/homekit.ts`)

Utilise `hap-nodejs` pour créer un pont HomeKit. Gère deux types d'accessories :

### Projecteurs RGB (`Service.Lightbulb`)

- **Flux HomeKit → DMX :** Hue/Saturation/Brightness → `hsbToRgb()` → canaux R, G, B
- **Flux DMX → HomeKit :** tick DMX → lit R/G/B → `rgbToHsb()` → met à jour HomeKit
- **Résolution canaux RGB :** via `resolveRgbChannels()` dans `homekit-utils.ts`
  - Priorité 1 : `fixture.homekit.dmxChannels` (mapping explicite)
  - Priorité 2 : capabilities `r`, `g`, `b` dans `fixture.channels`

### Lyres / Moving heads (multi `Service.Lightbulb`)

- Détectées automatiquement si la fixture a des capabilities `pan` ou `tilt`
- **Un accessory HAP par lyre**, avec plusieurs services `Lightbulb` :

| Service HAP | Nom affiché | Subtype | Canal DMX mappé |
|-------------|-------------|---------|-----------------|
| `Lightbulb` (On + Brightness) | nom de la fixture | `"dimmer"` | `intensity` → dimmer ; `strobe` → shutter open/close |
| `Lightbulb` (On + Brightness 0–100%) | `"Pan"` | `"pan"` | `pan` (0–255 linéaire) |
| `Lightbulb` (On + Brightness 0–100%) | `"Tilt"` | `"tilt"` | `tilt` (0–255 linéaire) |
| `Lightbulb` (On + Brightness 0–100%) | `"Color Wheel"` | `"color"` | `color` (roue chromatique) |
| `Lightbulb` (On + Brightness 0–100%) | `"Gobo"` | `"gobo"` | `gobo` |

- Seuls les services dont le canal existe dans la fixture sont créés
- Mirror bidirectionnel DMX ↔ HomeKit via `mirrorMovingHeads()` à chaque tick
- **Résolution des canaux :** `homekit-utils.ts` → `collectHomeKitMovingHeads()`
  - Priorité 1 : `fixture.homekit.movingHeadChannels` (overrides explicites, relatifs à l'adresse)
  - Priorité 2 : capabilities dans `fixture.channels`

- Méthode `syncFixtures()` : synchronise lights ET moving heads à chaque changement de fixture
- Le statut `GET /api/homekit` liste **les deux familles** (`kind: "channels" | "movingHead"`) — c'est
  lui qui décide du badge « HomeKit » dans le patch. Les lyres en étaient absentes, donc jamais badgées.

### Nommage des accessoires (renommer depuis le patch)

Renommer un projecteur dans le patch doit le renommer dans l'app Maison. Trois pièces sont nécessaires,
et il en manquait deux :

| Pièce | Rôle |
|-------|------|
| `accessory.displayName` | interne à hap-nodejs — **ne part jamais sur le fil** |
| `Characteristic.Name` | lu par iOS à la **découverte** seulement ; les services étaient ajoutés sans nom (chaîne vide) |
| `Characteristic.ConfiguredName` | relu à **chaque changement de version de config** — c'est elle qui fait suivre un renommage |

- `HomeKitBridge.nameService()` écrit les trois d'un coup. `ConfiguredName` ne figure pas dans les
  caractéristiques optionnelles d'un `Lightbulb` : il faut la déclarer (`addOptionalCharacteristic`) avant.
- Un renommage **recrée** les accessoires (retrait + ajout) : seul un ajout/retrait change la version de
  config du pont, et sans ce changement l'app Maison ne relit pas les noms. L'UUID étant dérivé du
  `deviceId`, l'app Maison retrouve le même accessoire (pièce et automatisations conservées).
- `hapName()` (`homekit-utils.ts`) nettoie le nom : HAP n'accepte qu'alphanumérique, espace et
  apostrophe, et exige de commencer/finir par une lettre ou un chiffre. Les noms QXF du genre
  `Showtec LED Par 56 (6 Channel)` déclenchaient l'avertissement HAP « invalid Name characteristic ».
  Le pupitre garde le nom tel quel : seul le miroir HomeKit est nettoyé.
- Les lampes connectées suivent la même règle (`syncSmartLights` recrée l'accessoire au renommage).

> **Limite Apple.** Le nom d'un accessoire appartient à la maison de l'utilisateur, pas à l'accessoire :
> iOS le retient au premier ajout, le synchronise entre appareils, et l'accessoire ne peut plus jamais
> l'écraser. Renommer dans Maison est la voie normale.

#### `accessoryRevision` — forcer un accessoire neuf

Corollaire de la limite ci-dessus : tant que l'UUID ne bouge pas, Maison reconnaît le même appareil et
lui réapplique le nom qu'il avait retenu. `fixture.homekit.accessoryRevision` (entier, défaut 0) entre
dans la graine de l'UUID via `smartLightAccessorySeed()` :

| Génération | Graine | Effet |
|---|---|---|
| `0` ou absent | `lightbridgedmx:smartlight:<id>` | identité d'origine — **ne jamais changer par défaut**, sinon tous les accessoires déjà appairés la perdent d'un coup |
| `n > 0` | `lightbridgedmx:smartlight:<id>:r<n>` | Maison voit un **appareil neuf**, qui prend le nom courant ; il perd sa pièce et sort des automatisations |

Le numéro de série suit (`<id>-r<n>`) pour que deux générations ne se présentent pas à l'identique.
`reconcileSmartLights()` compare l'UUID attendu à celui de l'accessoire en place et recrée quand il
diffère. Se règle à la main sur la façade :
`PUT /api/fixtures/:id {"homekit":{"enabled":true,"accessoryRevision":1}}`.

### Température de couleur (blanc variable)

Le Nanoleaf Essentials (NL45) déclare `ColorTemperature` en **mired**, plage 153–470 (≈ 6535–2127 K),
en lecture/écriture. Trois unités se croisent, et les confondre donne un réglage qui marche à l'envers
sans jamais lever d'erreur :

| Étage | Unité | Sens |
|---|---|---|
| Pupitre / DMX | 0–255 | 0 = le plus chaud |
| LightBridge, UI, API | **Kelvin** (2127–6535) | croissant = plus froid |
| HAP (ampoule + app Maison) | **mired** (153–470) | **inverse** : croissant = plus chaud |

Les conversions vivent dans `packages/shared` (`kelvinToMired`, `miredToKelvin`, `dmxToKelvin`,
`kelvinToDmx`, `clampKelvin`) et sont couvertes par `backend/src/services/color-temp.spec.ts`. Elles ne
sont appliquées qu'aux **frontières** : `homekit-thread-client.ts` (Kelvin ↔ mired vers le sidecar) et
`homekit.ts` (Kelvin ↔ mired vers l'app Maison). Le sidecar reste fidèle au protocole : il parle mired.

Le mappage DMX est linéaire **en Kelvin**, pas en mired : c'est la graduation qu'on lit sur les
projecteurs à blanc variable, donc celle qu'on attend au fader.

#### Couleur et blanc sont exclusifs

L'ampoule ne peut pas recevoir teinte/saturation **et** température : HAP n'a d'ailleurs aucune
caractéristique de « mode ». Le miroir DMX arbitre donc au dernier fader touché (`onDmxTick`) :

- bouger le canal température → mode `ct` ; bouger un canal R/V/B → mode `hs` ;
- tant que personne ne bouge, le mode courant **persiste** — remonter le dimmer ne doit pas faire
  retomber un blanc réglé sur une couleur ;
- un canal température laissé à 0 n'impose **rien** : sans cette règle, le seul fait de câbler le canal
  coincerait la lampe sur le blanc le plus chaud.

Corollaire côté relecture : `refreshFromDevice` ne reprend plus le `colorMode` de l'appareil (il n'en
déclare pas) et ne réécrit pas un `ct` en attente lorsque la lampe est éteinte — la couleur n'étant
poussée qu'à l'allumage, la consigne serait effacée avant d'avoir servi.

#### Le dimmer échelonne le mélange RGB

`rgbToHsv` normalise : rouge à 50 % ressort en teinte 0, saturation 100, **valeur 50**. Prendre la
luminosité du seul `briChannel` jetait cette valeur — toute couleur sortait à fond et le dimmer semblait
s'ajouter par-dessus. On multiplie désormais, comme un projecteur RGB réel :
`brightness = V(rgb) × (dimmer / 255)`.

> **Conséquence à connaître** : R/V/B tous à zéro donne 0 %, même dimmer ouvert — c'est le comportement
> d'un projecteur RGB. Pour du blanc au dimmer seul, passer par le canal température (ou monter R/V/B
> à parts égales).

### Façade DMX d'une lampe connectée

Une Nanoleaf pilotée en DMX a **deux faces** : la lampe (`SmartLight`) et un projecteur bidon dont les
canaux servent de prise en main depuis le pupitre. L'app Maison ne doit en voir **qu'une**.

- `findFacadeFixture(light, fixtures)` retrouve le projecteur façade : via `dmxMirror.zones.fixtureId`
  s'il existe, sinon en cherchant le projecteur dont l'empreinte couvre **tous** les canaux du miroir
  uniforme.
- Une lampe **avec** façade suit la façade : exposée seulement si `fixture.homekit.enabled !== false`,
  sous le nom du projecteur (`Lampe Salon`, pas `Nanoleaf A19 26N3`). Une lampe **sans** façade se
  représente elle-même.
- La façade est **retirée du flux canal-par-canal** (`collectHomeKitChannelFixtures` la saute) : cocher
  la case ne donne jamais quatre ampoules Dimmer/R/V/B, mais **une ampoule normale** (teinte,
  saturation, luminosité).
- Le statut expose `smartLights[].fixtureId` : c'est lui qui fait porter le badge « HomeKit » au bon
  projecteur dans le patch, la façade n'apparaissant pas dans `fixtures[]`.
- `HomeKitBridge.reconcile()` est le **point d'entrée unique** : projecteurs et lampes se conditionnent
  mutuellement, les synchroniser séparément laissait des trous selon l'ordre des appels (au démarrage,
  les projecteurs sont connus avant les lampes).

---

## Service Smart Lights (`backend/src/services/smart-lights/`)

Pilote des lampes WiFi (Nanoleaf en V1, extensible) avec deux paths de sortie, mirror DMX bidirectionnel, effets position-aware en 3D et discovery mDNS.

### Composants

| Fichier | Rôle |
|---------|------|
| `nanoleaf-client.ts` | Client HTTP OpenAPI Nanoleaf (`pair`, `getInfo`, `setState`, `setCt`, `listEffects`, `selectEffect`, `enableExtControl`). Erreurs typées via `NanoleafApiError`. |
| `nanoleaf-streamer.ts` | Streamer UDP extControl v2 — socket `node:dgram`, frame format `[panelCount:u16BE]([panelId:u16BE][R][G][B][W][transitionMs/100:u16BE])×N`, keepalive 4 Hz. |
| `effect-engine.ts` | Pure function `evaluateEffect(config, layout, time) → RgbFrame[]`. 5 effets simples (`static`, `solid`, `gradient`, `chase`, `wave`) + l'effet paramétrique `ma` façon grandMA2. Les effets position-aware utilisent le milieu de chaque `ZoneSegment` projeté sur une direction 3D. |
| `discovery.ts` | Scan mDNS via `bonjour-service` sur `_nanoleafapi._tcp`. Window configurable (~3 s par défaut). |
| `index.ts` | `SmartLightService` — registry, tick loops, DMX mirror listener, refresh périodique, dispatch effet/streaming/HTTP. |

### Paths de sortie (priorité)

À chaque flush, pour chaque light, dans cet ordre :

1. **Effets** — plus rien ici. Le `SmartLightService` ne calcule plus d'effet : il n'en a jamais eu les moyens, un effet posé sur une light ne pouvant sortir que par la frame UDP de ce strip. Les effets vivent maintenant au niveau DMX (`services/effects/`, voir ci-dessous) et le strip les reçoit comme n'importe quel projecteur, par sa façade DMX et son mirror par zone.
2. **Zone palette statique** — si `entry.zonePalette` est posé via `applyZones()` mais pas d'effet : streamer push la palette telle quelle
3. **Streaming uniforme** — si streaming actif sans effet ni palette : streamer push couleur unique calculée depuis `desired.{hue,sat,brightness}`
4. **HTTP coalescé** — sinon : `flushAll()` calcule `computeStateDiff(lastPushed, desired)` et fait un `PUT /state` coalescé sur les dimensions changées (rate-limit 1 push / 70 ms / device)

### Boucles internes

| Timer | Période | Rôle |
|-------|---------|------|
| `flushTimer` | 30 ms | HTTP coalesced push (`flushAll`) pour les lights sans streaming |
| `streamTimer` | 33 ms (~30 Hz) | UDP streaming push (`streamAll`) — évalue effet ou écrase couleur uniforme |
| `refreshTimer` | 5 s | Refresh depuis device si quiescent (pas de write local < 2 s ET pas de diff en attente) |
| `keepaliveTimer` (par streamer) | 250 ms | Re-transmet la dernière frame UDP pour que le device ne quitte pas extControl |

### DMX Mirror

Si `light.dmxMirror = { rChannel, gChannel, bChannel, briChannel }` est défini, le service écoute `dmx.on("tick")` et lit ces canaux dans l'univers à chaque tick. Conversion RGB → HSV → push dans `desired` (qui sera flush au prochain tick HTTP ou stream). Permet d'inclure une smart light dans les scènes et les sliders du `ChannelGrid` de manière transparente.

### DMX Mirror par zone (strip = projecteur multi-cellules)

Si `light.dmxMirror.zones = { startChannel, zoneCount }` est défini, `readZoneMirror()` lit à chaque tick DMX un bloc de `zoneCount × 3` canaux consécutifs et en fait une frame per-zone :

```
zone 0 → startChannel (R), +1 (G), +2 (B)
zone 1 → startChannel+3 (R), +4 (G), +5 (B)   …
```

**Requiert `streaming.enabled = true`** : la frame part par le path UDP extControl (`streamAll` → `sendZones`), pas par HTTP. `setEffect` et `applyZones` l'activent d'office (`ensureStreamingForZoneWork`) — une couleur par zone n'a pas d'autre transport, et l'ancien comportement (ne rien faire, sans message) était indiagnosticable.

#### Dimmer master (`dimmerChannel`)

La frame extControl **ne transporte que du R/G/B** : aucune notion d'intensité. La luminosité master du device module pourtant tout ce qu'on envoie, et elle est injoignable pendant le streaming (`flushAll` saute les lights en streaming). Un strip entré en extControl à 38 % plafonne donc à 38 %, sans le moindre symptôme logiciel — le blanc plein sort gris.

D'où le partage des rôles :

- la **luminosité device est clouée à 100 %** avant toute entrée en extControl (`setStreaming`, `register`, et rattrapée par le watchdog `ensureStreaming`) ;
- l'**intensité se joue dans la frame**, via `dimmerChannel` : `streamAll` multiplie les couleurs de zone par ce canal (`scaleZones`) sur **tous** les paths — mirror DMX, effet, palette, couleur uniforme.

Deux propriétés voulues :

- le master **ne prend jamais la main** sur le strip (pas de `dmxZonesOwned`) : c'est un fader d'intensité, il atténue ce qui joue sans le remplacer — bouger le master pendant un effet dimme l'effet, il ne le fige pas ;
- `publishEffectToDmx` republie la frame **non atténuée** : le master a son propre canal, l'atténuer à la publication l'appliquerait une deuxième fois à la relecture du tick suivant, jusqu'au noir.

**Priorité LTP (latest takes precedence)** — pour que configurer ce mirror ne rende pas le painter et les effets inutilisables :

| Événement | Effet |
|-----------|-------|
| Le bloc DMX change de valeur | `dmxZonesOwned = true` — le DMX possède le strip, **avant** la garde `desired.on` (un blackout DMX éteint donc bien le strip) et avant `currentEffect` |
| `applyState` / `applyZones` / `setEffect` | `dmxZonesOwned = false` — le pilotage local reprend jusqu'au prochain mouvement DMX |
| Le `dimmerChannel` change de valeur | **Aucune** prise de main — le master atténue la source en cours sans la remplacer |
| Premier tick après `register`, bloc entièrement à 0 | Pas de prise de main (sinon un bloc vide éteindrait un effet en cours au démarrage) |

Le `POST /api/smart-lights/:id/dmx-fixture` fait le câblage complet : il crée un projecteur de `zoneCount × 3 + 1` canaux (`buildZoneRgbChannels()` dans `shared` — capabilities `r`/`g`/`b`, nommés « Zone N Rouge/Vert/Bleu », plus un canal `intensity` « Dimmer master » **en queue de bloc**), le pousse à 255 dans l'univers avant de brancher le mirror (un canal DMX vaut 0 par défaut : dans l'autre ordre, le strip clignote en noir), alloue automatiquement le premier bloc de canaux libre si aucune adresse n'est donnée, et branche `dmxMirror.zones` dessus. Le projecteur généré est créé avec `homekit: { enabled: false }` : la lampe est déjà exposée nativement par Nanoleaf, et un accessoire HomeKit ne saurait piloter que la première zone.

### Méthodes principales du SmartLightService

| Méthode | Rôle |
|---------|------|
| `register(light)` | Ajoute ou remplace une light dans le registry, initialise le client et le streamer si configuré |
| `unregister(id)` | Stoppe le streamer et supprime du registry |
| `applyState(id, patch)` | Met à jour `desired` depuis un patch (rgb / hue / sat / brightness / ct / on), trigger flush |
| `applyZones(id, palette)` | Push direct un palette per-zone (active le streaming si besoin) |
| `readZoneMirror(entry, cfg, state)` | *(privé)* Lit le bloc DMX par zone (+ le dimmer master) à chaque tick et gère la prise de main LTP |
| `ensureStreamingForZoneWork(id)` | *(privé)* Active le streaming UDP quand une écriture par zone le réclame |

## Moteur d'effets DMX (`backend/src/services/effects/`)

Un effet s'applique à la **sélection courante de projecteurs**, pas à une lampe. C'est le modèle grandMA2 ([help.malighting.com](https://help.malighting.com/grandMA2/en/help/key_effects.html)) : « une modulation automatisée d'attributs », répartie sur les fixtures sélectionnées.

| Fichier | Rôle |
|---------|------|
| `packages/shared/src/effect-engine.ts` | Math pure : `evaluateDmxEffect(effect, cellCount, t, positions?)` → une valeur 0..1 par cellule et par ligne, plus `spatialPositions()`, `applyCurve()` et `effectLineColor()`. Sans état, sans I/O, testé. |
| `packages/shared/src/effect-cells.ts` | `resolveCells(fixtureIds, fixtures, smartLights)` — développe une sélection en **cellules** portant leurs canaux DMX absolus. |
| `backend/.../effects/runner.ts` | `EffectRunner` — évalue à chaque trame de sortie DMX, traduit en écritures, tramage, et restaure à l'arrêt. |

La math et la résolution des cellules vivent dans le **package partagé**, pas côté backend : l'aperçu
de la fenêtre Effets appelle exactement les mêmes fonctions que le runner. C'est ce qui rend l'aperçu
non-négociablement honnête — il ne peut pas montrer un chenillard sur 3 pas là où le bandeau en jouera
50, ni une couleur que le plateau ne prendra pas. Les tests de ces deux modules restent dans la suite
Vitest du backend (`backend/src/services/effects/`), seul paquet du dépôt équipé pour les exécuter.

### Une seule horloge

Le runner n'a **pas** de minuteur à lui : il s'abonne à `dmx.onBeforeFrame()` et calcule juste avant la construction de chaque trame.

Un `setInterval(33 ms)` à côté d'une sortie à 30 Hz dérive contre elle. Les deux cadences battent l'une contre l'autre et il sort régulièrement une trame où l'effet n'a pas encore recalculé — donc une valeur répétée. Mesuré sur un fondu sinus : **4 trames répétées sur 90**, soit un à-coup toutes les 0,75 s, parfaitement visible sur un PAR. En se calant sur la boucle de sortie, chaque trame porte une valeur fraîche, calculée une seule fois.

`DMX_FPS` vaut **30** (40 jusqu'au 2026-10-12, voir « Marge de trame » plus bas), et le service borne à **44** (`DMX_MAX_FPS`). C'est le seul levier logiciel contre l'escalier d'un fondu : en 8 bits, un sinus pleine échelle en 2 s franchit 255 valeurs en 1 s, soit 13 pas DMX par trame à 30 Hz contre 5-6 à 60 Hz (mesuré). À savoir : une ligne DMX512 **physique** plafonne vers 44 trames/s pour un univers plein — au-delà on émet plus d'Art-Net que la ligne n'en transporte, sans danger mais sans gain garanti.

#### Le plafond de 44 Hz n'est pas négociable

```
250 kbit/s en 8N2 → 11 bits/octet → 44 µs par octet
513 octets (start code + 512 canaux) × 44 µs = 22,6 ms
+ BREAK (88 µs) + MAB (8 µs)                 ≈  0,1 ms
                                     total   ≈ 22,7 ms  →  ~44 trames/s
```

Régler une interface au-delà ne l'accélère pas : sur une sortie bit-bangée (Open DMX / FT232R), **elle cesse d'émettre**. Constaté en production le 2026-09-04 — plus aucun projecteur ne répondait après un passage à 60 Hz, et QLC+ est resté coincé dans cet état jusqu'à un redémarrage complet du processus.

`DMX_FPS` doit rester **aligné sur la fréquence de trame réglée dans QLC+**. Le moteur d'effets trame ses valeurs : émettre à 60 ce qu'un maillon aval consomme à 40 revient à échantillonner le motif au lieu de l'intégrer, ce qui annule le tramage.

#### Marge de trame de l'Open DMX : 30 Hz et 128 canaux

Symptôme : par moments, la lyre part une fraction de seconde puis revient, les PAR clignotent, **sans aucune commande**. Ce n'est ni le backend ni l'Art-Net : c'est une trame DMX incomplète, émise de temps en temps par l'Open DMX.

Mesuré le 2026-10-12 (`sample` du thread `EnttecDMXUSBOpen` de QLC+, 40 Hz, 512 canaux). Sur chaque période de 25 ms :

| Étape | Durée |
|---|---|
| BREAK + MAB (transferts de contrôle USB) | ~1,8 ms |
| `ftdi_write_data` (bloquant) | ~19 ms |
| Sommeil jusqu'à la trame suivante | ~4 ms |

La trame occupe 22,7 ms sur le câble : il ne reste **aucune marge**. Le moindre retard de macOS ou de l'USB fait partir le BREAK suivant sur une trame inachevée, et les projecteurs lisent des valeurs fausses pendant 25 ms. Le développeur de Beam a observé la même chose à l'analyseur logique sur Mac, QLC+ compris.

Réglage retenu :

- **`UniverseChannels="128"`** dans `qlc-plus/home.qxw` : QLC+ n'envoie que 128 canaux à l'Open DMX. Les projecteurs physiques s'arrêtent au canal 107 ; les canaux 108-258 sont la façade **virtuelle** du bandeau, inutile sur le XLR. La trame passe de 22,7 ms à 5,7 ms.
- **30 Hz** des deux côtés : `DMX_FPS=30` dans le plist du backend, et dans QLC+ la fréquence de l'interface. Celle-ci ne vit **pas** dans `home.qxw` mais dans les préférences macOS (domaine `net.sf.Q Light Controller Plus`, clé `qlcftdi.freqmap`, indexée par le n° de série du FT232R). Période de 33 ms → ~25 ms de marge.

Piège inverse : un projecteur **physique** adressé au-delà du canal 128 ne recevra rien, sans aucun message (même panne que `UniverseChannels="31"` en mai 2026). En patcher un impose de remonter la valeur.

Si les sauts persistent malgré cette marge, chercher sur la ligne (bouchon 120 Ω sur la sortie du dernier projecteur, câble DMX 110 Ω plutôt qu'un câble micro), puis passer à une interface qui génère son propre timing (DMX USB Pro, ultraDMX Micro, nœud Art-Net).

Ne pas interroger l'API web de QLC+ pour diagnostiquer : en 4.13.1, `getChannelsValues` avec un univers hors limites ne rend jamais le verrou des univers, et **toute la sortie se fige** sur la dernière trame jusqu'au redémarrage de QLC+.

#### La granularité d'un fondu est une limite matérielle, pas logicielle

Constaté le 2026-09-04 sur les PAR 56 Lava et Café : un fondu profond montre des paliers visibles, **et QLC+ les montre à l'identique en pilotant directement**. Le test croisé (même PAR, même XLR, même interface, source différente) clôt la question — inutile de re-chercher dans le moteur d'effets.

Ces deux PAR n'ont **pas de canal d'intensité** : on les gradue en faisant varier leur RGB, et leur électronique applique sa propre courbe et sa propre résolution de PWM. Aucune correction en amont n'ajoute des niveaux qu'ils ne savent pas rendre.

Deux fausses pistes explorées à cette occasion, à ne pas refaire :

- **La courbe de gradation** (`curve: "square"`) est théoriquement correcte — la luminosité perçue suit une racine cubique — mais **nuisible en 8 bits** : elle écrase le bas du fondu dans une poignée de valeurs (…4, 2, 1, 0) où chaque cran double la luminance. Elle rend le résultat pire, pas meilleur. Défaut : `linear`.
- **Le tramage temporel** (`dither`) suppose que l'œil intègre le motif. Dans la chaîne Art-Net → QLC+, un maillon ré-échantillonne le flux sur sa propre horloge et le motif ressort en battement lent. Défaut : `false`. Il reste valide sur un chemin direct dont on maîtrise la cadence — le streaming UDP d'un bandeau, dont l'émission est désormais calée sur l'horloge DMX.

#### QLC+ n'est pas une couche inutile

Il ne pilote rien — mais il produit le **timing temps réel** de la trame DMX (BREAK, MAB, 44 µs/octet) dans un thread dédié, via libFTDI. C'est ce que le backend ne peut pas faire : en sortie directe (`DMX_OUTPUT=enttec`), ce timing vit dans la boucle d'événements de Node, partagée avec HomeKit, le WebSocket, les effets et le GC. Chaque pause décale le BREAK et corrompt une trame.

Testé le 2026-09-04 : la sortie directe fonctionne mais produit des **artefacts visibles** (pertes de signal intermittentes). Garder QLC+.

À savoir aussi : QLC+ accède au FT232R par libFTDI, en détachant le pilote noyau. Il n'apparaît donc **jamais** dans `lsof /dev/cu.usbserial-*` — son absence n'est pas un symptôme.

⚠️ Modifier une variable d'environnement dans un plist launchd demande un `bootout` + `bootstrap`. Un `kickstart -k` relance le processus avec la configuration **déjà chargée** : la nouvelle valeur est ignorée sans le moindre message.

### La cellule, pièce centrale

C'est elle qui fait qu'un effet ne connaît plus la différence entre un PAR et un ruban :

```
PAR 56 (intensity + RGB)          -> 1 cellule  { dimmer, red, green, blue }
Lyre MH-X20 (pan/tilt/dimmer)     -> 1 cellule  { pan, tilt, dimmer }
Bandeau LED (façade 50 zones)     -> 50 cellules { red, green, blue } chacune
```

La phase se répartit sur cette liste à plat, **dans l'ordre de sélection** — sélectionner de gauche à droite ou l'inverse donne deux balayages opposés, comme sur un pupitre.

Une cellule de ruban n'a **pas** de canal `dimmer` : le master de la façade est unique pour tout le bandeau. Une ligne `dimmer` qui tombe sur une telle cellule est donc traduite en fondu `bgColor → color`, seule façon de faire varier l'intensité d'une LED qui n'a que trois canaux. Même mécanique pour les attributs `color` et `hue`, qui n'ont jamais de canal propre et pilotent le trio R/G/B.

#### Intensité et couleur sont deux choses, même sur un seul projecteur

Certains projecteurs ont **les deux** : R/G/B *et* un master (PAR 56 Lampe, Par 56 Bureau, Lampe Salon). Une ligne `dimmer` y écrivait le master et laissait le RGB tel quel — donc noir la plupart du temps, et un effet parfaitement invisible dont on ne voyait bouger que le gradateur. Règle actuelle :

| Cellule | Ligne `dimmer` |
|---------|----------------|
| RGB seul (zone de ruban, PAR 56 Lava) | fondu `bgColor → color` sur le RGB |
| RGB **+** master | le master module, et la couleur `color` est posée sur le RGB — si l'effet en déclare une |
| Master seul (lyre) | le master module |

**Sans `color` déclarée, le RGB n'est pas touché** : un effet de gradation posé sur une teinte réglée à la main doit la laisser tranquille, comme sur un pupitre où dimmer et couleur sont deux attributs séparés. Le bouton « Couleur libre » de la fenêtre efface `color` pour retrouver ce comportement.

Le cas miroir — un effet de **couleur ou de position** sur un projecteur dont le master est à 0 — n'est pas corrigé par le moteur : l'intensité appartient à l'opérateur. La fenêtre le signale (`EffectDimmerGuard`) et propose « Ouvrir à 100 % », plutôt que de décider à sa place ou de laisser chercher.

### Lignes, modes, MAtricks

Un effet porte **plusieurs lignes**, une par attribut — c'est ce qui permet un cercle de lyre (une ligne `pan`, une ligne `tilt` déphasée de 90°).

- **Mode `absolute`** : la forme balaie `low..high` et remplace la valeur.
- **Mode `relative`** : la bande `low..high` devient une **amplitude** autour de la valeur de départ, figée au lancement. Sans ce gel, l'effet se relirait dans l'univers et s'additionnerait à lui-même jusqu'en butée.
- **MAtricks** : `blocks` (cellules voisines en phase), `groups` (motif répété), `wings` (sélection pliée, une aile sur deux en miroir), `interleave` (une cellule sur N joue, les autres restent intactes). `single` de MA n'est **pas** repris : c'est un réglage du pas de Next/Previous, sans objet hors parcours interactif.
- **Vitesse** : `speed` en BPM × `rate` (multiplicateur), comme sur le pupitre où Rate 1 = 60 BPM.

### Règles de jeu

- **Un seul effet par projecteur** : lancer sur une sélection qui recoupe un effet en cours arrête ce dernier. Deux effets sur les mêmes canaux se disputeraient l'univers à 30 Hz.
- **L'arrêt restaure** les canaux à leur valeur d'avant le lancement — sinon la sélection reste figée sur la dernière frame (une lyre bloquée à mi-course).
- **Rien n'est persisté** : un redémarrage du backend coupe tout. Un effet qui se rallume seul au petit matin est une mauvaise surprise, pas une fonctionnalité.
- **La distribution spatiale** (`spatial`, `sides`) ne s'active que si les cellules ont une position 3D — les zones d'un ruban ayant un `zoneLayout`. Sur des projecteurs classiques, qui n'ont pas de coordonnées dans le patch, elle est ignorée et la phase suit le rang.

| Méthode | Verbe HTTP | Rôle |
|---------|-----------|------|
| `GET /api/effects` | — | Effets en cours |
| `POST /api/effects/run` | `{ effect, fixtureIds }` | Lance sur une sélection |
| `PUT /api/effects/:id` | `{ effect }` | **Retouche un effet en cours** sans le relancer |
| `DELETE /api/effects/:id` | — | Arrête et restaure |
| `POST /api/effects/stop-all` | — | Arrête tout |

`PUT` existe pour une raison précise : relancer aurait remis `t0` à maintenant, donc rendu la phase à
son point de départ — un à-coup visible sur le plateau à chaque cran d'encodeur, alors qu'on cherche
justement à régler l'effet en le regardant. Il conserve `t0`, les cellules et la photo des canaux
d'avant lancement ; il recalcule la distribution spatiale et vide le report de tramage. La **cible**,
elle, ne change pas : modifier la sélection, c'est un nouvel effet, pas un réglage.

Le pool de départs vit dans le package partagé (`DMX_EFFECT_PRESETS`), dérivé du pool historique via `maToDmxEffect()` : les 23 presets ont été réglés à l'oreille sur le bandeau du salon, leurs phases et origines spatiales valent mieux qu'une réécriture.

| `setStreaming(id, enabled, zoneCount?)` | Active/désactive le streaming UDP, persiste en DB |
| `setEffect(id, effect)` | Définit l'effet position-aware courant, persiste en DB |
| `setLayout(id, layout)` | Sauvegarde la disposition 3D des zones |
| `listEffects(id)` | Liste les effets builtin du device (proxy HTTP) |

### Pairing Nanoleaf

Le strip doit être en mode pairing (tenir le bouton power ~5–7 s jusqu'à pulsation LED, ou activer une option dans l'app Nanoleaf — fenêtre 30 s). Le UI propose un bouton "Pairer" qui POST `/api/smart-lights/pair`. En cas de 409 (pas en pairing), message clair retourné. Pour éviter le timing serré, le frontend peut polling toutes les 500 ms.

### Streaming UDP extControl

Activer le streaming :
1. `PUT /api/v1/<token>/effects` avec `{"write":{"command":"display","animType":"extControl","extControlVersion":"v2"}}`
2. Ouvrir socket UDP vers `<host>:60222`
3. Envoyer des frames continues (le device sort de extControl après ~250 ms sans frame)

Frame format v2 :
```
[panelCount: uint16 BE]
For each panel:
  [panelId: uint16 BE]
  [R: u8] [G: u8] [B: u8] [W: u8]
  [transitionTime_x100ms: uint16 BE]
```

**NL72K3 (Lightstrip Essentials, firmware 4.0.11) :** 50 zones addressables (panelId 0–49), unspecified panels = noir, single-color = remplir les 50 zones avec la même RGB.

---

## Service Prise Meross (`backend/src/services/meross-plug.ts`)

`MerossPlugService` synchronise l'alimentation d'une prise connectée Meross avec l'activité DMX : il **allume** la prise dès qu'un projecteur surveillé bouge, et l'**éteint** après une période de blackout complet. Cas d'usage : la prise alimente physiquement ces projecteurs, on veut donc qu'elle soit sous tension uniquement quand ils servent.

S'abonne à l'évènement `tick` du `DmxService` (même mécanisme que HomeKit et Smart Lights) : `onTick(state)` est appelé à chaque frame (~30 Hz) et ne fait que lire l'univers — le service n'écrit jamais dans le DMX, il ne pilote que la prise.

### Pilotage local LAN (aucun cloud)

`MerossLocalClient` parle le **protocole local Meross** : `POST http://<host>/config` avec une enveloppe JSON `{ header, payload }`. Le `header` est signé : `sign = md5(messageId + key + timestamp)` (où `key` = device key du compte Meross, `messageId` = 16 octets hex aléatoires, `timestamp` = secondes Unix).

| Action | Namespace | Méthode | Payload |
|--------|-----------|---------|---------|
| Allumer/éteindre | `Appliance.Control.ToggleX` | `SET` | `{ togglex: { channel, onoff: 0\|1 } }` |
| Lire l'état | `Appliance.System.All` | `GET` | `{}` → `payload.all.digest.togglex[*].onoff` |

Timeout HTTP de 4 s (AbortController). La prise reste appairée à l'app Maison en parallèle (le protocole local coexiste avec HomeKit/Matter).

### Allumage (déclencheur)

À chaque tick, le service compare les **canaux surveillés** (déclencheurs) à la frame précédente ; tout écart → `ensureOn()`. Canaux surveillés = **tous** les canaux des projecteurs listés dans `MEROSS_TRIGGER_FIXTURES` (défaut `Stairville MH X20`, `Par 56 Lava`, `Par 56 Cafe`), résolus **par nom de projecteur** en canaux DMX absolus (`address + (channel - 1)`), soit 23 canaux.

### Extinction automatique (condition ET)

Si **tous** les canaux de la condition d'extinction restent à 0 **en continu** pendant `offTimeoutMs` (env `MEROSS_OFF_TIMEOUT_MS`, défaut **5 min**) → `ensureOff()` coupe la prise. Le compteur `zeroSince` est armé quand la condition devient vraie et **remis à `null` dès qu'un seul canal repasse > 0** (vrai ET logique). La prise n'est coupée qu'une fois par épisode (`ensureOff` sort tôt si `onState === false`), donc aucun combat contre un rallumage manuel.

Canaux de la condition (`DEFAULT_OFF_CONDITIONS`), résolus **par nom de canal** dans la définition de chaque fixture (13 canaux au total) :

| Projecteur | Adresse | Canaux (nom) | Canaux absolus |
|------------|---------|--------------|----------------|
| Par 56 Lava | 1 | Red, Green, Blue, Full Color, Mode | 1, 2, 3, 4, 6 |
| Par 56 Cafe | 7 | Red, Green, Blue, Full Color, Mode | 7, 8, 9, 10, 12 |
| Par 56 Lampe | 25 | Master | 32 |
| Stairville MH X20 | 13 | Shutter, Dimmer | 19, 20 |

> Asymétrie volontaire : `Par 56 Lampe` figure dans la **condition d'extinction** (sa présence empêche la coupure) mais **pas** dans les déclencheurs d'allumage — utiliser uniquement la Lampe ne rallume donc pas la prise.

### Machine à états (état interne)

- `onState: boolean | null` — état cru de la prise (`null` = inconnu au démarrage).
- `reachable: boolean | null`, `lastError: string | null` — diagnostic réseau (exposés à l'UI).
- `zeroSince: number | null` — instant depuis lequel la condition d'extinction est remplie.
- `lastValues[] / offValues[]` — dernières valeurs des canaux surveillés / d'extinction.
- `primed` — le **1er tick** ne fait qu'établir la référence (un redémarrage backend, univers restauré, ne déclenche donc ni allumage ni extinction).
- Garde-fous d'envoi communs à `ensureOn`/`ensureOff` : un seul appel HTTP en vol (`inflight`), backoff 2 s après échec (`nextAttemptAt`), et pour l'allumage une ré-affirmation au plus toutes les `reassertMs` (env `MEROSS_PLUG_REASSERT_MS`, défaut 30 s) tant que la prise est crue allumée.

### Configuration & cycle de vie

- Config persistée en base (`MerossConfig` singleton : `enabled`, `host`, `key`, `channel`) via `store.getMerossConfig(seed)` / `saveMerossConfig(patch)`. Les variables `MEROSS_PLUG_*` ne servent qu'à **amorcer** la 1re ligne (base vide).
- `reconfigure(config)` applique une nouvelle config **à chaud** (reconstruit le client, ré-interroge l'état) — pas de redémarrage backend nécessaire.
- `syncFixtures(fixtures)` re-résout déclencheurs + condition d'extinction à chaque mutation de projecteur (appelé depuis les routes fixtures).
- `getStatus()` (→ `GET /api/meross`) et `testConnection()` (→ `POST /api/meross/test`) alimentent la carte Réglages, qui affiche aussi le compte à rebours d'extinction (`offCountdownMs`).

---

## Parser QXF (`backend/src/services/qxf.ts`)

QXF = format XML de définition de projecteur QLC+.

**Fonction principale : `parseQxf(xml: string): QxfParseResult`**
- Utilise `fast-xml-parser`
- Extrait : manufacturer, model, modes (name + channels)
- Résolution des capabilities : preset → group → name → "other"

**`buildFixtureFromQxf(parsed, options)`**
- Construit un `FixtureInput` depuis le résultat du parsing
- Valide les numéros de canaux (1–512), détecte les doublons

**Bibliothèque QXF (`qxf-library.ts`) :**
- Télécharge le ZIP depuis GitHub (`mcallegari/qlcplus/resources/fixtures/`)
- Extrait dans `backend/data/fixtures/`
- `listFixtureLibrary()` : énumère et parse tous les `.qxf`
- Cache local : ne re-télécharge que si `POST /api/qxf/library/refresh`

---

## Variables d'environnement

### Backend

| Variable | Défaut | Description |
|----------|--------|-------------|
| `DATABASE_URL` | `"file:./data/lightbridge.db"` | URL SQLite Prisma (chargée depuis `backend/.env`) |
| `DMX_OUTPUT` | `"enttec"` | Mode de sortie DMX : `"artnet"` ou `"enttec"` |
| `DMX_FPS` | `30` | Fréquence des frames DMX (1–60) |
| `DMX_PORT` | auto | Port série Enttec (auto-détection si absent) |
| `ARTNET_HOST` | `"127.0.0.1"` | IP du nœud Art-Net (QLC+) |
| `ARTNET_PORT` | `6454` | Port Art-Net (standard) |
| `ARTNET_UNIVERSE` | `0` | Univers Art-Net |
| `HOMEKIT_ENABLED` | `"false"` | Active le pont HomeKit |
| `HOMEKIT_NAME` | `"LightBridgeDMX Bridge"` | Nom du pont HomeKit |
| `HOMEKIT_PIN` | `"031-45-154"` | PIN de couplage HomeKit |
| `HOMEKIT_USERNAME` | `"11:22:33:44:55:66"` | Adresse MAC du pont |
| `HOMEKIT_PORT` | auto | Port HAP |
| `HOMEKIT_SETUP_ID` | auto | Setup ID HomeKit |
| `HOMEKIT_STORAGE` | `".homekit/"` | Dossier de stockage HAP |
| `MEROSS_PLUG_HOST` | — | **Seed seulement** (1er lancement, base vide) : IP de la prise Meross |
| `MEROSS_PLUG_KEY` | — | **Seed seulement** : device key Meross (signature locale) |
| `THREAD_DATASET` | — | Dataset Thread MeshCoP en hexa, requis par `/api/smart-lights/thread/pair`. **Secret réseau** (contient la clé du maillage) : `backend/.env` uniquement, jamais commité. `dotenv` charge à l'import → redémarrer le backend après ajout |
| `THREAD_SIDECAR_URL` | `http://127.0.0.1:5056` | Base du sidecar HAP/CoAP |
| `MEROSS_PLUG_CHANNEL` | `0` | **Seed seulement** : canal de la prise (0 = Plug Mini) |
| `MEROSS_PLUG_REASSERT_MS` | `30000` | Délai max avant de ré-affirmer l'état « allumé » pendant l'activité DMX |
| `MEROSS_OFF_TIMEOUT_MS` | `300000` | Durée de blackout DMX (tous les canaux d'extinction à 0) avant de couper la prise (5 min) |
| `MEROSS_TRIGGER_FIXTURES` | `Stairville MH X20,Par 56 Lava,Par 56 Cafe` | Noms (CSV) des projecteurs dont un changement DMX rallume la prise |

> La config de la prise (host/key/channel/enabled) est **persistée en base** et réglable depuis l'UI (Réglages → carte Prise Meross). Les variables `MEROSS_PLUG_*` ci-dessus ne servent qu'à **amorcer** la ligne `meross_config` au tout premier démarrage (base vide) ; ensuite la base fait foi.

### Frontend

| Variable | Défaut | Description |
|----------|--------|-------------|
| `VITE_API_BASE` | `` | URL de base API (vide = proxy Vite) |
| `VITE_WS_URL` | auto | Force l'URL WebSocket. Par défaut : `/ws` sur l'origine de la page (`window.location`, protocole `ws`/`wss` aligné) |

---

## Commandes de développement

```bash
# Installation des dépendances (tous les workspaces)
pnpm install

# Démarrage en mode développement (tous les services)
pnpm dev

# Service individuel
pnpm -C backend dev
pnpm -C frontend dev

# Build de production
pnpm build

# Linting + formatage
pnpm lint
pnpm format

# Tests
pnpm test

# Tests backend uniquement (avec couverture)
pnpm -C backend test
```

---

## Services persistants macOS (launchd)

Les deux services tournent en arrière-plan même si VS Code est fermé.

```bash
# Vérifier l'état
launchctl list | grep lightbridge

# Redémarrer le backend
launchctl kickstart -k gui/501/com.lightbridgedmx.backend.dev

# Redémarrer le frontend
launchctl kickstart -k gui/501/com.lightbridgedmx.frontend.dev

# Arrêter définitivement
launchctl bootout gui/501 ~/Library/LaunchAgents/com.lightbridgedmx.backend.dev.plist
launchctl bootout gui/501 ~/Library/LaunchAgents/com.lightbridgedmx.frontend.dev.plist

# Logs en direct
tail -f logs/backend-dev.out.log logs/backend-dev.err.log
tail -f logs/frontend-dev.out.log

# Vérifier les ports
lsof -i :5000
lsof -i :5173
```

**Variables d'environnement launchd (backend) :**
```
DMX_OUTPUT=artnet
ARTNET_HOST=192.168.0.200
ARTNET_UNIVERSE=0
DMX_FPS=30
```

---

## Exposition réseau (reverse proxy)

En plus de `http://192.168.0.200:5173`, le tableau de bord est servi sous un nom de domaine par un **reverse proxy Caddy** tournant sur la même machine.

```
Navigateur ──HTTPS/WSS──► Caddy (:443) ──HTTP/WS──► Vite (:5173) ──proxy──► Fastify (:5000)
```

⚠️ **La config Caddy n'est pas dans le dépôt** : elle vit dans `/usr/local/etc/Caddyfile`, servie par le launchd `homebrew.mxcl.caddy` (`brew services list`), logs dans `/usr/local/var/log/caddy.log`, admin API sur `127.0.0.1:2019`.

Points structurants :

| Sujet | Détail |
|---|---|
| Upstream unique | Caddy ne vise que `:5173`. C'est Vite qui proxie `/api` et `/ws` vers Fastify — pas besoin d'une route dédiée au backend. |
| WebSocket | Traverse deux proxys (Caddy relaie l'upgrade nativement, Vite a `ws: true`). Testé de bout en bout en `wss://`. |
| En-tête `Host` | Vite ≥ 5.4.12 renvoie **403** sur tout `Host` absent de `server.allowedHosts`. Le proxy lui présente donc son propre `IP:port` via `header_up Host {upstream_hostport}` (une IP littérale passe toujours). Le nom réel reste dans `X-Forwarded-Host`. |
| Accès LAN uniquement | Matcher `remote_ip` sur les **plages privées** → sinon page 403. La règle ne peut pas porter sur l'IP publique de la box : en hairpin NAT, les clients du LAN arrivent avec `192.168.0.254`. |
| Let's Encrypt | `/.well-known/acme-challenge/*` est exempté du filtre LAN, sinon le renouvellement du certificat (qui vient d'Internet) prendrait un 403. |

Après édition du Caddyfile :

```bash
caddy validate --config /usr/local/etc/Caddyfile
caddy reload   --config /usr/local/etc/Caddyfile   # rechargement à chaud, sans coupure
```

Les avertissements `Unnecessary header_up X-Forwarded-*` au chargement sont attendus et sans effet.

---

## Conventions de code

### TypeScript
- `strict: true` partout
- Alias de chemin : `@lightbridgedmx/shared` pointe vers `packages/shared/src/index.ts`
- CJS pour le backend (CommonJS), ESM pour le frontend
- Zod pour toute validation aux frontières API (body, params, query)

### Nommage
- Fichiers : `kebab-case.ts`
- Composants React : `PascalCase.tsx`
- Variables/fonctions : `camelCase`
- Constantes : `UPPER_SNAKE_CASE`
- Types/interfaces : `PascalCase`

### Gestion d'erreurs
- Routes backend : throw → `errors.ts` gère la réponse HTTP
- `StoreError` (depuis `store.ts`) : erreur métier avec code HTTP
- Frontend : React Query gère les états loading/error

### Validation
- Toutes les entrées API passent par des schémas Zod (dans `shared/src/index.ts`)
- Ne pas dupliquer les schémas entre frontend et backend

---

## Décisions architecturales importantes

### 1. Port 5000 verrouillé
Le backend **force** le port 5000 et quitte si déjà pris, pour éviter les instances multiples. Ne pas modifier ce comportement.

### 2. Persistance SQLite via Prisma
Les données (fixtures, scènes, presets) sont stockées dans `backend/data/lightbridge.db`. Le schéma est dans `backend/prisma/schema.prisma`. Les champs complexes (channels, steps, payload, profile, homekit) sont sérialisés en JSON (String SQLite). Toutes les méthodes du Store sont async.

### 3. Art-Net via QLC+
Le backend n'écrit **jamais** directement sur l'interface Enttec en production — il envoie en Art-Net vers QLC+ qui fait le bridge. QLC+ doit avoir :
- Input Art-Net Net=0 Subnet=0 Universe=0
- Output → interface DMX matérielle
- Mode "Passthrough" activé

### 4. HomeKit via hap-nodejs
Pas de Homebridge — intégration directe `hap-nodejs`. Le pont crée :
- Des accessories `Lightbulb` pour les projecteurs RGB (capabilities `r/g/b` ou `homekit.dmxChannels` explicite)
- Des accessories multi-services pour les lyres (capabilities `pan`/`tilt` détectées automatiquement) : un `Lightbulb` pour le dimmer/shutter, des `WindowCovering` pour pan, tilt, roue couleur et gobo

Une fixture avec `pan` ou `tilt` est **exclusivement** traitée comme lyre (pas comme Lightbulb RGB, même si elle a aussi des canaux r/g/b).

### 5. Pas d'authentification
L'API n'a pas d'auth. À n'exposer que sur le réseau local (LAN). Ajouter une auth basique si exposition externe requise.

### 6. WebSocket natif (pas Socket.io)
Le package `ws` est utilisé directement côté backend. Pas de namespace, pas de rooms — broadcast simple à tous les clients connectés.

### 7. Smart Lights : backend extensible, deux paths I/O

Le `SmartLightService` est conçu pour accueillir d'autres backends que Nanoleaf (Hue, Matter, hap-controller pour HomeKit en mode client, etc.) — l'union discriminée `SmartLightBackendConfig` se déclare dans `shared/` et le service instancie le client+streamer adapté au type. Pour ajouter un backend :
1. Ajouter une variante au schéma `SmartLightBackendConfigSchema` (ex: `"hue-http"`)
2. Créer `services/smart-lights/hue-client.ts`
3. Étendre `registerInternal()` pour instancier le bon client en fonction de `config.type`

### 8. EffectEngine : pure function, layout 3D requis pour position-aware
L'`EffectEngine` est sans état — il prend `(effect, layout, timeSeconds)` et retourne `RgbColor[]`. Les effets `gradient` et `wave` projettent le **midpoint** de chaque `ZoneSegment` sur une direction 3D normalisée. Le `chase` utilise l'index linéaire de la zone (donc indépendant de la position physique). Le `static` ignore le layout (juste une palette).

### 8bis. Effet `ma` : le moteur paramétrique façon grandMA2

Les cinq effets d'origine sont chacun une animation figée. L'effet `ma` reprend le modèle d'un
pupitre grandMA2, où un effet n'est pas une animation mais **une forme d'onde distribuée sur une
sélection** :

| Réglage | Rôle | Équivalent MA |
|---------|------|---------------|
| `form` | La forme d'onde évaluée par zone | Form (23 formes prédéfinies sur MA) |
| `speed` | Vitesse en BPM (60 BPM = 1 cycle/s) | Speed / Rate |
| `phaseFrom` → `phaseTo` | Retard, en degrés, réparti de la première à la dernière zone | Phase |
| `low` / `high` | Bornes de la sortie | Low value / High value |
| `width` | % du cycle en position haute | Width |
| `attack` / `decay` | Adoucissement des fronts (pwm, random) | Attack / Decay |
| `matricks` | `blocks` (zones solidaires), `groups` (répétitions), `wings` (pliage miroir) | MAtricks |
| `target` | L'attribut piloté : intensité, fondu de couleurs, teinte | Attribut de l'effet |

**C'est la phase, pas la forme, qui fait le motif.** Un créneau (`pwm`) de 12 % avec une phase
répartie 0 → 360 est un chenillard ; le même créneau avec `phaseFrom = phaseTo` est un strobe. Cette
économie de concepts est exactement celle du pupitre, et évite un effet codé en dur par motif.

**Distribution spatiale (`spatial`).** Par défaut la phase se répartit sur le **rang** des zones —
l'ordre de câblage du ruban. Avec `spatial`, elle se répartit sur leur **position réelle**, lue dans
le layout 3D :

| Mode | Grandeur mesurée | Ce que ça donne |
|------|------------------|-----------------|
| `axis` | projection sur une direction 3D | vague verticale, balayage gauche→droite |
| `radial` | distance à un point | onde qui part d'un point et s'éloigne |
| `angular` | azimut autour d'un axe vertical | faisceau qui fait le **tour** de l'objet |

C'est la différence entre « la 12ᵉ LED du ruban » et « la LED qui est en haut à gauche » : sur le
bandeau du meuble TV, une vague verticale allume ensemble les trois niches, quel que soit leur numéro
de zone. Les zones `spare` sont exclues de la mesure de l'étendue (elles sont rangées hors géométrie
et écraseraient min/max).

> **Piège : 360° se replie.** La sortie est périodique, donc une phase étalée sur exactement 360°
> donne à la zone la plus lointaine la valeur de la plus proche. En distribution par rang c'est sans
> conséquence (la dernière zone n'atteint jamais 360°), mais dans l'espace les extrêmes sont atteints.
> Règles : effets directionnels sur **~300°** ; effets **angulaires sur 360°** (l'azimut est cyclique
> par nature, c'est le comportement voulu) ; dégradé fixe dans l'espace = forme **`triangle` sur 180°**,
> qui donne exactement `v = position`.

**Restriction à des sections (`sides`).** Un effet peut ne jouer que sur des sections nommées du
layout (`zoneLayout.sides`) — « les niches seulement », « le tour du bas seulement ». Les zones hors
sélection prennent la valeur basse de l'effet, et l'étendue spatiale n'est mesurée que sur les zones
retenues : un effet limité aux niches se répartit sur les niches, pas sur un ruban dont il n'éclaire
qu'un tiers. Une étiquette inconnue ne filtre rien — un effet qui ne fait rien du tout est un pire
mode de défaillance qu'un effet trop large.

Le pool `SMART_LIGHT_EFFECT_PRESETS` (dans `shared/`) livre 26 points de départ nommés, groupés par
famille : 12 en distribution par rang (`pupitre`), 6 en 3D générique (`3d`), 9 taillés pour la
géométrie relevée du meuble TV (`meuble`). Il est partagé backend/frontend pour ne pas dupliquer la
liste.

**Un effet est une source DMX.** Quand la lampe a un miroir DMX par zone, le moteur publie sa trame
sur ces canaux : l'effet devient visible dans la Fader View et la DMX Sheet, et un « all out » le
reprend. Pour que le miroir ne relise pas la trame comme une commande venue du pupitre — ce qui lui
ferait voler le bandeau à l'effet à la trame suivante — `DmxService` retient **qui a écrit chaque
canal en dernier**, et à quel rang d'écriture. Le moteur vérifie avant chaque trame que personne ne
lui est passé dessus depuis la précédente ; ce contrôle-là ne peut pas se faire à la lecture du tick,
car entre deux ticks l'effet a le temps de recouvrir un blackout.

### 8ter. Layouts : formes types et relevés

`buildLinearLayout`, `buildUShapeLayout` et `buildRoomLoopLayout` génèrent des **formes types** à
partir de quelques nombres. Une géométrie réelle n'entre pas toujours dans une forme type : le
bandeau du salon suit le contour d'un meuble TV, avec trois niches, des passages cachés entre elles
et deux longueurs de côté différentes.

`buildPathLayout({ legs, spareZones })` couvre ce cas : on décrit le **chemin réel du ruban**,
tronçon par tronçon (nom, nombre de zones, extrémités 3D), et les zones de chaque tronçon se
répartissent régulièrement entre ses extrémités. Un tronçon nommé devient une section (`sides`) que
les effets savent viser. Le relevé lui-même se fait au ZonePainter (peindre une couleur par section,
appliquer, puis lire le bloc miroir DMX).

### 9. Lazy-loading du 3D editor
Le `LayoutEditor3D` (React Three Fiber + drei + three) pèse ~600 KB minifié. Il est chargé en lazy via `React.lazy(() => import("./smart-lights/LayoutEditor3D"))` + `Suspense` — seul l'utilisateur qui clique sur "📐 Layout 3D" paie le coût de chargement.

### 10. Refresh smart lights : seulement si quiescent
Le refresh périodique (5 s) ne fire que si `now - lastLocalWriteAt > 2 s` ET `computeStateDiff(lastPushed, desired) === null`. Évite d'écraser un slider que l'utilisateur déplace en direct, mais resynchronise dès qu'il s'arrête. Skip aussi quand streaming actif (le streamer owns le device).

---

## Problèmes connus et pièges

### DMX jitter
Si l'interface Enttec est utilisée directement (sans QLC+), régler `latencyTimer` à 1ms. Préférer Art-Net → QLC+ pour éviter le jitter.

### Overlap de canaux DMX
Le store valide qu'aucune fixture ne partage les mêmes canaux. Une erreur 409 est retournée si chevauchement détecté.

### HomeKit UUID
L'UUID d'un accessoire HomeKit est dérivé du `deviceId` de la fixture. Si `deviceId` change, HomeKit crée un nouvel accessoire. Utiliser `deviceId` stable et unique.

### QXF library download
Le premier appel à `/api/qxf/library` peut prendre plusieurs secondes (téléchargement du ZIP GitHub ~50MB). Prévoir un timeout frontend adequat.

### Port 5000 déjà utilisé
```bash
lsof -i :5000
kill -9 <PID>
```

### Nanoleaf pairing — fenêtre 30 s
Le strip refuse `POST /api/v1/new` (HTTP 403) tant qu'il n'est pas en mode pairing. Deux moyens d'y entrer :
1. Maintenir le bouton power ~5–7 s puis relâcher (LED pulse ~30 s)
2. Activer l'option "Se connecter à l'API" dans l'app Nanoleaf (fenêtre 30 s)

Pour absorber le timing serré, le UI peut polling l'endpoint `/api/smart-lights/pair` toutes les 500 ms pendant 30 s. La route convertit le 403 Nanoleaf en HTTP 409 avec message clair.

### Nanoleaf extControl — l'alimentation n'est PAS dans la trame

Une trame extControl ne transporte **que des couleurs** : aucune notion d'allumé/éteint.
Et comme `flushAll()` saute les lampes en streaming, le `on` n'atteint l'appareil **ni en
UDP ni en HTTP**. Un strip dont l'interrupteur maître est resté à `false` reçoit donc nos
trames sans rien afficher — on peint sur un panneau hors tension.

Le piège est qu'il n'y a **aucun symptôme logiciel** : extControl est actif, les trames
partent, `desired.on` peut afficher `true`, et l'API `/api/smart-lights` ne montre rien
d'anormal. Seul un `GET /api/v1/<token>/` sur l'appareil révèle `state.on.value = false`.

**Règle : en streaming, l'appareil reste sous tension en permanence**, et l'extinction
s'exprime par des trames noires — la logique d'un pupitre, où un projecteur reste alimenté
et l'intensité 0 veut dire noir. Implémenté à deux endroits :

- `setStreaming(enabled: true)` → `PUT /state {on:true}` **avant** `enableExtControl()` ;
  une fois en extControl, plus aucune trame ne peut rallumer l'appareil.
- `ensureStreaming()` (watchdog, 10 s) → si `info.state.on === false`, remise sous tension
  puis réactivation de l'extControl (le `PUT` y met fin, la réactivation fait partie de la
  même opération).

> Ne **pas** conditionner cette mise sous tension à `desired.on`. Sur un strip piloté par
> miroir de zones, le DMX possède le bandeau et passe avant la garde `desired.on` : ce
> drapeau ne reflète alors pas ce qu'on envoie réellement, et le watchdog laisse le panneau
> éteint alors qu'on lui pousse des zones. C'est l'erreur commise au premier essai.

### Nanoleaf extControl — frames continues obligatoires
Une fois `extControlVersion=v2` activé, le device sort de extControl après ~250 ms sans frame UDP. Le `NanoleafStreamer` retransmet la dernière frame toutes les 250 ms via un keepalive — sinon le strip retourne à l'effet builtin précédent.

### NL72K3 panelLayout — endpoint absent
L'endpoint `/api/v1/<token>/panelLayout/layout` n'existe pas sur le Lightstrip Essentials (404). On découvre les 50 zones empiriquement en streamant et observant. Pour d'autres modèles Nanoleaf (Lines, Shapes, Canvas) cet endpoint existe et donne les `panelId` + positions.

### Ampoules Thread : sept pièges documentés à part

Le reset régénère le Device ID HAP, `aiohomekit` a un bug dans `async_find()`, `aiocoap`
n'active pas `udp6` hors Linux, `save_data()` ne sérialise que les alias du contrôleur de
haut niveau… Chacun coûte un reset matériel si on le découvre trop tard.
**Tout est dans `tools/homekit-thread/README.md` §7** — ne pas les redécouvrir.

### Smart Lights : streaming + Apple Home conflict
Quand notre `NanoleafStreamer` est actif (extControl mode), Apple Home perd temporairement la possibilité de modifier le strip — le streaming "owns" l'output. C'est attendu. Pour rendre la main à HomeKit/Nanoleaf app, désactiver le streaming via UI ou `POST /streaming` avec `enabled: false` — le service revient à HTTP coalescé.

**La bonne réponse n'est pas d'arbitrer ce conflit, mais de le supprimer** : retirer la lampe
de l'app Maison et la ré-exposer **par le pont LightBridge**. Une commande venue de Maison
traverse alors `applyState()` et ressort en trame UDP, jamais en `PUT /state` — or c'est ce
`PUT` qui met fin à l'extControl. Le conflit disparaît par construction, et le chien de garde
(`ensureStreaming`, 10 s) ne sert plus que si une app tierce force un `PUT` depuis l'extérieur.

Corollaire pour le choix de la façade DMX : sur un strip en streaming, préférer le **miroir par
zone** (3 canaux RVB × N zones) au miroir uniforme. Il parle le même langage que la trame UDP,
sans conversion intermédiaire, et c'est lui qui rend les 30 Hz exploitables depuis la console.

### WebSocket derrière un reverse proxy HTTPS — Mixed Content
Si le client WebSocket produit une URL `ws://` en dur (ou vise le port 5000 directement), une page servie en HTTPS échoue avec `SecurityError: Failed to construct 'WebSocket'` + `Mixed Content: ... attempted to connect to the insecure WebSocket endpoint`. L'exception peut laisser toute l'interface vide. L'URL doit **suivre l'origine de la page** : `wss` si `location.protocol === "https:"`, et `location.host` (avec son port) — jamais `location.hostname` seul. Voir [WebSocket](#websocket).

### Forward references dans le schéma Zod partagé
Les schémas qui s'utilisent l'un l'autre (ex: `SmartLightSchema` référence `SmartLightZoneLayoutSchema`) **doivent** être déclarés dans l'ordre topologique dans `packages/shared/src/index.ts`. Le type-check passe mais le runtime crash avec `ReferenceError`. Si tu ajoutes un nouveau type composé, mets ses dépendances AU-DESSUS de lui.

---

## Tests

Tests Vitest dans `backend/src/services/homekit-utils.spec.ts` :
- `hsbToRgb()` / `rgbToHsb()` : conversions couleur
- `resolveRgbChannels()` : résolution depuis capabilities ou mapping explicite
- `collectHomeKitLights()` : filtrage fixtures RGB

```bash
pnpm -C backend test             # run une fois
pnpm -C backend test --watch     # mode watch
pnpm -C backend test --coverage  # avec couverture
```

---

## Flux de données complet

```
┌─────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React 18)                         │
│  App.tsx → React Query → api.ts → fetch /api/*                      │
│  useDmxWebsocket → {ws,wss}://<origine de la page>/ws               │
│  ChannelGrid (sliders) → POST /api/universe/:channel                │
│  SmartLightsPanel → POST /api/smart-lights/:id/{state,effect,zones} │
│  LayoutEditor3D (R3F lazy) → POST /api/smart-lights/:id/layout      │
└────────────┬─────────────────────────────────────────┬──────────────┘
             │ HTTP REST + WebSocket                    │
┌────────────▼─────────────────────────────────────────▼──────────────┐
│                       BACKEND (Fastify)                              │
│  routes/ → store.ts (SQLite via Prisma)                             │
│                                                                      │
│  ┌─ DmxService ──────────────────────────────────────────────────┐  │
│  │  applyWrite/setChannel → Universe[512] → push @ N FPS         │  │
│  │  → "tick" event ────────────────────────────────────────────┐ │  │
│  └──────────────────────────────────────────────────────────────┼─┘  │
│  ┌─ HomeKitBridge (hap-nodejs) ─────────────────────────────┐  │    │
│  │  mirror RGB + moving heads from DMX tick ←──────────────┐│  │    │
│  └──────────────────────────────────────────────────────────┼┼──┘   │
│  ┌─ SmartLightService ──────────────────────────────────────┘  │   │
│  │  DMX-mirror tick listener ← (writes desired from R/G/B chans)│   │
│  │  flushAll() @ 33Hz → HTTP PUT /state (coalesce + rate-limit) │   │
│  │  streamAll() @ 30Hz → UDP extControl frame per zone          │   │
│  │  refreshAll() @ 0.2Hz if quiescent → device GET, update state│   │
│  │  EffectEngine.evaluate(effect, layout, time) → RgbColor[]    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  WebSocket → broadcast universe_tick / smart_light_updated / etc.    │
└────┬──────────────────────────────────────────────────┬─────────────┘
     │ Art-Net (UDP:6454)                               │ HTTP :16021 + UDP :60222
┌────▼──────────────────────────┐         ┌─────────────▼──────────────┐
│         QLC+ (externe)         │         │      Nanoleaf NL72K3        │
│  In Art-Net → Out Enttec USB  │         │  Lightstrip Essentials      │
└────────────┬───────────────────┘         │  50 zones LED addressables  │
             │ DMX512                       └────────────────────────────┘
┌────────────▼──────────────────────────────┐
│      Projecteurs DMX (fixtures)            │
│  PAR LED RGB, lyres, dimmers, strobes...   │
└────────────────────────────────────────────┘

                                            ┌──────────────────────────┐
                                            │  Apple Home app          │
                                            │  ← HomeKitBridge (HAP)   │
                                            └──────────────────────────┘
```

