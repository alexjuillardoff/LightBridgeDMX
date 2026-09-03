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
│   │   ├── App.tsx                    ← empile AppData → Selection → Console → Command → AppShell
│   │   ├── shell/                     ← châssis du pupitre (barre d'état, vues, rail, cmdline)
│   │   │   ├── AppShell.tsx           ← layout racine : StatusBar + TabBar + vue active + KeypadRail + CommandLine
│   │   │   ├── StatusBar.tsx          ← barre d'état haute (univers, sortie DMX, LED, horloge, Blackout)
│   │   │   ├── TabBar.tsx             ← barre de vues numérotées, cachée <640px
│   │   │   ├── BottomNav.tsx          ← bottom nav iOS-style mobile, cachée ≥640px, safe-area-inset
│   │   │   ├── tabs.ts                ← source unique des 3 vues + des volets de Patch + traduction des anciens hashs
│   │   │   ├── CommandLine.tsx        ← ligne de commande turquoise (saisie + ligne de retour)
│   │   │   ├── KeypadRail.tsx         ← rail droit : Fixture/Group/Thru/At, pavé, Store/Go/Off, Please, B.O.
│   │   │   ├── useHashTab.ts          ← hook routing par hash URL (#live, #patch, #patch/lampes, #setup)
│   │   │   └── navigate.ts            ← helper setActiveTabHash() pour liens internes
│   │   ├── contexts/
│   │   │   ├── AppDataContext.tsx     ← provider central — queries, mutations, WS handlers, log history
│   │   │   ├── SelectionContext.tsx   ← le "programmer" — sélection de fixtures + refus des verrouillés
│   │   │   ├── ConsoleContext.tsx     ← pools : groupes, executors, playbacks, presets (STORE/GO/OFF)
│   │   │   ├── CommandContext.tsx     ← saisie + exécution des commandes (partagée cmdline/rail)
│   │   │   └── UniverseStateContext.tsx ← universeState 30 Hz + ref stable sans abonnement
│   │   ├── pages/                     ← une page par vue (consomment les contextes)
│   │   │   ├── LivePage.tsx           ← le plan de travail (Workspace), lazy
│   │   │   ├── PatchPage.tsx          ← volets Projecteurs / Inventaire réseau / Lampes connectées
│   │   │   ├── patch/SmartLightsPane.tsx ← volet Lampes : pastilles de backend + SmartLightsPanel
│   │   │   └── SetupPage.tsx          ← HomeKitCard + MerossCard + Système / Variables / Maintenance
│   │   ├── components/
│   │   │   ├── console/               ← le pupitre proprement dit
│   │   │   │   ├── Workspace.tsx      ← gestionnaire de fenêtres + barre des Views + menu « + Fenêtre »
│   │   │   │   ├── ConsoleWindow.tsx  ← cadre de fenêtre : glisser la barre de titre, redimensionner le coin
│   │   │   │   └── windows/
│   │   │   │       ├── registry.tsx        ← WindowKind → composant de contenu
│   │   │   │       ├── ExecutorsWindow.tsx ← pool d'executors (Store / Go / Off / libérer)
│   │   │   │       ├── PlaybacksWindow.tsx ← rangée de faders master
│   │   │   │       ├── GroupsWindow.tsx    ← pool de groupes de sélection
│   │   │   │       ├── PresetsWindow.tsx   ← pool de presets (canal → valeur)
│   │   │   │       └── LogWindow.tsx       ← journal des événements backend
│   │   │   ├── FixtureSheet.tsx       ← cellules fixtures groupées par pièce + sélection + cadenas
│   │   │   ├── EncoderBar.tsx         ← onglets de groupe + molettes + valeurs rapides (0/25/50/75/FL)
│   │   │   ├── UniverseMonitor.tsx    ← DMX sheet 512 canaux en lecture seule
│   │   │   ├── ma/MaFader.tsx         ← fader maison (pointeur + clavier), vertical ou horizontal
│   │   │   ├── ma/MaKnob.tsx          ← molette d'encodeur (drag relatif, arc de niveau)
│   │   │   ├── FixtureForm.tsx        ← formulaire création manuelle de fixture
│   │   │   ├── FixturesTable.tsx      ← liste fixtures + suppression + data-label pour mobile cards
│   │   │   ├── ChannelGrid.tsx        ← fader view 32 canaux/page (16 → 12 → 8 → 4 colonnes)
│   │   │   ├── DeviceInventory.tsx    ← inventaire réseau unifié (ex-DevicesPage)
│   │   │   ├── QxfLibraryPanel.tsx    ← navigateur bibliothèque QXF + import
│   │   │   ├── HomeKitCard.tsx        ← statut HomeKit + QR code + PIN
│   │   │   ├── MerossCard.tsx         ← config + métrologie de la prise Meross
│   │   │   ├── DancePanel.tsx         ← config + contrôle du Dance mode
│   │   │   ├── SmartLightsPanel.tsx   ← accepte `backendFilter` + `hideSectionTitle` (extensible)
│   │   │   └── smart-lights/
│   │   │       ├── backendRegistry.ts     ← registre extensible (Nanoleaf + futurs Hue/Matter)
│   │   │       ├── ZonePainter.tsx        ← 50 swatches paintable click+drag, presets, fill
│   │   │       ├── EffectDesigner.tsx     ← onglets solid/gradient/chase/wave + sliders live
│   │   │       └── LayoutEditor3D.tsx     ← React Three Fiber, sphères 3D draggables, lazy-loaded
│   │   ├── hooks/
│   │   │   ├── useDmxWebsocket.ts     ← hook WS (universe_tick, fixture_updated, smart_light_updated) + logHistory rolling 10
│   │   │   └── useMediaQuery.ts       ← suit une media query (bascule plan de travail / pile mobile)
│   │   └── lib/
│   │       ├── api.ts                 ← client fetch + wsUrl()
│   │       ├── console/layout.ts      ← modèle de disposition (grille 24 col.) + Views d'origine
│   │       ├── console/scenes.ts      ← capture (STORE) et rappel à niveau (playback master)
│   │       ├── feedback.ts            ← ActionResult partagé (ok/warn/fail/info)
│   │       ├── fixtureGuard.ts        ← projecteurs VERROUILLÉS (chambre) — garde-fou structurel
│   │       ├── hiddenFixtures.ts      ← projecteurs masqués de l'UI (filtre cosmétique)
│   │       ├── localStore.ts          ← persistance locale (disposition, groupes, slots d'executors)
│   │       ├── fixtures.ts            ← couleurs par fixture, canaux visibles, canaux actifs
│   │       ├── programmer.ts          ← attributs ↔ canaux DMX (groupes, lecture/écriture sélection)
│   │       ├── commandLine.ts         ← parser de la ligne de commande (texte → intention typée)
│   │       ├── fixtureTemplates.ts    ← templates prédéfinis (rgb, rgbw, dimmer)
│   │       └── math.ts                ← clamp(), addAlpha()
└── packages/
    └── shared/
        └── src/
            └── index.ts               ← tous les schémas Zod + types TypeScript partagés
```

---
## Architecture UI (frontend)

L'interface est un **pupitre grandMA2** : fond noir, fenêtres à liseré ambre et barre de titre bleue,
ligne de commande turquoise en bas, rail de touches à droite. Elle reste responsive (desktop / tablet /
mobile <640px) et le routing se fait par hash URL, sans dépendance de routeur.

### Châssis (`shell/AppShell.tsx`)

```
┌ StatusBar ── univers · sortie DMX · canaux · projecteurs · sélection · LED · horloge · Blackout ┐
│ TabBar ──── Live / Patch / Setup (masquée <640px)                                               │
│ ma-body ─── écran (la vue active)                    │ KeypadRail (≥1280px)                     │
│ CommandLine ─ ligne de retour + saisie + touches rapides                                        │
└ BottomNav ── navigation mobile (<640px uniquement)                                              ┘
```

Le `body` est en `overflow: hidden` : c'est l'écran (`.ma-screen`) qui défile, pas la page — le châssis
reste donc fixe comme sur un vrai pupitre.

### 3 vues

Le découpage suit l'usage d'un pupitre, pas l'organisation du code :

| Vue | Hash | Composant page | Contenu |
|-----|------|----------------|---------|
| **Live** | `#live` | `pages/LivePage.tsx` (lazy) | Le plan de travail : fenêtres déplaçables + barre des Views |
| **Patch** | `#patch` | `pages/PatchPage.tsx` | Le plateau, câblé et sans fil, en trois volets (voir ci-dessous) |
| **Setup** | `#setup` | `pages/SetupPage.tsx` | `HomeKitCard` + `MerossCard` + Système / Variables backend / Maintenance |

Les volets de **Patch** sont adressables et gardés dans l'URL, donc un lien partagé rouvre le bon :

| Volet | Hash | Contenu |
|-------|------|---------|
| *Projecteurs* | `#patch` | `FixturesTable` (en premier) + `FixtureForm` + `QxfLibraryPanel` |
| *Inventaire réseau* | `#patch/inventaire` | `DeviceInventory` — ce que le LAN expose, pilotable ou non |
| *Lampes connectées* | `#patch/lampes` | `patch/SmartLightsPane` — pastilles de backend + `SmartLightsPanel` |

> **Historique.** Il y avait auparavant six onglets. « Tableau de bord » ne faisait que répéter la barre
> d'état (fps, canaux actifs, nombre de projecteurs) et renvoyait ailleurs par des liens ; « Appareils »
> et « Lampes connectées » coupaient en deux un même geste (découvrir puis piloter) ; le Mode Dance
> apparaissait à la fois sur le tableau de bord et dans Live. Puis la vue « Réseau » a fondu dans
> « Patch » : découvrir une Nanoleaf, l'appairer et lui donner une adresse DMX est un seul geste, et
> « de quoi est fait le plateau ? » une seule question — elle survit comme deux volets. Les anciens
> hashs (`#dashboard`, `#projecteurs`, `#reseau`, `#lampes`, `#appareils`, `#reglages`) restent valides
> et sont traduits par `resolveRoute()` dans `shell/tabs.ts`, vers le volet qui a repris leur contenu :
> un signet ou un raccourci d'écran d'accueil continue de marcher.

### Le plan de travail (`components/console/`)

La vue Live n'est **pas** une page qui défile. Un pupitre ne défile pas : sélection, encodeurs et
executors se regardent en même temps. C'est donc un plan sur lequel on pose des fenêtres.

- `lib/console/layout.ts` — le modèle. Repère en **grille** : `x`/`w` en colonnes sur 24, `y`/`h` en
  rangées de `ROW_PX` (30 px). La disposition suit donc la largeur de l'écran au lieu de se décaler, et
  les fenêtres s'accrochent entre elles. Quatre **Views** d'origine : `Programmer`, `Playback`, `DMX`,
  `Effets`.
- `components/console/ConsoleWindow.tsx` — le cadre. Deux gestes : glisser la barre de titre déplace,
  glisser le coin bas-droit redimensionne. Pointer Events (souris / tactile / stylet, même code),
  `touch-action: none` sur les poignées, géométrie en cours de glissement dans un état **local** — le
  plan n'est re-rendu qu'au relâchement.
- `components/console/Workspace.tsx` — le gestionnaire : Views, ajout/fermeture de fenêtres, ordre
  d'empilement, Reset. Sous **1024 px** les fenêtres sont empilées en cartes (`.ma-win-static`) : on ne
  déplace pas des fenêtres au pouce.
- `components/console/windows/registry.tsx` — `WindowKind` → composant. **Un seul endroit à toucher**
  pour ajouter une fenêtre : déclarer le type dans `layout.ts`, ajouter l'entrée ici.

Types de fenêtres : `fixtures`, `encoders`, `executors`, `playbacks`, `groups`, `presets`, `faders`,
`dmx`, `dance`, `log`.

La disposition est persistée dans `localStorage` (`lib/localStore.ts`) : elle décrit le **poste de
travail**, pas le spectacle.

### Les pools (`contexts/ConsoleContext.tsx`)

C'est la couche qui manquait. Le backend savait déjà enregistrer une scène (`POST /api/scenes`), la
rejouer (`/activate`) et appliquer un preset (`/api/presets/:id/apply`) — **aucune UI ne s'en servait**.
La rangée d'executors était un décor : douze tuiles non cliquables, et aucun moyen d'enregistrer quoi
que ce soit depuis l'écran.

| Geste | Effet |
|-------|-------|
| `STORE n` | Photographie le programmer dans une scène et l'affecte à l'emplacement `n`. Sélection vide = tout le plateau. |
| `GO n` | Rejoue l'emplacement **côté backend** : tous les écrans connectés suivent. |
| `OFF n` | Met à zéro les seuls canaux que cette scène pilote. |
| Fader | Rejoue la scène à un niveau intermédiaire (master d'intensité). |
| `STORE GROUP n` / `GROUP n` | Fige / rappelle une sélection de projecteurs. |
| `STORE PRESET n` / `PRESET n` | Fige / applique une carte canal → valeur. |

Deux points de conception à ne pas défaire :

- **Un master n'atténue que la lumière.** `lib/console/scenes.ts` ne met à l'échelle que les capabilities
  `intensity`, `r`, `g`, `b`, `w`, `uv` ; pan, tilt, gobo et roue de couleurs sont rejoués à leur valeur
  mémorisée. Baisser un playback baisse l'intensité, il ne fait pas dériver la lyre à mi-course.
- **Les écritures de fader sont regroupées par frame.** Sans ça, glisser un playback émettrait un
  `POST /api/universe/:channel` par canal **et** par événement pointeur : sur une scène contenant le
  strip Nanoleaf (150 canaux), un seul geste noierait le backend. `setLevel` ne garde que la dernière
  valeur demandée et l'applique une fois par `requestAnimationFrame`.

Répartition de la persistance : **scènes et presets → backend** (ils appartiennent au spectacle) ;
**groupes, numéro d'emplacement d'un executor, disposition des fenêtres → localStorage** (ils
appartiennent au poste). Conséquence assumée : les groupes ne suivent pas d'un navigateur à l'autre.
Les rendre partagés demanderait une table `Group` côté Prisma.

### Projecteurs verrouillés (`lib/fixtureGuard.ts`)

Garde-fou de sécurité : certains projecteurs ne doivent **jamais** être allumés (le PAR de la chambre
quand quelqu'un y dort). Les masquer serait un mauvais garde-fou — un projecteur invisible finit par être
rallumé « par accident » depuis la ligne de commande ou une scène rappelée.

Ils sont donc **visibles mais verrouillés** : cadenas dans la fixture sheet, cellule hachurée, clic sans
effet. Le blocage vit dans `SelectionContext` (un verrouillé ne peut pas entrer dans le programmer), donc
la fixture sheet, `ALL`, les groupes, les encodeurs et la ligne de commande en héritent sans y penser.
`captureScene` et `applySceneAtLevel` les écartent aussi, à l'enregistrement comme au rappel.

Règle : **liste blanche**. Verrouillage par pièce (`chambre`), par nom (`/\bchambre\b/i`) ou par id.
À ne pas confondre avec `lib/hiddenFixtures.ts`, qui est un filtre purement cosmétique.

### Navigation responsive

- **Desktop / tablet (≥640px)** : `shell/TabBar.tsx` — barre de vues numérotées (icônes lucide-react).
- **Mobile (<640px)** : `shell/BottomNav.tsx` — nav basse avec `env(safe-area-inset-bottom)`.
- **Rail de touches** : `shell/KeypadRail.tsx`, affiché seulement ≥1280px.
- **Plan de travail** : fenêtres déplaçables ≥1024px, empilées en dessous (`hooks/useMediaQuery.ts`).
- Routing : `shell/useHashTab.ts`. Deep-link `#live` rendu au premier paint (hash lu en synchrone).

### Sélection et ligne de commande

Trois briques, qui parlent d'**attributs** (Dimmer, Red, Pan…) et jamais de numéros de canaux :

- `contexts/SelectionContext.tsx` — la sélection courante (le *programmer*). Elle survit aux changements
  de vue, et refuse les projecteurs verrouillés.
- `lib/programmer.ts` — traduit un attribut en canaux DMX absolus (`channelsForAttr`), lit une valeur
  (`readAttr`, convention HTP sur une sélection multiple) et écrit (`applyAttr`). Le dimmer retombe sur
  les canaux r/g/b quand la fixture n'a pas de canal d'intensité dédié — cas des PAR RGB.
- `lib/commandLine.ts` — parser pur : texte → intention typée (`ParsedCommand`), sans jamais lever
  d'exception. L'exécution vit dans `contexts/CommandContext.tsx`, partagé par la barre du bas, le rail
  de touches et les tuiles des pools (via `report`).

Syntaxe supportée (valeurs en **pourcent** par défaut, suffixe `d`/`dmx` pour du brut 0-255) :

| Commande | Effet |
|----------|-------|
| `FIX 1 THRU 3` / `1 + 4` | sélectionne des fixtures par leur numéro d'affichage dans la sheet |
| `FIX 1 AT 50` | sélectionne puis règle le dimmer |
| `AT 50` · `FULL` · `OUT` | règle le dimmer de la sélection courante |
| `RED 100` · `PAN 51D` | règle un attribut de la sélection |
| `CH 12 THRU 20 AT 75` | écrit directement des canaux de l'univers |
| `ALL` · `CLEAR` | sélectionne tout (hors verrouillés) / vide la sélection |
| `STORE 1 Ambiance` | mémorise le programmer dans l'executor 1 |
| `GO 1` · `OFF 1` | rejoue / éteint un executor |
| `STORE GROUP 2 Salon` · `GROUP 2` | mémorise / rappelle un groupe de sélection |
| `STORE PRESET 3 Bleu` · `PRESET 3` | mémorise / applique un preset |
| `BLACKOUT` | remet les 512 canaux à zéro |
| `GOTO PATCH` | change de vue (`live`, `patch`, `setup`) ; `goto reseau` / `appareils` / `lampes` ouvrent le volet correspondant de Patch |

Les mots-clés existent aussi en français (`projecteur`, `canal`, `rouge`, `couleur`, `groupe`…) et les
accents sont ignorés. `OFF` seul reste le raccourci « dimmer à zéro » ; c'est la présence d'un numéro
(`OFF 3`) qui en fait un Off d'executor.

### State management

Deux contexts pour **isoler les re-renders haute fréquence** :

- `contexts/AppDataContext.tsx` — Provider central. Queries (`fixtures`, `scenes`, `library`,
  `homekit`), mutations, handlers WS, `wsBadge`, `logHistory` (rolling 10), `handleBlackout`. Value
  mémoïzée pour ne pas réagir aux ticks `universe_tick`.
- `contexts/UniverseStateContext.tsx` — expose **deux** choses :
  - `useUniverseState()` : la valeur qui change à chaque tick (30 Hz). S'y abonner fait re-rendre
    30 fois par seconde — c'est voulu pour un fader ou une cellule de sheet, et seulement pour eux.
  - `useUniverseValuesRef()` : une **ref stable** vers le dernier tableau de valeurs, qui ne déclenche
    jamais de rendu. C'est ce qu'utilise `ConsoleContext` pour lire l'univers au moment d'un STORE sans
    se réveiller à chaque trame. À n'utiliser que dans un gestionnaire d'événement, jamais au rendu.
- WebSocket monté **une seule fois** dans `AppDataProvider` → survit aux changements de vue.

Ordre des providers (imposé par les dépendances) : `AppData` → `Selection` → `Console` → `Command`.

### Extensibilité Smart Lights

`components/smart-lights/backendRegistry.ts` — registre central des backends affichables :

```ts
export const SMART_LIGHT_BACKENDS = [
  { id: "nanoleaf-http", label: "Nanoleaf", icon: Lightbulb, description: "…" }
  // Ajout futur : { id: "hue", label: "Philips Hue", icon: ..., ... }
];
```

`SmartLightsPanel` accepte une prop `backendFilter` ; le volet *Lampes connectées* de Patch
(`pages/patch/SmartLightsPane.tsx`) consomme `SMART_LIGHT_BACKENDS` pour rendre les pastilles de filtre. Ajouter une ampoule Hue / Matter = ajouter une entrée + un nouveau type
dans `SmartLight.config.type` (union discriminée dans `shared/`).

### CSS (`frontend/src/styles.css`)

Feuille unique, sans framework, organisée en sections commentées (variables → châssis → fenêtres →
boutons → formulaires → tables → faders → sheet → **plan de travail et pools** → blocs spécifiques →
responsive).

- **Thème** : tokens `--edge` (ambre, le liseré signature), `--blue` (barres de titre), `--teal` (ligne
  de commande), `--yellow` (sélection, valeurs). Aucun arrondi : `border-radius: 0` partout.
- **Fenêtres du plan de travail** (`.ma-win`) : positionnées en `%` de colonne et en pixels de rangée.
  `.ma-win-title` porte `touch-action: none` (sans quoi le tactile ferait défiler au lieu de déplacer).
  Un panneau conçu comme une carte autonome posé dans une fenêtre perd son cadre : `.ma-win-body .card`
  neutralise fond, bordure et barre de titre pour éviter deux cadres imbriqués.
- **Cartes classiques** (`.card`, hors plan de travail) : le `<h2>` devient la barre de titre bleue
  pleine largeur (marges négatives) avec la bille jaune en `::before`. Mettre le `<h2>` en enfant direct
  de la `.card`.
- **Pools** (`.pool-tile`) : code couleur par pool — executors rouge sombre, groupes bleu, presets
  violet ; emplacement libre en liseré pointillé.
- Breakpoints : `<640px` (mobile) / `640-1023px` (tablet) / `≥1024px` (plan de travail) / `≥1280px`
  (rail de touches).
- `.channels` : `repeat(16, …)` → `repeat(12, …)` → `repeat(8, …)` → `repeat(4, …)`.
- `.table` se transforme en cartes empilées sur mobile via `data-label="…"` + pseudo-elements.

> Les faders et molettes ne sont **pas** des `<input type="range">` : `ma/MaFader.tsx` et `ma/MaKnob.tsx`
> sont pilotés aux Pointer Events, avec `role="slider"` et raccourcis clavier.

### Dépendances frontend

- `lucide-react` — icônes (dont `LayoutGrid`, `GripHorizontal`, `Play`, `Square`, `Save`, `Lock`).
- React Query 4, three.js + @react-three/fiber/drei (lazy dans `LayoutEditor3D`), qrcode.react.

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
  zones?: SmartLightDmxZoneMirror;  // mirror par zone (le strip devient un projecteur multi-cellules)
}

// Mirror DMX par zone : bloc de canaux consécutifs, 3 canaux (R, G, B) par zone.
// zone i → startChannel + 3i (R), +1 (G), +2 (B). Passe par le streaming UDP.
interface SmartLightDmxZoneMirror {
  universe?: number;
  startChannel: number;  // 1–512
  zoneCount: number;     // 1–170 (170 × 3 = 510 canaux)
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
| `POST` | `/api/smart-lights/:id/dmx-fixture` | `{ zoneCount?, startChannel?, universe?, name?, room? }` | Expose le strip en projecteur DMX (3 canaux R/G/B par zone) : crée/maj le projecteur et branche `dmxMirror.zones`. Corps entièrement optionnel — adresse auto-allouée. Renvoie `{ light, fixture }` |
| `DELETE` | `/api/smart-lights/:id/dmx-fixture` | — | Supprime le projecteur généré et débranche `dmxMirror.zones` |
| `POST` | `/api/smart-lights/:id/layout` | `SmartLightZoneLayout \| null` | Sauvegarde le placement 3D des zones |
| `POST` | `/api/smart-lights/:id/effect` | `SmartLightEffectConfig \| null` | Active un effet position-aware (l'EffectEngine prend le relais) |
| `GET` | `/api/smart-lights/:id/effects` | — | Liste les effets builtin du device (Nanoleaf) |
| `POST` | `/api/smart-lights/:id/effects/select` | `{ name }` | Active un effet builtin Nanoleaf (sort du mode streaming si actif) |
| `POST` | `/api/smart-lights/probe` | `{ host, port? }` | Test rapide de reachability sans pairing |
| `POST` | `/api/smart-lights/discover` | `{ timeoutMs? }` | Scan mDNS (~3 s par défaut) — retourne les Nanoleaf trouvés |

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

Le frontend, lui, ne code jamais cette URL en dur : `wsUrl()` (`frontend/src/lib/api.ts`) dérive l'URL de **l'origine de la page** — `wss://` si la page est servie en HTTPS, et `window.location.host` (port inclus). Il emprunte donc le proxy `/ws` exactement comme les appels `/api` : Vite en dev, reverse proxy en façade. Voir [Exposition réseau](#exposition-réseau-reverse-proxy).

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

### DMX Mirror par zone (strip = projecteur multi-cellules)

Si `light.dmxMirror.zones = { startChannel, zoneCount }` est défini, `readZoneMirror()` lit à chaque tick DMX un bloc de `zoneCount × 3` canaux consécutifs et en fait une frame per-zone :

```
zone 0 → startChannel (R), +1 (G), +2 (B)
zone 1 → startChannel+3 (R), +4 (G), +5 (B)   …
```

**Requiert `streaming.enabled = true`** : la frame part par le path UDP extControl (`streamAll` → `sendZones`), pas par HTTP.

**Priorité LTP (latest takes precedence)** — pour que configurer ce mirror ne rende pas le painter et les effets inutilisables :

| Événement | Effet |
|-----------|-------|
| Le bloc DMX change de valeur | `dmxZonesOwned = true` — le DMX possède le strip, **avant** la garde `desired.on` (un blackout DMX éteint donc bien le strip) et avant `currentEffect` |
| `applyState` / `applyZones` / `setEffect` / `selectEffect` | `dmxZonesOwned = false` — le pilotage local reprend jusqu'au prochain mouvement DMX |
| Premier tick après `register`, bloc entièrement à 0 | Pas de prise de main (sinon un bloc vide éteindrait un effet en cours au démarrage) |

Le `POST /api/smart-lights/:id/dmx-fixture` fait le câblage complet : il crée un projecteur de `zoneCount × 3` canaux (`buildZoneRgbChannels()` dans `shared` — capabilities `r`/`g`/`b`, nommés « Zone N Rouge/Vert/Bleu »), alloue automatiquement le premier bloc de canaux libre si aucune adresse n'est donnée, et branche `dmxMirror.zones` dessus. Le projecteur généré est créé avec `homekit: { enabled: false }` : la lampe est déjà exposée nativement par Nanoleaf, et un accessoire HomeKit ne saurait piloter que la première zone.

### Méthodes principales du SmartLightService

| Méthode | Rôle |
|---------|------|
| `register(light)` | Ajoute ou remplace une light dans le registry, initialise le client et le streamer si configuré |
| `unregister(id)` | Stoppe le streamer et supprime du registry |
| `applyState(id, patch)` | Met à jour `desired` depuis un patch (rgb / hue / sat / brightness / ct / on), trigger flush |
| `applyZones(id, palette)` | Push direct un palette per-zone (requiert streaming actif) |
| `readZoneMirror(entry, cfg, state)` | *(privé)* Lit le bloc DMX par zone à chaque tick et gère la prise de main LTP |
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

### WebSocket derrière un reverse proxy HTTPS — Mixed Content
Si `wsUrl()` produit une URL `ws://` en dur (ou vise le port 5000 directement), une page servie en HTTPS échoue avec `SecurityError: Failed to construct 'WebSocket'` + `Mixed Content: ... attempted to connect to the insecure WebSocket endpoint`. L'exception remonte jusqu'à `AppDataProvider` et l'interface reste vide. `wsUrl()` doit **suivre l'origine de la page** : `wss` si `location.protocol === "https:"`, et `location.host` (avec son port) — jamais `location.hostname` seul. Voir [WebSocket](#websocket).

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

