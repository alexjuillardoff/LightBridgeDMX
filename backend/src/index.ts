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
const dance = new DanceService(app.log, dmx, store);
const smartLights = new SmartLightService(app.log, dmx, store);
const handleError = createErrorHandler(app.log);

registerRoutes(
  app,
  { store, dmx, homekit, dance, smartLights, broadcast: websocket.broadcast },
  handleError
);

dmx.on("tick", (state) => {
  websocket.broadcast({ type: "universe_tick", data: state });
});

dance.on("state", (state) => {
  websocket.broadcast({ type: "dance_state", data: state });
});

smartLights.on("light_updated", (light) => {
  websocket.broadcast({ type: "smart_light_updated", data: light });
});

app.addHook("onClose", async () => {
  await dance.stop();
  await smartLights.stop();
  await dmx.stop();
  await homekit.stop();
  await store.disconnect();
});

const start = async () => {
  try {
    await store.connect();
    await dmx.start();
    await homekit.start(await store.listFixtures());
    await dance.init();
    await smartLights.start();
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
