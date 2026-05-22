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

if (process.env.PORT && process.env.PORT !== PORT.toString()) {
  app.log.warn(`Ignoring PORT=${process.env.PORT}; backend is locked to ${PORT}`);
}

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
// SmartLightService is created before DanceService so it can be injected — DanceService
// uses it to claim/release smart lights and read their layouts when building chase groups.
const smartLights = new SmartLightService(app.log, dmx, store);
const dance = new DanceService(app.log, dmx, store, smartLights);
const handleError = createErrorHandler(app.log);

registerRoutes(
  app,
  { store, dmx, homekit, dance, smartLights, broadcast: websocket.broadcast },
  handleError
);

// Persist the universe values at most once per second, and only when they
// have actually changed since the last snapshot. Restored at startup so
// projectors keep their state across backend restarts.
const UNIVERSE_SAVE_INTERVAL_MS = 1000;
let lastSavedValues: number[] | null = null;
let pendingSave: NodeJS.Timeout | null = null;

const valuesEqual = (a: number[] | null, b: number[]) => {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const scheduleUniverseSnapshot = (values: number[]) => {
  if (pendingSave) return;
  if (valuesEqual(lastSavedValues, values)) return;
  pendingSave = setTimeout(async () => {
    pendingSave = null;
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

dmx.on("tick", (state) => {
  websocket.broadcast({ type: "universe_tick", data: state });
  scheduleUniverseSnapshot(state.values);
});

dance.on("state", (state) => {
  websocket.broadcast({ type: "dance_state", data: state });
});

smartLights.on("light_updated", (light) => {
  websocket.broadcast({ type: "smart_light_updated", data: light });
});

app.addHook("onClose", async () => {
  if (pendingSave) clearTimeout(pendingSave);
  // Best-effort final snapshot so the most recent state survives shutdown.
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

const start = async () => {
  try {
    await store.connect();
    // Restore the previously-persisted universe BEFORE starting the DMX
    // service, so the first Art-Net frame already carries those values.
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
    // SmartLightService must be started before DanceService.init() — Dance reads
    // layouts via smartLights.listWithState() to autoseed + build side groups.
    await smartLights.start();
    await dance.init();
    await app.listen({ port: PORT, host: "0.0.0.0" });

    websocket.attach(app.server);
    app.log.info(`LightBridgeDMX backend running on ${PORT} (WS on /ws)`);
  } catch (err) {
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
