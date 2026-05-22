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
│   │   │   ├── dance.ts               ← Dance mode (strobe coordonné par pièce, patterns spatiaux)
│   │   │   ├── homekit.ts             ← pont HomeKit (hap-nodejs, Lightbulb + WindowCovering)
│   │   │   ├── homekit-utils.ts       ← utilitaires (HSB↔RGB, résolution canaux RGB + moving head)
│   │   │   ├── homekit-utils.spec.ts  ← tests Vitest
│   │   │   ├── qxf.ts                 ← parser XML QXF (définitions projecteurs QLC+)
│   │   │   ├── qxf-library.ts         ← gestionnaire bibliothèque QXF (téléchargement GitHub)
│   │   │   └── smart-lights/          ← service Smart Lights (Nanoleaf et au-delà)
│   │   │       ├── index.ts           ← SmartLightService (registry, HTTP coalesce + UDP stream, refresh)
│   │   │       ├── nanoleaf-client.ts ← client HTTP OpenAPI Nanoleaf (pair, setState, effects, CT)
│   │   │       ├── nanoleaf-streamer.ts ← streamer UDP extControl v2 (port 60222, keepalive 4 Hz)
│   │   │       ├── effect-engine.ts   ← evaluator pure pour 5 effets (static/solid/gradient/chase/wave)
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
│   │       ├── dance.ts               ← /api/dance/state + config + start/stop
│   │       └── smart-lights.ts        ← /api/smart-lights (CRUD, pair, state, streaming, effects, layout, discover)
│   └── .homekit/                      ← stockage HAP (pairage, identifiants)
├── frontend/
│   ├── package.json
│   ├── vite.config.ts                 ← proxy /api et /ws vers :5000
│   ├── src/
│   │   ├── main.tsx                   ← bootstrap React + QueryClient
│   │   ├── App.tsx                    ← wrap AppDataProvider + AppShell (12 lignes)
│   │   ├── shell/                     ← navigation par onglets responsive
│   │   │   ├── AppShell.tsx           ← layout racine : Header + TabBar + page active + BottomNav
│   │   │   ├── TabBar.tsx             ← top bar desktop/tablet, cachée <640px
│   │   │   ├── BottomNav.tsx          ← bottom nav iOS-style mobile, cachée ≥640px, safe-area-inset
│   │   │   ├── tabs.ts                ← source unique des 5 onglets (TabDef + icônes lucide)
│   │   │   ├── useHashTab.ts          ← hook routing par hash URL (#dashboard, #live, etc.)
│   │   │   └── navigate.ts            ← helper setActiveTabHash() pour liens internes
│   │   ├── contexts/
│   │   │   ├── AppDataContext.tsx     ← provider central — queries, mutations, WS handlers, log history
│   │   │   └── UniverseStateContext.tsx ← context isolé pour universeState (30 Hz ticks)
│   │   ├── pages/                     ← une page par onglet (consomment useAppData / useUniverseState)
│   │   │   ├── DashboardPage.tsx      ← tuiles statut + HomeKit + Dance + Quick Actions + log history
│   │   │   ├── FixturesPage.tsx       ← FixtureForm + QxfLibraryPanel + FixturesTable
│   │   │   ├── SmartLightsPage.tsx    ← pills filtre backend + SmartLightsPanel
│   │   │   ├── LivePage.tsx           ← ChannelGrid + DancePanel + ScenesSection (lazy via React.lazy)
│   │   │   └── SettingsPage.tsx       ← HomeKitCard + cartes Système / Variables backend
│   │   ├── components/
│   │   │   ├── Header.tsx             ← titre + icône Zap + badge statut WebSocket
│   │   │   ├── StatusCards.tsx        ← 4 cartes : univers, fixtures, scènes, activité (legacy, gardé)
│   │   │   ├── FixtureForm.tsx        ← formulaire création manuelle de fixture
│   │   │   ├── FixturesTable.tsx      ← liste fixtures + suppression + data-label pour mobile cards
│   │   │   ├── ChannelGrid.tsx        ← grille 512 canaux (8 → 6 → 4 colonnes selon viewport)
│   │   │   ├── QxfLibraryPanel.tsx    ← navigateur bibliothèque QXF + import
│   │   │   ├── HomeKitCard.tsx        ← statut HomeKit + QR code + PIN
│   │   │   ├── DancePanel.tsx         ← config + contrôle du Dance mode
│   │   │   ├── ScenesSection.tsx      ← liste scènes (placeholder)
│   │   │   ├── SmartLightsPanel.tsx   ← accepte `backendFilter` + `hideSectionTitle` (extensible)
│   │   │   └── smart-lights/
│   │   │       ├── backendRegistry.ts     ← registre extensible (Nanoleaf + futurs Hue/Matter)
│   │   │       ├── ZonePainter.tsx        ← 50 swatches paintable click+drag, presets, fill
│   │   │       ├── EffectDesigner.tsx     ← onglets solid/gradient/chase/wave + sliders live
│   │   │       └── LayoutEditor3D.tsx     ← React Three Fiber, sphères 3D draggables, lazy-loaded
│   │   ├── hooks/
│   │   │   └── useDmxWebsocket.ts     ← hook WS (universe_tick, fixture_updated, smart_light_updated, dance_state) + logHistory rolling 10
│   │   └── lib/
│   │       ├── api.ts                 ← client fetch + wsUrl()
│   │       ├── fixtures.ts            ← couleurs par fixture, canaux visibles, canaux actifs
│   │       ├── fixtureTemplates.ts    ← templates prédéfinis (rgb, rgbw, dimmer)
│   │       └── math.ts               ← clamp(), addAlpha()
└── packages/
    └── shared/
        └── src/
            └── index.ts               ← tous les schémas Zod + types TypeScript partagés
```

---

## Architecture UI (frontend)

Navigation **par onglets**, responsive (desktop / tablet / mobile <640px), routing par hash URL sans dépendance.

### 5 onglets

| Onglet | Hash | Composant page | Contenu |
|--------|------|----------------|---------|
| **Tableau de bord** | `#dashboard` | `pages/DashboardPage.tsx` | Tuiles Univers / Fixtures / Scènes / HomeKit / Dance + Quick Actions (Blackout, Stop Dance, Refresh QXF) + Activity log (10 derniers événements) |
| **Projecteurs** | `#projecteurs` | `pages/FixturesPage.tsx` | `FixtureForm` + `QxfLibraryPanel` + `FixturesTable` |
| **Lampes connectées** | `#lampes` | `pages/SmartLightsPage.tsx` | Pills filtre backend (Tous / Nanoleaf / futurs Hue / Matter) + `SmartLightsPanel` |
| **Live** | `#live` | `pages/LivePage.tsx` (lazy) | Ancres Console / Dance / Scènes + `ChannelGrid` + `DancePanel` + `ScenesSection` |
| **Réglages** | `#reglages` | `pages/SettingsPage.tsx` | `HomeKitCard` (QR + PIN + mappings) + cartes Système / Variables backend |

### Navigation responsive

- **Desktop / tablet (≥640px)** : `shell/TabBar.tsx` — barre horizontale d'onglets en haut avec icônes lucide-react.
- **Mobile (<640px)** : `shell/BottomNav.tsx` — bottom nav fixe avec `env(safe-area-inset-bottom)` pour iPhone notch, `backdrop-filter: blur`. La TabBar du haut est masquée.
- Routing : `shell/useHashTab.ts` (state + `hashchange` listener). Deep-link `#live` rend la page directement au premier paint (hash lu en synchrone dans le `useState` initializer).

### State management

Deux contexts pour **isoler les re-renders haute fréquence** :

- `contexts/AppDataContext.tsx` — Provider central. Possède toutes les queries (`fixtures`, `scenes`, `library`, `homekit`), mutations (create/import/delete/refresh/setChannel), handlers WS, `wsBadge`, `logMessage`, `logHistory` (rolling 10), `handleBlackout`. Value mémoizé pour ne pas réagir aux ticks `universe_tick`.
- `contexts/UniverseStateContext.tsx` — Provider isolé pour `universeState` (broadcast 30 Hz). Seuls `ChannelGrid` (Live tab) et la tuile "canaux actifs" du Dashboard s'abonnent → les ticks ne re-render PAS les autres pages.
- WebSocket monté **une seule fois** dans `AppDataProvider` → survit aux changements d'onglet.

### Extensibilité Smart Lights

`components/smart-lights/backendRegistry.ts` — registre central des backends affichables :

```ts
export const SMART_LIGHT_BACKENDS = [
  { id: "nanoleaf-http", label: "Nanoleaf", icon: Lightbulb, description: "…" }
  // Ajout futur : { id: "hue", label: "Philips Hue", icon: ..., ... }
];
```

`SmartLightsPanel` accepte une prop `backendFilter` ; la page consomme `SMART_LIGHT_BACKENDS` pour rendre les pills de filtre. Ajouter une ampoule Nanoleaf Essentials / Hue / Matter = ajouter une entrée + nouveau type dans `SmartLight.config.type` (discriminated union dans `shared/`).

### CSS responsive (`frontend/src/styles.css`)

- Breakpoints : `<640px` (mobile) / `640-1023px` (tablet) / `≥1024px` (desktop, contenu capé à 1200px).
- `.channels` : `repeat(8, …)` → `repeat(6, …)` → `repeat(4, …)`.
- `.table` se transforme en cartes empilées sur mobile via `data-label="…"` + pseudo-elements (pas de composant dupliqué).
- Classes utilitaires : `.grid-span-full`, `.dashboard-grid`, `.quick-actions-grid`, `.activity-list`, `.kv` (key/value list), `.anchor-nav`, `.live-section`, `.filter-pills`, `.tabbar-item`, `.bottomnav-item`.

### Dépendances frontend

- `lucide-react` — icônes (`LayoutDashboard`, `Sliders`, `Lightbulb`, `Sparkles`, `Settings`, `Zap`, `Power`, `Square`, `RefreshCw`).
- React Query 4, three.js + @react-three/fiber/drei (lazy dans `LayoutEditor3D`), qrcode.react.

---

## État applicatif

L'état est persisté dans **SQLite via Prisma**. Il est géré par `backend/src/state/store.ts` (toutes les méthodes sont async). Le fichier de base de données se trouve dans `backend/data/lightbridge.db`.

### Entités

| Entité | Clé | Description |
|--------|-----|-------------|
| `fixtures` | UUID | Projecteurs DMX (adresse 1–512, canaux, profil QXF, config HomeKit, pièce) |
| `scenes` | UUID | Scènes (liste d'étapes fixture → valeurs) |
| `presets` | UUID | Presets (mapping canal → valeur) |
| `smart_lights` | UUID | Lampes WiFi (Nanoleaf etc.) — backend, config, mirror DMX, layout 3D, effet courant |
| `dance_config` | singleton | Config du Dance mode (pièces, patterns, intervalles, lyre) |
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
  | { type: "dance_state"; data: DanceState }
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

// Mirror DMX : lier des canaux DMX à la lampe pour la piloter via scènes / Dance / sliders
interface SmartLightDmxMirror {
  universe?: number;
  rChannel?: number; gChannel?: number; bChannel?: number;
  briChannel?: number;
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
| `PUT` | `/api/fixtures/:id` | `Partial<FixtureInput>` | Modifie un projecteur |
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
| `POST` | `/api/universe/:channel` | `{ value: 0–255 }` | Définit la valeur d'un canal |
| `POST` | `/api/test/fixtures/:id` | `{ values: number[] }` | Teste un projecteur avec les valeurs données |

### Bibliothèque QXF

| Méthode | Endpoint | Corps | Description |
|---------|----------|-------|-------------|
| `GET` | `/api/qxf/library` | — | Liste les fichiers QXF disponibles (télécharge si absent) |
| `POST` | `/api/qxf/library/refresh` | — | Force le re-téléchargement depuis GitHub |

### Dance mode

| Méthode | Endpoint | Corps | Description |
|---------|----------|-------|-------------|
| `GET` | `/api/dance/state` | — | État courant (config, running, fixtures actives, pattern) |
| `PUT` | `/api/dance/config` | `Partial<DanceConfig>` | Met à jour la config (pièces, intervalles, patterns) |
| `POST` | `/api/dance/start` | — | Démarre la boucle Dance |
| `POST` | `/api/dance/stop` | — | Arrête la boucle |

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
| `POST` | `/api/smart-lights/:id/streaming` | `{ enabled, zoneCount? }` | Active/désactive le streaming UDP extControl |
| `POST` | `/api/smart-lights/:id/zones` | `{ zones: [{index,r,g,b,w?}] }` | Push direct un palette par-zone (requiert streaming actif) |
| `POST` | `/api/smart-lights/:id/layout` | `SmartLightZoneLayout \| null` | Sauvegarde le placement 3D des zones |
| `POST` | `/api/smart-lights/:id/effect` | `SmartLightEffectConfig \| null` | Active un effet position-aware (l'EffectEngine prend le relais) |
| `GET` | `/api/smart-lights/:id/effects` | — | Liste les effets builtin du device (Nanoleaf) |
| `POST` | `/api/smart-lights/:id/effects/select` | `{ name }` | Active un effet builtin Nanoleaf (sort du mode streaming si actif) |
| `POST` | `/api/smart-lights/probe` | `{ host, port? }` | Test rapide de reachability sans pairing |
| `POST` | `/api/smart-lights/discover` | `{ timeoutMs? }` | Scan mDNS (~3 s par défaut) — retourne les Nanoleaf trouvés |

### Système

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/health` | Healthcheck (retourne `{ ok: true }`) |
| `GET` | `/api/homekit` | Statut HomeKit (enabled, setupUri, fixtures, QR code) |
| `GET` | `/api/rooms` | Liste des pièces (union des fixtures et smart lights ayant `room`) |
| `WS` | `/ws` | WebSocket temps réel |

---

## WebSocket

**Connexion :** `ws://localhost:5000/ws` (en dev)

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

// État Dance mode (config + running + fixtures actives + pattern courant)
{ "type": "dance_state", "data": { ...DanceState } }

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

---

## Service Smart Lights (`backend/src/services/smart-lights/`)

Pilote des lampes WiFi (Nanoleaf en V1, extensible) avec deux paths de sortie, mirror DMX bidirectionnel, effets position-aware en 3D et discovery mDNS.

### Composants

| Fichier | Rôle |
|---------|------|
| `nanoleaf-client.ts` | Client HTTP OpenAPI Nanoleaf (`pair`, `getInfo`, `setState`, `setCt`, `listEffects`, `selectEffect`, `enableExtControl`). Erreurs typées via `NanoleafApiError`. |
| `nanoleaf-streamer.ts` | Streamer UDP extControl v2 — socket `node:dgram`, frame format `[panelCount:u16BE]([panelId:u16BE][R][G][B][W][transitionMs/100:u16BE])×N`, keepalive 4 Hz. |
| `effect-engine.ts` | Pure function `evaluateEffect(config, layout, time) → RgbFrame[]`. 5 effets : `static`, `solid`, `gradient`, `chase`, `wave`. Effets position-aware utilisent le milieu de chaque `ZoneSegment` projeté sur une direction 3D. |
| `discovery.ts` | Scan mDNS via `bonjour-service` sur `_nanoleafapi._tcp`. Window configurable (~3 s par défaut). |
| `index.ts` | `SmartLightService` — registry, tick loops, DMX mirror listener, refresh périodique, dispatch effet/streaming/HTTP. |

### Paths de sortie (priorité)

À chaque flush, pour chaque light, dans cet ordre :

1. **EffectEngine** — si `light.currentEffect` est défini ET `streaming.enabled = true` : engine évalue l'effet contre le layout 3D, push une frame per-zone via le streamer (~30 Hz)
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

Si `light.dmxMirror = { rChannel, gChannel, bChannel, briChannel }` est défini, le service écoute `dmx.on("tick")` et lit ces canaux dans l'univers à chaque tick. Conversion RGB → HSV → push dans `desired` (qui sera flush au prochain tick HTTP ou stream). Permet d'inclure une smart light dans les scènes, le Dance mode et les sliders du `ChannelGrid` de manière transparente.

### Méthodes principales du SmartLightService

| Méthode | Rôle |
|---------|------|
| `register(light)` | Ajoute ou remplace une light dans le registry, initialise le client et le streamer si configuré |
| `unregister(id)` | Stoppe le streamer et supprime du registry |
| `applyState(id, patch)` | Met à jour `desired` depuis un patch (rgb / hue / sat / brightness / ct / on), trigger flush |
| `applyZones(id, palette)` | Push direct un palette per-zone (requiert streaming actif) |
| `selectEffect(id, name)` | Sélectionne un effet builtin Nanoleaf (sort du streaming) |
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

### Frontend

| Variable | Défaut | Description |
|----------|--------|-------------|
| `VITE_API_BASE` | `` | URL de base API (vide = proxy Vite) |
| `VITE_WS_URL` | auto | URL WebSocket (auto depuis `window.location`) |

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

### Nanoleaf extControl — frames continues obligatoires
Une fois `extControlVersion=v2` activé, le device sort de extControl après ~250 ms sans frame UDP. Le `NanoleafStreamer` retransmet la dernière frame toutes les 250 ms via un keepalive — sinon le strip retourne à l'effet builtin précédent.

### NL72K3 panelLayout — endpoint absent
L'endpoint `/api/v1/<token>/panelLayout/layout` n'existe pas sur le Lightstrip Essentials (404). On découvre les 50 zones empiriquement en streamant et observant. Pour d'autres modèles Nanoleaf (Lines, Shapes, Canvas) cet endpoint existe et donne les `panelId` + positions.

### Smart Lights : streaming + Apple Home conflict
Quand notre `NanoleafStreamer` est actif (extControl mode), Apple Home perd temporairement la possibilité de modifier le strip — le streaming "owns" l'output. C'est attendu. Pour rendre la main à HomeKit/Nanoleaf app, désactiver le streaming via UI ou `POST /streaming` avec `enabled: false` — le service revient à HTTP coalescé.

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
│  useDmxWebsocket → ws://localhost:5000/ws                           │
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
│  ┌─ DanceService ──────────────────────────────────────────┐│  │   │
│  │  scheduler → applyWrite() on grouped DMX channels       ││  │   │
│  └──────────────────────────────────────────────────────────┘│  │   │
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

