# Architecture

## Vue d’ensemble
- Monorepo pnpm : backend Fastify/TypeScript + frontend React/Vite + package partagé de types/schemas.
- Backend écoute en **HTTP+WS sur 5000** (forcé), publie DMX en **Art-Net** vers QLC+ qui bridge vers l’interface DMX.
- Frontend dev sur **5173** (Vite) avec proxy `/api` et `/ws` vers le backend.
- État persisté en **SQLite via Prisma** (`backend/data/lightbridge.db`). HomeKit via hap-nodejs : ampoules RGB + lyres (WindowCovering pan/tilt/color/gobo + Lightbulb dimmer).

## Flux runtime (prod/dev)
1) Frontend appelle l’API REST (`/api/...`) et le WS (`/ws`) du backend.  
2) Backend manipule l’état en mémoire et diffuse en temps réel via WS (`universe_tick`, `fixture_updated`).  
3) Backend envoie le DMX en Art-Net (`DMX_OUTPUT=artnet`, `ARTNET_HOST=192.168.0.200`) → QLC+ → interface DMX.  
4) Si aucune interface n’est disponible, le backend passe en simulation.

## Arborescence et rôle des fichiers

### Racine
- `package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml` : scripts racine (`dev|build|lint|format|test`) et définition des workspaces.
- `tsconfig.base.json` : options TypeScript communes (CJS, paths `@lightbridgedmx/shared`).
- `README.md` : guide d’usage (ports, DMX Art-Net, launchd).
- `ARCHITECTURE.md` : ce document.
- `TODO.md` : notes de travaux.
- `node_modules/`, `ts-node-dev/` : dépendances/outils locaux.
- `logs/` : sortie std/err des services launchd dev.

### Backend (`backend/`)
- `package.json` : scripts (`dev` via ts-node-dev, `build` via tsc), dépendances Fastify/WS/DMX/HomeKit.
- `tsconfig.json` : compilation CJS vers `dist/`.
- `src/index.ts` : point d’entrée Fastify. Routes REST (fixtures, scènes, presets, test DMX, QXF library), websocket `/ws`, broadcast DMX tick, démarrage DMX + pont HomeKit RGB, port 5000 verrouillé.
- `src/services/dmx.ts` : service DMX (dmx-ts), modes Art-Net/Enttec, timer FPS, simulation fallback.
- `src/services/homekit.ts` : pont HomeKit (hap-nodejs). Deux types d'accessories : `Lightbulb` RGB (Hue/Saturation/Brightness ↔ canaux R/G/B) et lyres multi-services (`Lightbulb` dimmer + `WindowCovering` pan/tilt/color/gobo). Synchro bidirectionnelle via le tick DMX.
- `routes/homekit.ts` : endpoint `GET /api/homekit` pour récupérer l’état du bridge (setup URI, fixtures exportées).
- `src/services/qxf.ts` : parsing XML QXF, construction de fixtures depuis la bibliothèque.
- `src/services/qxf-library.ts` : téléchargement/cache de la librairie QLC+, lecture des fichiers QXF.
- `src/state/store.ts` : stockage SQLite/Prisma des fixtures/scènes/presets, validation, erreurs métier.
- `dist/**` : sortie JS compilée (CJS) pour le runtime.

### Frontend (`frontend/`)
- `package.json` : scripts Vite (`dev`, `build`, `preview`), deps React + React Query.
- `vite.config.ts` : proxy API/WS vers `http://localhost:5000`, serveur dev `host: true`, port 5173.
- `src/main.tsx` : bootstrap React/Vite.
- `src/App.tsx` : vue principale (UI dashboard).
- `src/lib/api.ts` : client API/WS (base URL, wsUrl, helpers fetch JSON).
- `src/styles.css` : styles globaux.
- `dist/` : build Vite (prod).
- Fonctionnalités UI clés : import QXF, CRUD fixtures (suppression incluse, remet les canaux à zéro), regroupement couleur par projecteur dans Live DMX, grille 8×N scrollable, sliders verticaux élargis pour le tactile/mobile.

### Shared (`packages/shared/`)
- `src/index.ts` : types et schémas Zod partagés (Fixture, Scene, Preset, WsEvent…).
- `src/index.js` : build JS du package partagé.

## Ops / services persistants (macOS)
- LaunchAgents :  
  - `~/Library/LaunchAgents/com.lightbridgedmx.backend.dev.plist` → `pnpm -C backend dev` avec `DMX_OUTPUT=artnet ARTNET_HOST=192.168.0.200 ARTNET_UNIVERSE=0 DMX_FPS=30`.  
  - `~/Library/LaunchAgents/com.lightbridgedmx.frontend.dev.plist` → `pnpm -C frontend dev`.  
- Logs : `logs/backend-dev.{out,err}.log`, `logs/frontend-dev.{out,err}.log`.
- Commandes utiles : `launchctl kickstart -k gui/501/com.lightbridgedmx.backend.dev`, `launchctl bootout gui/501 ~/Library/LaunchAgents/com.lightbridgedmx.backend.dev.plist` (idem frontend), `lsof -i :5000|:5173` pour vérifier l’écoute.
