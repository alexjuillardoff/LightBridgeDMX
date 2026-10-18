# LightBridgeDMX — nouvelle interface « grandMA3 onPC » : cahier des charges

Ce document est le contrat commun de tous les agents qui construisent la nouvelle interface.
Il est écrit en français ; les termes du pupitre (Fixture, Dimmer, Store, Go…) restent en anglais
comme sur un vrai grandMA3. **Le code est commenté en français** (convention du dépôt).

Dépôt : `/Users/alex/LightBridgeDMX` (monorepo pnpm). Référence technique : `DEVELOPMENT.md`
(lire les sections « Architecture UI », « API REST complète », « WebSocket », « Moteur d'effets DMX »).
Ancienne interface (grandMA2, supprimée) relisible avec `git -C /Users/alex/LightBridgeDMX show 24c1176:frontend/src/<fichier>` —
liste des fichiers : `git -C /Users/alex/LightBridgeDMX ls-tree -r --name-only 24c1176 -- frontend/src`.
On peut s'en inspirer (parseur, programmer, knob, fader, fenêtre Effets) mais **pas** reprendre son look (skin MA2).

---

## 0. Objectif

Reproduire, dans `frontend/` (React 18 + Vite 5 + TypeScript strict, **aucune dépendance nouvelle**
hormis `vitest` en devDependency), l'apparence et l'ergonomie de **grandMA3 onPC 2.5** telles que sur
la capture `frontend/docs/ref/` (voir §1), et y brancher le backend LightBridge (REST + WebSocket) :
sélection de projecteurs, encodeurs, ligne de commande, scènes (executors), groupes, presets,
phasers (moteur d'effets DMX), patch, appareils, réglages.

L'interface est servie par le dev server Vite (:5173, launchd) derrière Caddy sur
`https://light.alexjuillard.fr` — tout chemin réseau est **relatif à l'origine de la page**.

---

## 1. Référence visuelle

Captures (fichiers PNG, à regarder avec l'outil Read) dans
`frontend/docs/ref/` :

| Fichier | Contenu |
|---|---|
| `controlbar.png` | barre de contrôle verticale gauche (11 boutons) |
| `cmdline.png` | ligne de commande (◀, MA, clavier, `Admin[Fixture]>`, icônes droite, ▶) |
| `encbar-left.png` | encoder bar gauche : Sync / Single Step / Align / Readout, groupes 1-4, « Dimmer 1 of 1 », « Link Values Single », « Values and Timings », encodeurs Dim / Max. |
| `encbar-mid.png` | groupes 5-8, « Phaser Overall / Phaser Steps », ▶, « Absolute / Relative » |
| `encbar-right.png` | Selection / Phaser / MAtricks / Prog Time / Exec Time, « Fade / Delay », barre de pas ◀ 1 ▶ ⟳, encodeurs d'écran (Screen Y / Screen X, Display 1), Grand Master 100 % |
| `viewbar.png` | barre de vues droite : 7 boutons (1 View 1, 2 View 2, 3…7 vides), icône œil |

Capture complète d'origine : `frontend/docs/ref/grandma3-onpc-empty.png`
(3824×2306, fenêtre onPC de ~3600×2090 px, soit ~1880×1090 affichés).

### 1.1 Géométrie (fenêtre 1920×1080 ; tout en `rem`, 1 rem = 16 px × `--ui-scale`)

```
┌──┬───────────────────────────────────────────────────────────┬─────┐
│C │                                                           │ V   │  C = control bar  3.25rem de large
│o │             zone utilisateur (fenêtres)                   │ i   │  V = view bar     6.25rem de large
│n │             fond noir, grille de points                   │ e   │
│t │                                                           │ w   │
│  ├───────────────────────────────────────────────────────────┤     │
│  │ ◀ [MA] ⌨ Admin[Fixture]>                  ◯ ⊘ 🌐 ✉ ⌬ ⌨ ▶ │     │  command line  3rem de haut
├──┴───────────────────────────────────────────────────────────┴─────┤
│ Sync │1 Dimmer│2 Position│…│8 Shapers│Selection│Phaser│MAtricks│Prog Time│Exec Time│ Grand  │
│Single│Dimmer 1 of 1│Link Values│Values and Timings│Phaser Overall│Phaser Steps│▶│Absolute│Relative│Fade│Delay│◀ 1 ▶ ⟳│ Master │
│Align │ (◎) Dim      │ (◎) Max.    │ (◎) …         │ (◎) …        │ Screen Y / Screen X │ 100 %  │
│Readout│                                                                                  │        │
└───────────────────────────────────────────────────────────────────────────────────────────┘
                                   encoder bar  15.5rem de haut (3 rangées : 3.5 / 3.5 / 8.5)
```

- Control bar : 11 boutons carrés (≈3.25rem), séparés par de fines bandes ; dernier bouton « At ▽ » en bas.
- View bar : 7 boutons de 6.25rem × 6.75rem, numéro en haut à gauche, œil en haut à droite si une vue est affectée, nom centré.
- Command line : barre sombre à bord clair quand elle a le focus ; à gauche ◀ (cache la control bar), bouton « M A » (historique), icône clavier ; prompt `Admin[Fixture]>` avec `[Fixture]` en jaune ; à droite icônes (cercle barré, micro barré, globe vert, enveloppe orange avec compteur, réseau rouge/vert, « ShCuts ») puis ▶ (cache la view bar).
- Encoder bar (en bas, pleine largeur sous la command line et la view bar, mais **sans** chevaucher la control bar — dans la capture elle commence au bord gauche de l'écran, sous la control bar) :
  - rangée 1 : `Sync` (à bascule, voyant jaune), `1 Dimmer` … `8 Shapers` (groupes de fonctions ; point indicateur en haut à droite : plein jaune si la sélection possède des attributs du groupe), `Selection`, `Phaser`, `MAtricks`, `Prog Time`, `Exec Time` (boutons à trois points « ⋯ » en haut à droite = ouvrent une fenêtre/overlay), colonne `Grand Master` avec `100%`.
  - rangée 2 : `Single Step`, `Dimmer 1 of 1` (page d'encodeurs, ▾), `Link Values / Single` (▾), groupes de couches `Values and Timings` (souligné rouge sombre, actif), `Phaser Overall`, `Phaser Steps` (souligné violet), chevron ▶, couches `Absolute` (rouge sombre, actif), `Relative` (mauve), `Fade` (vert), `Delay` (orange), barre de pas `◀ 1 ▶ ⟳`.
  - rangée 3 : `Align Off` (▾), `Readout Natural` (▾), 4 encodeurs (boîte : étiquette d'attribut en haut, valeur dessous, molette ronde claire à gauche avec 4 points), bloc encodeurs d'écran `Screen Y / Screen X` + `Display 1` (gris, décoratif).

### 1.2 Couleurs mesurées sur la capture (hex)

| Usage | Valeur |
|---|---|
| fond écran / encoder bar | `#000000` |
| points de la grille de l'écran | `#2a2a30` (pas 6.25rem) |
| face des boutons (control bar, encoder bar, view button affecté, fond command line) | `#26262c` |
| face bouton actif/sélectionné (Sync, 1 Dimmer, Values and Timings, Absolute) | `#53535e` |
| face bouton survol | `#35353a` |
| fond view bar / tuile vide | `#151519` |
| bord des boutons | `#0a0a0b` (séparateurs) et `#3a3a42` (liseré léger) |
| texte normal | `#e6e6ea` ; texte secondaire `#9a9aa0` ; numéros de tuiles `#7d7d82` ; icônes `#868688` |
| jaune MA (texte actif, `[Fixture]`, voyants) | `#e2c644` (texte) · `#ecec4e` (prompt) · `#ccb13a` (voyant) |
| soulignés de couches : Absolute/Values | `#731d18` |
| Relative | `#8d415d` |
| Fade | `#377e22` |
| Delay | `#a75e21` |
| Phaser (Overall/Steps) | `#6c397c` |
| molette d'encodeur : anneau `#dddddf`, centre `#87878e`, points `#55555c` ; encodeurs d'écran : `#6e6e6f` sur `#0a0a0b` |
| enveloppe (message center) | `#e08a2b` ; réseau non connecté `#a7261d` ; connecté `#3fa34d` ; globe `#3fa34d` |
| bord de la command line au focus | `#e6e6ea` |

Couleurs système grandMA3 (doc officielle « System colors », à respecter dans les sheets) :

| État | Couleur |
|---|---|
| nom de projecteur non sélectionné | blanc sur noir |
| projecteur sélectionné | **jaune** `#e2c644` sur gris `#3a3a42` |
| valeur à sa valeur par défaut (pas dans le programmer) | gris clair `#b4b4ba` sur `#1a1a1e` |
| valeur **active dans le programmer** | **blanc sur rouge** `#b0282a` |
| valeur dans le programmer mais inactive | texte rouge `#d2433f` sur gris |
| Relative | mauve `#8d415d` · Fade vert `#377e22` · Delay orange `#a75e21` · Phaser violet `#6c397c` |
| projecteur verrouillé (garde chambre) | nom grisé `#6a6a70` + cadenas 🔒, cellules barrées |

Police : `"Roboto", "Helvetica Neue", Helvetica, Arial, sans-serif` (pas de police web externe, l'UI est
LAN-only). Taille de base 0.875rem (14 px) ; boutons de l'encoder bar 1rem ; titres de fenêtre 0.875rem.
Coins légèrement arrondis (0.25rem) sur les boutons, comme sur la capture.

### 1.3 Fenêtres (look MA3)

- Barre de titre : hauteur 1.75rem, fond `#35353a`, à gauche un carré noir « MA » (ouvre les réglages de la
  fenêtre : ici un petit menu « Delete Window / Settings »), titre en blanc, boutons spécifiques à droite,
  **✕** tout à droite pour fermer.
- Corps : fond `#0d0d0f`, bordure 1px `#3a3a42`.
- Pools (Groups, Presets, Sequences/Executors) : grille de tuiles 6rem × 3.5rem, fond `#26262c`, numéro
  en haut à gauche en gris, nom centré en blanc ; tuile vide = fond `#151519` + numéro ; tuile sélectionnée
  = **cadre jaune 2px** ; première tuile du pool = étiquette du pool (ex. « Groups ») sur fond `#3a3a42`.
- Sheets (Fixture Sheet, DMX Sheet, Patch) : en-tête fond `#26262c`, lignes alternées `#0d0d0f` / `#121214`,
  cellules bordées `#2a2a2e`, première colonne figée.
- Écran vide : fond noir + grille de points ; **clic sur une zone vide → dialogue « Add Window »** (comme MA3).

---

## 2. Contraintes et invariants (non négociables)

1. **Garde des projecteurs de la chambre** — liste blanche : un projecteur dont `room` ∈ {chambre, bedroom}
   (insensible à la casse), ou dont le nom matche `/\bchambre\b|\bbedroom\b/i`, ou dont l'id est dans une
   liste nominative, est **verrouillé** : visible (cadenas) mais jamais sélectionnable, jamais écrit
   (le `dmx-writer` refuse ses canaux), exclu des scènes, presets, groupes et phasers. Implémentée dans
   `lib/guard.ts` et appliquée **dans le writer** (point de passage unique) + dans les sélections.
2. **Écritures DMX groupées** : toutes les écritures passent par `state/dmx-writer.ts` : table
   `canal → dernière valeur`, première valeur envoyée immédiatement, puis vidage toutes les 40 ms en **un**
   `POST /api/universe { values: { "12": 255, … } }` ; le minuteur s'arrête quand il n'y a plus rien.
   Jamais un POST par canal / par mouvement.
3. **Univers isolé** : les ticks WebSocket (30 Hz) vont dans un store externe (`useSyncExternalStore` avec
   sélecteur) ; aucun contexte React ne porte les 512 valeurs. Une cellule s'abonne à **son** canal.
4. **URL WebSocket dérivée de l'origine** : `wss:` si `location.protocol === "https:"`, sinon `ws:`, +
   `location.host` + `/ws` (surchargeable par `VITE_WS_URL`). Reconnexion automatique (backoff 1 s → 10 s).
5. **Un master n'atténue que** `intensity / r / g / b / w / uv` : pan, tilt, gobo, roue de couleurs… sont
   rejoués tels quels (executor à 50 % = lumière baissée, lyre immobile).
6. **Aucune dépendance npm nouvelle** (icônes = SVG inline, pas de lucide ; pas de react-query, pas de
   zustand, pas de three). Exception : `vitest` en devDependency pour les tests de logique pure.
7. TypeScript **strict**, ESM, `jsx: react-jsx`. `pnpm -C frontend exec tsc --noEmit -p tsconfig.json` et
   `pnpm -C frontend build` doivent passer. ESLint du dépôt (`frontend/.eslintrc.cjs`) : règles
   react-hooks respectées.
8. Pas d'authentification, LAN only ; pas de `fetch` direct dans les composants : tout passe par `lib/api.ts`.
9. Le backend **n'est pas modifié** par ce chantier (ne pas toucher `backend/`, `packages/shared/`).
10. Ne pas supprimer `frontend/vite.config.ts`, `index.html`, `main.tsx` (adapter si besoin).
11. **Ne pas allumer de matériel pour tester** : les tests se font par `tsc`, `vitest`, `vite build` et
    lecture de l'API en GET. Aucun POST vers `/api/universe`, `/api/scenes/*/activate`, `/api/effects/run`
    pendant le développement (le plateau est réel et quelqu'un peut dormir à côté).

---

## 3. Arborescence cible (`frontend/src/`) et propriétaires

```
src/
  main.tsx                      bootstrap (existant, à conserver)
  App.tsx                       monte les providers/stores + <Shell/>            [intégration]
  theme.css                     tokens, reset, composants de base MA3           [chrome]
  lib/
    api.ts                      client REST typé + wsUrl()                      [core]
    guard.ts                    garde chambre (lockReason / isLocked / unlocked) [core]
    patch.ts                    FID, tri, span, canaux absolus par capability    [core]
    attributes.ts               groupes de fonctions MA3 ↔ capabilities, labels, readout [core]
    scenes.ts                   captureScene / applySceneAtLevel / sceneChannels [core]
    local-store.ts              readLocal / writeLocal (localStorage, préfixe `lb3.`) [core]
    store.ts                    createStore<T>() + useStore(selector)            [core]
    command/
      parse.ts                  parseCommand(text) → Command | error             [core]
      execute.ts                executeCommand(cmd) → CommandResult              [core]
      help.ts                   COMMAND_HELP (lignes d'aide, FR)                 [core]
      parse.spec.ts             tests Vitest                                     [core]
  state/
    universe.ts                 store des 512 canaux + hooks par canal           [core]
    app.ts                      fixtures/scenes/presets/smartLights/effects/ws/logs [core]
    dmx-writer.ts               écritures groupées + garde + écho local          [core]
    programmer.ts               sélection, valeurs actives, groupe/couche/readout, GM [core]
    playback.ts                 executors (scènes), groupes, pools de presets    [core]
    workspace.ts                vues, fenêtres, barres visibles, overlays, échelle [core]
    realtime.ts                 ouverture WS + dispatch des événements           [core]
  shell/
    Shell.tsx                   grille générale (control bar / écran / view bar / cmdline / encoder bar) [chrome]
    ControlBar.tsx              11 boutons + overlays associés                   [chrome]
    ViewBar.tsx                 7 boutons de vue (+ store view par appui long / clic droit) [chrome]
    CommandLine.tsx             saisie, historique, prompt, icônes d'état        [chrome]
    EncoderBar.tsx              3 rangées + Grand Master (+ variante « command wing bar ») [chrome]
    Encoder.tsx                 molette + boîte d'attribut (drag vertical, molette souris, clavier) [chrome]
    Screen.tsx                  zone utilisateur : grille 24×16, fenêtres, Add Window [chrome]
    WindowFrame.tsx             cadre MA3 (titre, MA, boutons, ✕, drag/resize)   [chrome]
    AddWindowDialog.tsx         catégories + tuiles                              [chrome]
    overlays/                   AtOverlay, MasterControls, CommandSection (clavier virtuel), Displays, ShutdownMenu, MainMenu, MessageCenter, Calculator [chrome]
    icons.tsx                   SVG inline (power, gear, views, faders, …)       [chrome]
  windows/
    registry.ts                 kind → module (title, category, size, Component) [chrome ; figé ensuite]
    types.ts                    WindowModule, WindowProps                        [chrome]
    fixture-sheet/index.tsx     [fenêtre A]
    layout/index.tsx            [fenêtre B]
    groups/index.tsx            [fenêtre C]
    presets/index.tsx           [fenêtre C]
    executors/index.tsx         [fenêtre D]
    phaser/index.tsx (+ fichiers) [fenêtre E]
    dmx-sheet/index.tsx         [fenêtre F]
    patch/index.tsx             [fenêtre G]
    devices/index.tsx           [fenêtre G]
    setup/index.tsx             [fenêtre H]
    help/index.tsx              [chrome]
    color-picker/index.tsx      [fenêtre C]
```

Chaque module de fenêtre exporte par défaut un `WindowModule` (§6.0). Le chrome crée un **stub** pour chaque
fenêtre (titre + « fenêtre en construction ») ; les agents de la phase 2 remplacent uniquement leur fichier.

---

## 4. Modèle d'état (contrat du « core »)

### 4.1 `lib/store.ts`

```ts
export type Store<T> = {
  get(): T;
  set(next: T | ((prev: T) => T)): void;        // remplace l'état (immutable) et notifie
  subscribe(listener: () => void): () => void;
};
export function createStore<T>(initial: T): Store<T>;
/** Abonnement sélectif : ne re-rend que si `selector(state)` change (Object.is, ou `equal`). */
export function useStore<T, S>(store: Store<T>, selector: (s: T) => S, equal?: (a: S, b: S) => boolean): S;
export const shallowEqual: (a: unknown, b: unknown) => boolean;   // tableaux/objets plats
```

### 4.2 `state/universe.ts`

```ts
export type UniverseSnapshot = { values: number[]; fps: number; timestamp: string; received: boolean };
export const universeStore: Store<UniverseSnapshot>;      // values : 512 entrées, zéros au départ
export function applyTick(state: UniverseState): void;    // appelé par realtime.ts
export function patchLocal(entries: Array<[channel: number, value: number]>): void; // écho local du writer
export function getValues(): number[];                    // lecture sans abonnement
export function useChannel(channel: number): number;      // abonnement à UN canal (1-512)
export function useChannels(channels: number[]): number[]; // abonnement à une liste (shallowEqual)
export function useUniverseMeta(): { fps: number; received: boolean };
```

### 4.3 `state/app.ts`

```ts
export type LogEntry = { level: "info" | "warn" | "error"; message: string; timestamp: string };
export type WsStatus = "connecting" | "open" | "closed";
export type AppState = {
  fixtures: Fixture[]; scenes: Scene[]; presets: Preset[]; smartLights: SmartLight[];
  running: RunningEffect[]; wsStatus: WsStatus; logs: LogEntry[]; unread: number;
  loaded: boolean; error: string | null;
};
export const appStore: Store<AppState>;
export async function refreshAll(): Promise<void>;          // GET fixtures, scenes, presets, smart-lights, effects
export async function refreshScenes(): Promise<void>;       // idem partiels
export async function refreshPresets(): Promise<void>;
export function pushLog(entry: LogEntry): void;             // garde 200 entrées, incrémente unread
export function markLogsRead(): void;
export function upsertFixture(f: Fixture): void; export function upsertSmartLight(l: SmartLight): void;
export function setRunning(r: RunningEffect[]): void;
// Hooks
export function useWsStatus(): WsStatus; export function useLogs(): LogEntry[]; export function useUnread(): number;
export function useScenes(): Scene[]; export function usePresets(): Preset[]; export function useSmartLights(): SmartLight[];
export function useRunningEffects(): RunningEffect[];
```

### 4.4 `lib/patch.ts` — projecteurs « patchés » (dérivés, mémoïsés)

```ts
export type PatchedFixture = Fixture & {
  fid: number;                  // 1..n, ordre (universe, address) croissant — stable tant que le patch ne change pas
  span: number;                 // nombre de canaux occupés depuis l'adresse (max channel relatif)
  locked: string | null;        // raison du verrou (lib/guard) ou null
  isFacade: boolean;            // façade d'une lampe connectée (profile absent et nom/mirror) — info seulement
  subCount: number;             // zones détectées (motif r,g,b répété ≥ 3 fois) sinon 0  → sous-projecteurs
};
export function buildPatch(fixtures: Fixture[]): PatchedFixture[];
export function usePatch(): PatchedFixture[];               // mémoïsé sur appStore.fixtures
export function usePatchById(): Map<string, PatchedFixture>;
export function byFid(patch: PatchedFixture[], fid: number): PatchedFixture | undefined;
export function absoluteChannel(f: Fixture, relative: number): number;         // address + relative - 1
export function channelsFor(f: Fixture, capability: Capability): number[];     // canaux absolus (1-512)
export function fixtureOf(patch: PatchedFixture[], channel: number): PatchedFixture | undefined;
```

### 4.5 `lib/attributes.ts` — vocabulaire MA3

```ts
export type FeatureGroupId = "dimmer" | "position" | "gobo" | "color" | "beam" | "focus" | "control" | "shapers";
export const FEATURE_GROUPS: { id: FeatureGroupId; index: number; label: string }[]; // 1 Dimmer … 8 Shapers
export type AttrKey = "dimmer" | "pan" | "tilt" | "gobo" | "red" | "green" | "blue" | "white" | "uv"
  | "ctemp" | "colorWheel" | "shutter" | "prism" | "focus" | "speed" | "effect" | "control";
export const ATTRIBUTES: Record<AttrKey, { label: string; short: string; group: FeatureGroupId; capability: Capability; dimmable: boolean }>;
// label MA3 : Dim, Pan, Tilt, Gobo1, R (ColorRGB_R), G, B, W, UV, CTO (ctemp), Color1 (roue), Shutter, Prism1, Focus, Speed, Effect, Control
export function attrsOfGroup(group: FeatureGroupId): AttrKey[];
/** Canaux absolus d'un attribut ; "dimmer" sans canal intensity retombe sur r+g+b (PAR RGB). */
export function channelsForAttr(f: Fixture, attr: AttrKey): number[];
export function hasAttr(f: Fixture, attr: AttrKey): boolean;
export function groupsAvailable(fixtures: Fixture[]): Set<FeatureGroupId>;
export function readAttr(f: Fixture, attr: AttrKey, values: number[]): number | null;  // max des canaux (HTP) ou null
export type Readout = "natural" | "percent" | "decimal8";
export function formatValue(value: number, attr: AttrKey, readout: Readout): string; // natural: % pour dimmer/couleur, ° pour pan (-270..270)/tilt (-135..135), brut pour roues
export const DIMMABLE: Set<Capability>;   // intensity r g b w uv
```

### 4.6 `state/dmx-writer.ts`

```ts
export type WriteOptions = { programmer?: boolean };   // true → marque les canaux comme valeurs actives du programmer
/** Écrit des canaux (0-255). Ignore silencieusement les canaux d'un projecteur verrouillé et renvoie le nombre écrit. */
export function writeChannels(entries: Array<[number, number]>, opts?: WriteOptions): number;
export function writeChannel(channel: number, value: number, opts?: WriteOptions): number;
export function flushNow(): Promise<void>;             // pour les tests / avant un STORE
```
Mécanique : clamp 0-255 → garde (via `appStore.fixtures` + `lib/guard`) → `patchLocal` (écho) → tampon →
premier envoi immédiat puis `setInterval(40 ms)` tant que le tampon n'est pas vide. Si `programmer`,
appelle `programmerStore` pour marquer `active[channel] = value`. Erreur réseau → `pushLog("error")`.

### 4.7 `state/programmer.ts`

```ts
export type Layer = "absolute" | "relative" | "fade" | "delay";
export type LayerGroup = "values" | "phaserOverall" | "phaserSteps";
export type ProgrammerState = {
  selection: string[];                 // ids, dans l'ordre de sélection (porte la phase des phasers)
  active: Record<number, number>;      // canal absolu → valeur posée par le programmer depuis le dernier Clear
  featureGroup: FeatureGroupId;        // "dimmer" par défaut
  encoderPage: number;                 // page d'encodeurs dans le groupe (4 encodeurs par page)
  layerGroup: LayerGroup; layer: Layer;
  readout: Readout;                    // "natural"
  sync: boolean; singleStep: boolean; align: "off" | "<" | ">" | "<>" ; link: "single" | "feature";
  grandMaster: number;                 // 0..100, 100 par défaut
  blackout: boolean;
  highlight: boolean;
};
export const programmerStore: Store<ProgrammerState>;
export function useSelection(): string[];
export function useSelectedFixtures(): PatchedFixture[];
export function isSelected(id: string): boolean;
export function select(ids: string[], mode?: "replace" | "add" | "remove" | "toggle"): void; // verrouillés ignorés
export function selectAll(): void;
export function clearSelection(): void;
/** Cycle Clear de MA3 : 1er appui = sélection vidée, 2e = valeurs actives oubliées (restent sur scène), 3e = rien. Renvoie ce qui a été fait. */
export function clear(): "selection" | "active" | "nothing";
export function clearAll(): void;
/** Pose un attribut sur la sélection (ou `ids`). value : DMX 0-255 (ou % si unit = "percent"). Renvoie le nombre de canaux écrits. */
export function setAttribute(attr: AttrKey, value: number, opts?: { ids?: string[]; unit?: "dmx" | "percent"; relative?: boolean }): number;
export function setFeatureGroup(g: FeatureGroupId): void; export function setEncoderPage(p: number): void;
export function setLayer(l: Layer): void; export function setLayerGroup(g: LayerGroup): void; export function setReadout(r: Readout): void;
export function setGrandMaster(pct: number): void;   // voir §4.7.1
export function setBlackout(on: boolean): void;
export function useActiveChannels(): Record<number, number>;
export function isActive(channel: number): boolean;
```

4.7.1 Grand Master et blackout (frontend, le backend n'a pas de master) : quand GM passe sous 100 %,
on photographie une fois les valeurs **non atténuées** des canaux `DIMMABLE` de tous les projecteurs
non verrouillés (`gmSnapshot`), puis on écrit `round(snapshot × gm/100)` ; les écritures du programmer
pendant GM < 100 mettent à jour le snapshot et sortent atténuées ; GM revenu à 100 → snapshot rejoué
puis oublié. Blackout = idem avec facteur 0 (bouton à bascule, en rouge dans Master Controls). Les
canaux non atténuables ne bougent jamais.

### 4.8 `state/playback.ts` (executors, groupes, pools de presets ; persistance localStorage)

```ts
export type Group = { slot: number; name: string; fixtureIds: string[] };
export type PresetPool = FeatureGroupId | "all";
export type PresetRef = { id: string; pool: PresetPool; slot: number };
export const EXECUTOR_SLOTS = 20; export const GROUP_SLOTS = 20; export const PRESET_SLOTS = 20;
export type Result = { ok: boolean; message: string };
export const playbackStore: Store<{ execSlots: Record<number, string /*sceneId*/>; levels: Record<number, number /*0..1*/>;
  activeExec: Record<number, boolean>; groups: Group[]; presetRefs: PresetRef[] }>;
export function useExecutors(): Array<{ slot: number; scene: Scene | null; level: number; active: boolean }>;
export async function storeExecutor(slot: number, name?: string): Promise<Result>;  // programmer actif → sinon tout le plateau (non verrouillé)
export async function goExecutor(slot: number): Promise<Result>;    // applySceneAtLevel(level × GM) via writer ; active = true
export function offExecutor(slot: number): Result;                  // canaux DIMMABLE de la scène à 0 ; active = false
export function setExecutorLevel(slot: number, level: number): void; // rejoue si active
export async function deleteExecutor(slot: number): Promise<Result>; // DELETE /api/scenes/:id
export async function labelExecutor(slot: number, name: string): Promise<Result>; // pas de PUT scène côté backend → recrée (POST) + DELETE l'ancienne, même slot
export function assignExecutor(slot: number, sceneId: string | null): void;
export function useGroups(): Group[]; export function storeGroup(slot: number, name?: string): Result;
export function recallGroup(slot: number, mode?: "replace" | "add" | "toggle"): Result; export function deleteGroup(slot: number): void; export function labelGroup(slot: number, name: string): void;
export function usePresetPool(pool: PresetPool): Array<{ slot: number; preset: Preset | null; swatch: string | null }>;
export async function storePreset(pool: PresetPool, slot: number, name?: string): Promise<Result>; // canaux actifs du programmer appartenant au groupe (pool "all" = tous)
export async function applyPreset(pool: PresetPool, slot: number): Promise<Result>; // écrit le payload via writer (programmer: true), filtré par la garde
export async function deletePreset(pool: PresetPool, slot: number): Promise<Result>; // pas de DELETE preset côté backend → retire la référence locale seulement (+ message)
```
Clés localStorage : `lb3.execSlots`, `lb3.groups`, `lb3.presetRefs`, `lb3.layout` (positions), `lb3.views`, `lb3.ui`.
Les scènes orphelines (créées ailleurs) sont rangées dans les premiers slots libres à l'affichage.

### 4.9 `state/workspace.ts`

```ts
export type WindowKind = "fixtureSheet" | "layout" | "groups" | "presets" | "executors" | "phaser" | "dmxSheet"
  | "patch" | "devices" | "setup" | "help" | "colorPicker";
export type WindowInstance = { id: string; kind: WindowKind; x: number; y: number; w: number; h: number; settings?: Record<string, unknown> };
export type View = { name: string; windows: WindowInstance[] };
export const GRID_COLS = 24; export const GRID_ROWS = 16;
export type Overlay = "none" | "shutdown" | "menu" | "commandSection" | "masterControls" | "specialMasters"
  | "playbackControls" | "displays" | "at" | "messages" | "cmdHistory" | "addWindow" | "calculator" | "storeView";
export type WorkspaceState = {
  views: (View | null)[];            // 7 entrées
  current: number;                   // index de la vue affichée (0..6)
  showControlBar: boolean; showViewBar: boolean; showEncoderBar: boolean; wingBar: boolean;
  overlay: Overlay; overlayPayload?: unknown;
  uiScale: number;                   // 1 = 1920 px de large ; auto au chargement (clamp 0.55..1.25)
};
export const workspaceStore: Store<WorkspaceState>;
export function useWorkspace<S>(selector: (s: WorkspaceState) => S): S;
export function showView(index: number): void;
export function storeView(index: number, name: string): void;      // photographie les fenêtres courantes
export function deleteView(index: number): void;
export function addWindow(kind: WindowKind, at?: { x: number; y: number }): void;  // place dans la première zone libre (taille par défaut du module)
export function updateWindow(id: string, patch: Partial<WindowInstance>): void;  // clamp dans la grille
export function removeWindow(id: string): void;
export function openOverlay(o: Overlay, payload?: unknown): void; export function closeOverlay(): void;
export function toggleBar(bar: "control" | "view" | "encoder" | "wing"): void;
export function setUiScale(scale: number): void;
export const DEFAULT_VIEWS: (View | null)[];   // voir §5.2
```
Persisté : `views`, `current`, barres, `uiScale` (clé `lb3.views` / `lb3.ui`). Fenêtre `settings` persisté avec la vue.

### 4.10 `state/realtime.ts`

`startRealtime(): () => void` — ouvre le WebSocket (`wsUrl()`), reconnecte, et dispatch :
`universe_tick → applyTick`, `fixture_updated → upsertFixture`, `scene_activated → pushLog + refreshScenes`,
`log → pushLog`, `smart_light_updated → upsertSmartLight`, `effects_updated → setRunning`.
Au `open` : `refreshAll()`. Statut dans `appStore.wsStatus`.

### 4.11 `lib/api.ts`

Client `fetchJSON` (comme l'ancien), `wsUrl()`, et `api.{fixtures, scenes, presets, universe, effects,
smartLights, devices, qxf, homekit, meross, system}` couvrant toutes les routes de DEVELOPMENT.md
(§ API REST complète + effets) avec les types de `@lightbridgedmx/shared`. Types locaux : `HomeKitStatus`
(voir l'ancien `lib/api.ts`).

### 4.12 Ligne de commande (`lib/command/`)

Syntaxe MA3 (insensible à la casse, accents tolérés, raccourcis FR acceptés) :

```
Fixture 1 Thru 3 [+ 5] [- 2]        sélection (Thru/+/-) ; "1 Thru 3" seul = mot-clé par défaut Fixture
Fixture Thru                        tout sélectionner
At 50 | At 50 Thru 100 (fan) | Full | At 0 | Out     dimmer de la sélection
Dimmer/Pan/Tilt/Red/Green/Blue/White/CTemp/Gobo/Color/Shutter/Focus/Prism At 50
Attribute "Pan" At 50              forme longue
Fixture 2 At 75                    sélectionne puis pose
Dmx 12 Thru 20 At 50 | Channel 12 At 50     écriture directe de canaux (garde appliquée)
Clear | ClearAll                    cycle Clear MA3 / tout vider
Group 2 | Store Group 2 "Salon" | Delete Group 2 | Label Group 2 "Nom"
Preset 4.1 | Store Preset 4.1 "Bleu" | Delete Preset 4.1       (pool = n° de groupe de fonctions : 1 Dimmer, 2 Position, 3 Gobo, 4 Color… ; "Preset 1" seul = pool All)
Store Sequence 1 "Look" | Store Executor 1 | Store 1        (= executor)
Go Sequence 1 | Go+ 1 | Off Sequence 1 | Off 1 | Delete Sequence 1 | Label Sequence 1 "Nom"
Executor 3 At 50                   niveau d'un executor
Phaser Off | Off Phaser            arrête tous les phasers (effets)
Blackout | Blackout Off
View 2 | Store View 3 "Nom"
Highlight                          bascule
Help                               ouvre la fenêtre Help
Please                             = Entrée (ignoré en fin de ligne)
```

`parseCommand(text): Command | { kind: "error"; message }` (types discriminés, tous listés dans `parse.ts`) ;
`executeCommand(cmd): Promise<{ ok: boolean; message: string }>` applique via les stores. Valeurs : % par
défaut ; suffixe `d`/`dmx` = brut 0-255 ; `Full` = 255, `Out`/`Zero` = 0, `Half` = 128. Tests Vitest dans
`parse.spec.ts` (≥ 25 cas : sélection, Thru/+/-, At, attributs, Store/Go/Off, Preset pool.slot, erreurs).

---

## 5. Shell (chrome)

### 5.1 Comportements

- **Control bar** (haut → bas, icônes SVG inline fidèles à `controlbar.png`) :
  1. Power → overlay « Shutdown » : « Restart LightBridgeDMX » (POST `/api/system/restart`, confirmation), « Reload UI ».
  2. Gear → overlay « Menu » (plein écran, tuiles) : Patch, Devices (Network), Setup (Settings), Backup (export/import JSON des vues/groupes/slots), Help, About.
  3. Views (icône fenêtre) → ouvre le dialogue Add Window.
  4. Faders (command section) → overlay **Command Section** : clavier virtuel MA3 (Fixture, Group, Preset, Sequence, Executor, At, Full, Thru, +, -, ., 0-9, Clear, Store, Delete, Label, Go, Off, Esc, Please) qui alimente la command line ; utile sur tablette.
  5. Special master (cercle + 3 carrés) → overlay **Special Masters** : « Speed Master » (rate des phasers en cours : PUT `/api/effects/:id` avec `rate`), « Program Time » (décoratif).
  6. Master fader → overlay **Master Controls** : Grand Master (fader vertical), Blackout (bascule rouge), Highlight, « Off All Phasers ».
  7. Encoder bar (icône 3 rangées) → affiche/masque l'encoder bar.
  8. Display → overlay **Displays** : « Display 1 » (jaune), 2-7 grisés (une seule display).
  9. ? → ouvre la fenêtre Help dans la vue courante.
  10. Command wing bar (icône fader + lignes) → bascule l'encoder bar en **command wing bar** (rangée de 10 executors avec fader horizontal + Go/Off, + 2 encodeurs compressés).
  11. At ▽ → overlay **At** : Full, Zero, Off, On, Default (50 % pan/tilt), Clear, Copy/Paste programmer (copier les valeurs actives, les coller sur une autre sélection).
- **View bar** : clic = afficher la vue ; appui long (500 ms) / clic droit = overlay « Store View » (nom) ou
  « Delete View ». Bouton affecté : face `#26262c`, nom, œil ; vide : `#151519` + numéro seul. Vue courante :
  liseré jaune 2px à gauche. Scroll si > 7 impossible (7 fixes).
- **Command line** : `<input>` sans bordure dans la barre ; Entrée exécute ; ↑/↓ historique (50 entrées,
  `lb3.history`) ; Échap vide ; retour de commande affiché 4 s en remplacement du prompt (vert ok / rouge
  erreur) ; `[Fixture]` jaune ; bouton M A = overlay historique ; icône clavier = focus ; à droite :
  cercle barré (décoratif), micro barré (décoratif), globe (vert si backend joignable), enveloppe
  (orange + compteur `unread` → overlay Message Center), réseau (vert = WS `open`, rouge sinon), ShCuts
  (jaune = raccourcis clavier actifs : touches F1-F8 = groupes de fonctions ; `Esc` = Clear ; `Ctrl+Entrée`
  = Store ; bascule au clic), ▶. Un clic n'importe où sur une zone neutre redonne le focus à la ligne.
- **Encoder bar** : fidèle au §1.1. Les 8 groupes affichent leur point plein si disponible sur la sélection ;
  clic → `setFeatureGroup`. « Dimmer 1 of N » = page. Encodeurs : 4 attributs de la page (ou vides si rien
  n'est sélectionné : boîtes vides comme sur la capture — la capture montre `Dim` et `Max.` sans sélection,
  on affiche donc **toujours** les 4 premières attributs du groupe, grisés si inutilisables). Molette :
  glisser vertical (1 px = 1 DMX, Maj = ×0.2 fin), molette souris, flèches clavier ; clic sur la boîte →
  overlay **Calculator** (pavé 0-9, ., Thru, 0 / 25 / 50 / 75 / 100 %, Full, Out, Please). La valeur
  affichée suit le readout ; fond de la boîte rouge `#731d18` si la valeur est active dans le programmer,
  gris sinon. Couches : `Absolute` seul fonctionnel ; `Relative` = les encodeurs ajoutent à la valeur
  courante ; `Fade`/`Delay` affichent « — » (non supportés, grisés mais visibles). `Phaser Overall` /
  `Phaser Steps` : les encodeurs pilotent le phaser en cours sur la sélection (Speed, Phase, Width, Low,
  High ; via PUT `/api/effects/:id` debounce 150 ms) s'il existe, sinon boîtes grisées.
  Grand Master : clic → overlay Master Controls ; molette/drag vertical sur la boîte change le GM.
  `Selection` (⋯) → overlay listant la sélection (ordre, Invert, Next/Prev sélectionnent un seul projecteur) ;
  `Phaser` (⋯) → ouvre la fenêtre Phaser ; `MAtricks`, `Prog Time`, `Exec Time` → décoratifs (message
  « non disponible »).
- **Écran** : grille 24×16 proportionnelle ; fenêtres déplaçables par la barre de titre, redimensionnables
  par le coin bas-droit, accrochées à la grille ; clic sur le fond vide → Add Window à cet endroit.
  Fenêtre au-dessus au clic (z-order = ordre du tableau).
- **Échelle** : `html { font-size: calc(16px * var(--ui-scale)) }` ; auto = `clamp(0.55, innerWidth / 1920, 1.25)`
  au premier chargement si rien n'est persisté ; réglable dans Setup. Sous 900 px de large : control bar et
  view bar masquées par défaut (ré-affichables par ◀ ▶).

### 5.2 Vues par défaut (`DEFAULT_VIEWS`)

| N° | Nom | Fenêtres (x,y,w,h en grille 24×16) |
|---|---|---|
| 1 | Live | fixtureSheet (0,0,24,9) · groups (0,9,8,7) · presets[color] (8,9,8,7) · executors (16,9,8,7) |
| 2 | Playback | executors (0,0,12,16) · layout (12,0,12,16) |
| 3 | Phaser | phaser (0,0,14,16) · fixtureSheet (14,0,10,16) |
| 4 | Patch | patch (0,0,16,16) · devices (16,0,8,16) |
| 5 | DMX | dmxSheet (0,0,24,16) |
| 6 | Setup | setup (0,0,12,16) · help (12,0,12,16) |
| 7 | — | vide |

---

## 6. Fenêtres

### 6.0 Contrat d'un module

```ts
// windows/types.ts
export type WindowProps = { win: WindowInstance; setSettings: (patch: Record<string, unknown>) => void };
export type WindowModule = {
  kind: WindowKind; title: string;
  category: "Common" | "Presets" | "Pools" | "Playback" | "Tools" | "Data" | "More";
  defaultSize: { w: number; h: number };
  Component: ComponentType<WindowProps>;
  TitleExtras?: ComponentType<WindowProps>;   // boutons à droite de la barre de titre
  minSize?: { w: number; h: number };
};
```
`windows/registry.ts` : `export const WINDOWS: Record<WindowKind, WindowModule>` (import statique de chaque
`windows/<kind>/index.tsx`). Le chrome ne change plus ce fichier après la phase 1.

Styles : classes utilitaires de `theme.css` (`.ma-btn`, `.ma-btn--active`, `.ma-tile`, `.ma-sheet`,
`.ma-titlebar`, `.ma-field`, `.ma-fader`, …) + un fichier CSS **par fenêtre** importé par son module
(`windows/<kind>/style.css`), préfixe de classe `.w-<kind>-…` pour éviter les collisions.

### 6.1 Fixture Sheet (`fixtureSheet`)

- Colonnes : `Name` (figée) · `FID` · puis une colonne par attribut présent dans le patch, dans l'ordre
  Dim, Pan, Tilt, Gobo1, R, G, B, W, UV, CTO, Color1, Shutter, Prism1, Focus, Speed, Effect, Control.
- Lignes : un projecteur = une ligne ; `subCount > 0` (bandeau) → ligne parent (valeurs = max des zones)
  avec chevron ▸ pour déplier les sous-projecteurs `FID.n` (R/G/B de la zone n).
- Valeurs selon `readout` (bouton `Readout <Natural>` dans la barre de titre, cycle). Couleurs du §1.2 :
  active programmer = blanc sur rouge ; par défaut gris ; nom sélectionné jaune sur gris ; verrouillé =
  cadenas + ligne grisée, clic sans effet (toast « Projecteur verrouillé : <raison> »).
- Clic sur une ligne = `select([id], "replace")` ; Ctrl/Cmd+clic = toggle ; Maj+clic = plage (ordre FID) ;
  glisser sur la colonne Name = lasso vertical (add). Clic sur une cellule de valeur = sélectionne et ouvre
  le groupe de fonctions correspondant (`setFeatureGroup`).
- Barre de titre : `Prog Only` (n'affiche que les projecteurs avec valeurs actives), `Readout`, compteur
  « n/N selected ».
- Abonnement à l'univers **par cellule** (`useChannel`) — jamais le tableau entier.

### 6.2 Layout (`layout`)

- Canevas noir avec grille de points ; chaque projecteur = carré 4rem (bandeau = barre 12rem × 2rem
  découpée en zones) ; nom en dessous ; remplissage = couleur RGB courante × intensité (blanc si pas de
  couleur) ; cadre jaune 2px si sélectionné ; cadenas si verrouillé.
- Clic = select ; Maj = add ; lasso rectangulaire = add (ordre gauche → droite puis haut → bas, pour les
  phasers) ; clic sur fond = clear selection.
- Bouton `Setup` dans la barre de titre : en mode setup on **déplace** les carrés (positions persistées
  dans `lb3.layout` par id, en unités de grille 0.5rem) ; `Auto` range par pièce (une colonne par pièce,
  ordre FID). Zoom molette (0.5 ×–2 ×) + drag du fond pour déplacer la vue en mode setup.

### 6.3 Groups (`groups`) et Presets (`presets`) et Color Picker (`colorPicker`)

- Groups : pool de 20 tuiles ; première tuile = étiquette « Groups » ; clic = `recallGroup(slot)` ;
  mode **Store** : bouton `Store` dans la barre de titre (jaune quand armé, comme la touche Store de MA3) →
  le prochain clic sur une tuile enregistre la sélection ; clic droit / appui long → menu Label / Delete.
  Tuile occupée : nom + nombre de projecteurs en petit.
- Presets : le `settings.pool` de la fenêtre (défaut `color`) choisit le pool ; sélecteur dans la barre
  de titre (All, Dimmer, Position, Gobo, Color, Beam, Focus, Control). Tuile Color = pastille de la couleur ;
  Dimmer = valeur % ; Position = « P/T ». Clic = `applyPreset` ; mode Store idem Groups.
- Color Picker : fenêtre « Color Picker » MA3 : onglets `HSB` (disque/carré teinte-saturation + fader
  luminosité), `Swatches` (16 couleurs nommées : White, Red, Orange, Yellow, Lime, Green, Cyan, Sky, Blue,
  Violet, Magenta, Pink, Warm white, Cool white, Amber, UV) et `RGB` (3 faders R/G/B + W + CTO) ; agit sur
  la sélection via `setAttribute` (red/green/blue[/white]) ; luminosité = via `dimmer` si le projecteur a
  une intensité, sinon par mise à l'échelle du RGB.

### 6.4 Executors (`executors`)

- 20 executors en 2 rangées de 10 (comme la playback bar MA3) : chaque bloc = numéro, nom de la séquence
  (ou vide), fader **vertical** (niveau), bouton `Go+` (vert), `Off`, voyant actif. Mode Store (barre de
  titre) → clic sur un bloc = `storeExecutor(slot)` (nom demandé par prompt inline).
- Clic droit / appui long : Label, Delete, Release (détache sans supprimer), Assign (choisir une scène
  existante dans une liste).
- Les mouvements de fader passent par `setExecutorLevel` (writer groupé, pas de POST par pixel).

### 6.5 Phaser (`phaser`) — moteur d'effets DMX

Port de la grammaire de l'ancienne fenêtre Effets (`git show 24c1176:frontend/src/components/console/windows/effects/*`)
avec le look MA3 « Phaser Editor » :
- cible = sélection courante (affichée : n projecteurs / m cellules via `resolveCells` du package partagé) ;
- **Pool de formes** : tuiles (Sin, Cos, RampUp, RampDown, Triangle, PWM, Random) ;
- **Lignes** (1-8) : attribut (dimmer, red, green, blue, pan, tilt, color, hue), forme, mode
  absolute/relative, low/high, phaseFrom/phaseTo, width, attack/decay (pwm/random), seed ;
- réglages globaux : speed (BPM), rate, direction, curve, matricks (blocks/groups/wings/interleave),
  couleurs (color / bgColor / colorTo, hueFrom/hueTo/saturation) ;
- presets rapides (locaux, en code) : « Dimmer sine », « Chase », « Strobe », « Rainbow », « Pan/Tilt
  circle », « Color fade » ;
- **aperçu** honnête : canvas qui appelle `evaluateDmxEffect` + `resolveCells` du package partagé
  (valeur par cellule dans le temps) ;
- `Go` → `POST /api/effects/run { effect, fixtureIds }` (verrouillés exclus) ; `Off` → DELETE ; « suivi »
  automatique : tant que l'effet lancé depuis la fenêtre tourne, chaque changement → `PUT /api/effects/:id`
  (debounce 150 ms) ; liste des effets en cours (`useRunningEffects`) avec bouton Off chacun + « Off All » ;
- garde dimmer (`EffectDimmerGuard`) : si un effet couleur/position vise des projecteurs à intensité 0,
  afficher « Ouvrir à 100 % ».
- ⚠ interdiction de lancer un effet pendant le développement (voir §2.11).

### 6.6 DMX Sheet (`dmxSheet`)

512 cellules, 32 par ligne, numéro + valeur (readout : décimal 0-255 ou %) ; couleur de fond selon le
projecteur propriétaire (teinte stable par FID, faible opacité), nom du projecteur dans l'infobulle et en
en-tête de bloc ; clic = sélectionne le projecteur ; cellule active programmer = rouge. Abonnement par
cellule. Barre de titre : `Readout`, champ « Go to » (canal).

### 6.7 Patch (`patch`) et Devices (`devices`)

- Patch : tableau FID · Name · FixtureType (profile `manufacturer model / mode` ou « Generic n ch ») ·
  Patch (`U.addr` → `U.addr+span-1`) · Channels · Room · HomeKit (✓ si `homekit.enabled !== false`) ·
  Lock (🔒 + raison). Clic droit / bouton `Edit` → formulaire inline : name, room, address (PUT
  `/api/fixtures/:id` ; 409 → message), delete (confirmation). Bouton `Add Fixture` → panneau : recherche
  dans `GET /api/qxf/library` (fabricant/modèle/mode), adresse, nom, pièce → `POST /api/fixtures/import/qxf-library`.
  Bouton `Generic` → création manuelle (nom, adresse, pièce, liste de capabilities) → `POST /api/fixtures`.
- Devices : `GET /api/devices` (cache) + bouton `Scan` (POST) ; lignes groupées par catégorie, grisées si
  non pilotables avec la raison ; état des lampes connectées (`useSmartLights`) : on/off, luminosité,
  streaming, joignabilité ; actions : `Pair` Nanoleaf (host), `Adopt` ampoule Thread (candidats), bouton
  `Re-pair`. Pas de scan au chargement.

### 6.8 Setup (`setup`) et Help (`help`)

- Setup : sections « DMX » (fps reçu, WS status, nombre de projecteurs, canaux actifs), « HomeKit »
  (statut, PIN, setupUri en texte + bouton copier, liste exposée), « Meross » (statut, mesure W, formulaire
  host/key/channel/enabled, Test), « Interface » (échelle, raccourcis, reset des vues/groupes/slots),
  « System » (Restart LightBridgeDMX, version).
- Help : liste des commandes (`COMMAND_HELP`), raccourcis clavier, et un court rappel des gestes MA3
  (Store armé, Clear ×3, appui long).

---

## 7. Conventions de code

- Fichiers `.tsx`/`.ts`, commentaires et messages utilisateur en **français** (sauf vocabulaire MA3).
- Composants fonctionnels + hooks ; pas de classes ; pas de `any` ; `import type` quand possible.
- Pas de `useEffect` pour dériver un état calculable (`useMemo`). Pas de re-rendu global au tick.
- Accessibilité : `role="slider"` + ARIA sur molettes/faders, `aria-pressed` sur bascules, focus visible.
- Pointer events (souris + tactile), `setPointerCapture` pour les gestes.
- Pas d'alert()/confirm() natifs : overlays maison.
- CSS : variables du `theme.css` ; unités `rem` ; pas de `px` sauf 1 px de bordure.

## 8. Vérification attendue de chaque agent

```bash
cd /Users/alex/LightBridgeDMX
pnpm -C frontend exec tsc --noEmit -p tsconfig.json     # 0 erreur sur SES fichiers (les stubs des autres peuvent évoluer)
pnpm -C frontend exec vitest run                        # si des tests existent
pnpm -C frontend build                                  # intégrateur seulement
```
Ne jamais lancer `pnpm install` avec le réseau coupé ; `vitest@4.0.15` est déjà dans le store pnpm.
Ne pas redémarrer le backend. Ne pas écrire sur le DMX.
