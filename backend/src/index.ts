// Point d'entree du backend Fastify.
// Role : lire la configuration (variables d'environnement), construire et cabler tous les
// services (store SQLite, DMX, pont HomeKit, lampes connectees, Dance), brancher les
// diffusions WebSocket, persister periodiquement l'univers DMX, puis demarrer le serveur.
// ATTENTION : le backend est verrouille sur le port 5000 (voir PORT) et quitte si le port
// est deja pris, pour garantir une seule instance.
import "dotenv/config";
import path from "node:path";
import Fastify from "fastify";
import { registerRoutes } from "./routes";
import { createErrorHandler } from "./routes/errors";
import { DanceService } from "./services/dance";
import { DmxService } from "./services/dmx";
import { HomeKitBridge } from "./services/homekit";
import { SmartLightService } from "./services/smart-lights";
import { createWebsocketManager } from "./websocket";
import { Store } from "./state/store";

// ----- Configuration depuis l'environnement -----
// ATTENTION : port verrouille, ne pas modifier (voir avertissement plus bas si PORT differe).
const PORT = 5000;
const DMX_FPS = parseInt(process.env.DMX_FPS ?? "30", 10);
const DMX_PORT = process.env.DMX_PORT;
const DMX_OUTPUT = (process.env.DMX_OUTPUT ?? "enttec") as "enttec" | "artnet";
const ARTNET_HOST = process.env.ARTNET_HOST;
const ARTNET_PORT = process.env.ARTNET_PORT ? parseInt(process.env.ARTNET_PORT, 10) : undefined;
const ARTNET_UNIVERSE = process.env.ARTNET_UNIVERSE ? parseInt(process.env.ARTNET_UNIVERSE, 10) : undefined;
const HOMEKIT_ENABLED = ["1", "true", "yes", "on"].includes((process.env.HOMEKIT_ENABLED ?? "").toLowerCase());
const HOMEKIT_NAME = process.env.HOMEKIT_NAME ?? "LightBridgeDMX Bridge";
const HOMEKIT_PIN = process.env.HOMEKIT_PIN ?? "031-45-154";
const HOMEKIT_USERNAME = process.env.HOMEKIT_USERNAME ?? "11:22:33:44:55:66";
const HOMEKIT_PORT = process.env.HOMEKIT_PORT ? parseInt(process.env.HOMEKIT_PORT, 10) : undefined;
const HOMEKIT_SETUP_ID = process.env.HOMEKIT_SETUP_ID;
const HOMEKIT_STORAGE = process.env.HOMEKIT_STORAGE ?? path.join(process.cwd(), ".homekit");

const app = Fastify({ logger: true });

// Si on tente de forcer un autre port via PORT, on l'ignore et on previent : le port 5000
// est impose par convention (voir MEMORY).
if (process.env.PORT && process.env.PORT !== PORT.toString()) {
  app.log.warn(`Ignoring PORT=${process.env.PORT}; backend is locked to ${PORT}`);
}

// ----- Construction des services -----
const store = new Store();
const dmx = new DmxService(app.log, {
  fps: Number.isNaN(DMX_FPS) ? undefined : DMX_FPS,
  port: DMX_PORT ?? undefined,
  output: DMX_OUTPUT,
  artnetHost: ARTNET_HOST,
  artnetPort: ARTNET_PORT,
  artnetUniverse: ARTNET_UNIVERSE
});
const homekit = new HomeKitBridge(app.log, dmx, {
  enabled: HOMEKIT_ENABLED,
  name: HOMEKIT_NAME,
  pin: HOMEKIT_PIN,
  username: HOMEKIT_USERNAME,
  port: HOMEKIT_PORT,
  setupId: HOMEKIT_SETUP_ID,
  storagePath: HOMEKIT_STORAGE
});
const websocket = createWebsocketManager({ logger: app.log, store, dmx });
// SmartLightService est cree AVANT DanceService pour pouvoir lui etre injecte : Dance s'en
// sert pour reserver/liberer (claim/release) les lampes connectees et lire leurs dispositions
// (layouts) quand il construit les groupes du chenillard (chase).
const smartLights = new SmartLightService(app.log, dmx, store);
const dance = new DanceService(app.log, dmx, store, smartLights);
const handleError = createErrorHandler(app.log);

registerRoutes(
  app,
  { store, dmx, homekit, dance, smartLights, broadcast: websocket.broadcast },
  handleError
);

// ----- Persistance de l'univers DMX -----
// On sauvegarde les valeurs de l'univers au plus une fois par seconde, et seulement si elles
// ont vraiment change depuis le dernier instantane (snapshot). Au demarrage, on restaure ce
// snapshot pour que les projecteurs gardent leur etat apres un redemarrage du backend.
const UNIVERSE_SAVE_INTERVAL_MS = 1000;
let lastSavedValues: number[] | null = null;
let pendingSave: NodeJS.Timeout | null = null;

// Compare deux tableaux de valeurs de canaux (egalite element par element).
const valuesEqual = (a: number[] | null, b: number[]) => {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

// Programme une sauvegarde differee de l'univers (throttle a 1 s). On evite les ecritures
// inutiles : si une sauvegarde est deja en attente, ou si rien n'a change, on ne fait rien.
const scheduleUniverseSnapshot = (values: number[]) => {
  if (pendingSave) return;
  if (valuesEqual(lastSavedValues, values)) return;
  pendingSave = setTimeout(async () => {
    pendingSave = null;
    // On relit l'instantane au moment de l'ecriture (l'etat a pu encore evoluer pendant
    // l'attente) et on revalide qu'il y a bien un changement.
    const snapshot = dmx.getUniverseSnapshot();
    if (valuesEqual(lastSavedValues, snapshot)) return;
    try {
      await store.saveUniverseSnapshot(snapshot);
      lastSavedValues = snapshot;
    } catch (err) {
      app.log.warn({ err }, "Failed to persist universe snapshot");
    }
  }, UNIVERSE_SAVE_INTERVAL_MS);
};

// ----- Cablage des evenements vers la diffusion (broadcast) WebSocket -----
// A chaque tick (battement) DMX : on diffuse l'etat des canaux aux clients et on programme
// une eventuelle sauvegarde de l'univers.
dmx.on("tick", (state) => {
  websocket.broadcast({ type: "universe_tick", data: state });
  scheduleUniverseSnapshot(state.values);
});

// Etat du Mode Dance (chenillard) : diffuse a l'UI a chaque changement.
dance.on("state", (state) => {
  websocket.broadcast({ type: "dance_state", data: state });
});

// Mise a jour d'une lampe connectee : diffuse a l'UI.
smartLights.on("light_updated", (light) => {
  websocket.broadcast({ type: "smart_light_updated", data: light });
});

// Arret propre du serveur : on coupe tous les services dans l'ordre et on tente une derniere
// sauvegarde de l'univers.
app.addHook("onClose", async () => {
  if (pendingSave) clearTimeout(pendingSave);
  // Derniere sauvegarde "best-effort" pour que l'etat le plus recent survive a l'extinction.
  try {
    await store.saveUniverseSnapshot(dmx.getUniverseSnapshot());
  } catch (err) {
    app.log.warn({ err }, "Failed to persist final universe snapshot");
  }
  await dance.stop();
  await smartLights.stop();
  await dmx.stop();
  await homekit.stop();
  await store.disconnect();
});

// ----- Demarrage du serveur -----
// Sequence d'initialisation : connecter le store, restaurer l'univers, demarrer DMX puis
// HomeKit, les lampes connectees, Dance, et enfin ecouter les requetes HTTP/WebSocket.
const start = async () => {
  try {
    await store.connect();
    // On restaure l'univers persiste AVANT de demarrer le service DMX, pour que la toute
    // premiere trame (frame) Art-Net porte deja ces valeurs (pas de flash a zero).
    try {
      const snapshot = await store.loadUniverseSnapshot();
      if (snapshot) {
        dmx.restoreUniverse(snapshot);
        lastSavedValues = snapshot;
        const nonZero = snapshot.filter((v) => v > 0).length;
        app.log.info({ nonZero }, "Restored universe snapshot from store");
      }
    } catch (err) {
      app.log.warn({ err }, "Failed to load universe snapshot, starting from zero");
    }
    await dmx.start();
    await homekit.start(await store.listFixtures());
    // SmartLightService doit demarrer AVANT DanceService.init() : Dance lit les dispositions
    // (layouts) via smartLights.listWithState() pour l'auto-amorcage (auto-seed) et la
    // construction des groupes lateraux du chenillard.
    await smartLights.start();
    await dance.init();
    await app.listen({ port: PORT, host: "0.0.0.0" });

    // Le serveur HTTP doit ecouter avant d'y attacher le WebSocket.
    websocket.attach(app.server);
    app.log.info(`LightBridgeDMX backend running on ${PORT} (WS on /ws)`);
  } catch (err) {
    // EADDRINUSE = port deja occupe : on quitte plutot que de lancer une 2e instance
    // (le port 5000 est reserve a une instance unique).
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.code === "EADDRINUSE") {
      app.log.error(`Port ${PORT} is already in use. Stop the other process to keep a single instance.`);
    } else {
      app.log.error(err);
    }
    process.exit(1);
  }
};

start();
