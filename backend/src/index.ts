// Point d'entree du backend Fastify.
// Role : lire la configuration (variables d'environnement), construire et cabler tous les
// services (store SQLite, DMX, pont HomeKit, lampes connectees), brancher les
// diffusions WebSocket, persister periodiquement l'univers DMX, puis demarrer le serveur.
// ATTENTION : le backend est verrouille sur le port 5000 (voir PORT) et quitte si le port
// est deja pris, pour garantir une seule instance.
import "dotenv/config";
import path from "node:path";
import Fastify from "fastify";
import { registerRoutes } from "./routes";
import { createErrorHandler } from "./routes/errors";
import { DmxService } from "./services/dmx";
import { HomeKitBridge } from "./services/homekit";
import { MerossPlugService } from "./services/meross-plug";
import { EffectRunner } from "./services/effects/runner";
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
// ----- Prise connectee Meross (pilotee en local sur le LAN) -----
// La config (IP, device key, canal, activation) est persistee en base et reglable
// depuis l'UI. Les variables d'env ci-dessous ne servent qu'a AMORCER (seed) la
// ligne de config au tout premier lancement (base vide).
const MEROSS_PLUG_HOST = process.env.MEROSS_PLUG_HOST;
const MEROSS_PLUG_KEY = process.env.MEROSS_PLUG_KEY;
const MEROSS_PLUG_CHANNEL = process.env.MEROSS_PLUG_CHANNEL ? parseInt(process.env.MEROSS_PLUG_CHANNEL, 10) : 0;
const MEROSS_PLUG_REASSERT_MS = process.env.MEROSS_PLUG_REASSERT_MS
  ? parseInt(process.env.MEROSS_PLUG_REASSERT_MS, 10)
  : 30000;
// Extinction auto : duree (ms) de blackout DMX complet avant de couper la prise (defaut 5 min).
const MEROSS_OFF_TIMEOUT_MS = process.env.MEROSS_OFF_TIMEOUT_MS
  ? parseInt(process.env.MEROSS_OFF_TIMEOUT_MS, 10)
  : 5 * 60 * 1000;
// Projecteurs dont un changement de valeur DMX doit garantir que la prise est allumee.
const MEROSS_TRIGGER_FIXTURES = (process.env.MEROSS_TRIGGER_FIXTURES ?? "Stairville MH X20,Par 56 Lava,Par 56 Cafe")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Periode de lecture de la mesure electrique instantanee (prises avec metrologie).
const MEROSS_ELECTRICITY_POLL_MS = process.env.MEROSS_ELECTRICITY_POLL_MS
  ? parseInt(process.env.MEROSS_ELECTRICITY_POLL_MS, 10)
  : 15000;

// Amorce de config (utilisee seulement si la base ne contient pas encore de ligne).
const MEROSS_SEED = {
  enabled: Boolean(MEROSS_PLUG_HOST && MEROSS_PLUG_KEY),
  host: MEROSS_PLUG_HOST ?? "",
  key: MEROSS_PLUG_KEY ?? "",
  channel: Number.isNaN(MEROSS_PLUG_CHANNEL) ? 0 : MEROSS_PLUG_CHANNEL
};

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
const meross = new MerossPlugService(app.log, dmx, store, {
  triggerFixtureNames: MEROSS_TRIGGER_FIXTURES,
  reassertMs: Number.isNaN(MEROSS_PLUG_REASSERT_MS) ? 30000 : MEROSS_PLUG_REASSERT_MS,
  offTimeoutMs: Number.isNaN(MEROSS_OFF_TIMEOUT_MS) ? 5 * 60 * 1000 : MEROSS_OFF_TIMEOUT_MS,
  requestTimeoutMs: 4000,
  electricityPollMs: Number.isNaN(MEROSS_ELECTRICITY_POLL_MS) ? 15000 : MEROSS_ELECTRICITY_POLL_MS
});
const websocket = createWebsocketManager({ logger: app.log, store, dmx });
const smartLights = new SmartLightService(app.log, dmx, store);
// Moteur d'effets DMX : il tourne au-dessus de l'univers, pas au-dessus d'une
// lampe. Il recoit le patch par fonctions plutot que le store, pour rester
// testable sans base et n'avoir aucune opinion sur la persistance.
const effects = new EffectRunner(app.log, dmx);
// Le pont HomeKit expose aussi les lampes connectees, en un seul accessoire chacune.
// Injection apres coup : le pont est construit avant le SmartLightService.
homekit.attachSmartLights(smartLights);
const handleError = createErrorHandler(app.log);

registerRoutes(
  app,
  { store, dmx, homekit, smartLights, meross, effects, broadcast: websocket.broadcast },
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
  await smartLights.stop();
  await meross.stop();
  effects.stop();
  await dmx.stop();
  await homekit.stop();
  await store.disconnect();
});

// ----- Demarrage du serveur -----
// Sequence d'initialisation : connecter le store, restaurer l'univers, demarrer DMX puis
// HomeKit, les lampes connectees, et enfin ecouter les requetes HTTP/WebSocket.
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
    const fixtures = await store.listFixtures();
    await homekit.start(fixtures);
    // Pilotage de la prise Meross : surveille les changements DMX des projecteurs cibles.
    // MEROSS_SEED n'amorce la config que si la base est vide (1er lancement).
    await meross.start(fixtures, MEROSS_SEED);
    await smartLights.start();
    effects.start(
      () => store.listFixtures(),
      () => smartLights.listWithState()
    );
    // Les accessoires de lampes ne peuvent etre crees qu'une fois le service demarre
    // (c'est lui qui porte l'etat) et le pont publie.
    homekit.syncSmartLights(smartLights.listWithState());
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
