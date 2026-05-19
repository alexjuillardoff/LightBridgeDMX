import { EventEmitter } from "node:events";
import type { FastifyBaseLogger } from "fastify";
import { DMX, EnttecOpenUSBDMXDriver } from "dmx-ts";
import { SerialPort } from "serialport";
import { UniverseState } from "@lightbridgedmx/shared";

export type DmxWrite = {
  address: number;
  values: number[];
};

type DmxMode = "hardware" | "simulation";
type ArtnetClient = { set: (universe: number, channel: number, values: number[]) => void; close: () => void };
type SerialPortInfo = Awaited<ReturnType<typeof SerialPort.list>>[number];

export type DmxServiceOptions = {
  fps?: number;
  port?: string;
  universe?: number;
  output?: "enttec" | "artnet";
  artnetHost?: string;
  artnetPort?: number;
  artnetUniverse?: number;
};

export class DmxService extends EventEmitter {
  private readonly logger: FastifyBaseLogger;
  private readonly universeId: number;
  private universe: number[] = Array(512).fill(0);
  private tickTimer: NodeJS.Timeout | null = null;
  private nextTickAt: number | null = null;
  private fps: number;
  private lastTick = Date.now();
  private mode: DmxMode = "simulation";
  private configuredPort?: string;
  private activePort?: string;
  private dmx: DMX | null = null;
  private driver: EnttecOpenUSBDMXDriver | null = null;
  private readonly universeName = "main";
  private pushing = false;
  private pendingFrame = false;
  private readonly output: "enttec" | "artnet";
  private artnet: ArtnetClient | null = null;
  private readonly artnetUniverse: number;
  private readonly artnetHost: string;
  private readonly artnetPort: number;

  constructor(logger: FastifyBaseLogger, options?: DmxServiceOptions) {
    super();
    this.logger = logger.child({ service: "dmx" });
    this.fps = clampFps(options?.fps ?? 30);
    this.universeId = options?.universe ?? 0;
    this.configuredPort = options?.port;
    this.output = options?.output ?? "enttec";
    this.artnetHost = options?.artnetHost ?? "127.0.0.1";
    this.artnetPort = options?.artnetPort ?? 6454;
    this.artnetUniverse = options?.artnetUniverse ?? 0;
  }

  private async initializeArtnet() {
    // Lazy require to avoid bringing the dependency when unused.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const artnet = require("artnet");
    this.artnet = artnet({ host: this.artnetHost, port: this.artnetPort, sendAll: true });
    this.logger.info({ host: this.artnetHost, port: this.artnetPort, universe: this.artnetUniverse }, "Art-Net output ready");
  }

  async start() {
    if (this.tickTimer) return;
    if (this.output === "enttec") {
      await this.initializeDriver();
    } else {
      await this.initializeArtnet();
      this.mode = "hardware";
    }
    this.lastTick = Date.now();
    this.nextTickAt = Date.now();
    this.scheduleNextTick();
    this.logger.info(
      {
        fps: this.fps,
        mode: this.output === "artnet" ? "artnet" : this.mode,
        port: this.activePort ?? this.configuredPort,
        artnetHost: this.output === "artnet" ? this.artnetHost : undefined
      },
      "DMX service started"
    );
  }

  async stop() {
    this.clearTick();
    await this.teardownHardware();
  }

  setFrameRate(fps: number) {
    this.fps = clampFps(fps);
    if (this.tickTimer) {
      this.clearTick();
      this.nextTickAt = Date.now();
      this.scheduleNextTick();
      this.logger.info({ fps: this.fps }, "DMX frame rate updated");
    }
  }

  applyWrite(write: DmxWrite) {
    const { address, values } = write;
    values.forEach((value, idx) => {
      const channel = address + idx - 1;
      if (channel >= 0 && channel < this.universe.length) {
        this.universe[channel] = clampValue(value);
      }
    });
  }

  setChannel(channel: number, value: number) {
    if (channel < 1 || channel > 512) return;
    this.universe[channel - 1] = clampValue(value);
  }

  getUniverseSnapshot(): number[] {
    return [...this.universe];
  }

  // Apply previously-persisted values to the universe buffer. Safe to call
  // before start() so the first emitted Art-Net frame already carries the
  // restored state — projectors keep their last on-state across backend
  // restarts.
  restoreUniverse(values: number[]) {
    for (let i = 0; i < Math.min(values.length, this.universe.length); i++) {
      this.universe[i] = clampValue(values[i]);
    }
  }

  getState(): UniverseState {
    const now = Date.now();
    const delta = now - this.lastTick;
    const fps = delta > 0 ? Math.round(1000 / delta) : this.fps;
    this.lastTick = now;

    return {
      fps,
      universe: this.universeId,
      values: [...this.universe],
      timestamp: new Date().toISOString()
    };
  }

  private safeTick() {
    try {
      this.pendingFrame = true;
      this.pushFrame();
      const state = this.getState();
      this.emit("tick", state);
    } catch (err) {
      this.logger.error({ err }, "DMX tick failed");
    }
  }

  private scheduleNextTick() {
    const interval = 1000 / this.fps;
    const now = Date.now();
    if (this.nextTickAt === null) this.nextTickAt = now;
    const delay = Math.max(0, this.nextTickAt - now);

    this.tickTimer = setTimeout(() => {
      this.safeTick();
      const next = (this.nextTickAt ?? now) + interval;
      const driftCorrected = Math.max(next, Date.now());
      this.nextTickAt = driftCorrected;
      this.scheduleNextTick();
    }, delay);
  }

  private clearTick() {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.nextTickAt = null;
  }

  private pushFrame() {
    if (this.pushing) return;
    if (this.output === "artnet") {
      this.pendingFrame = false;
      this.pushing = true;
      try {
        // Explicit channel offset 1 to avoid dropping channel 1.
        this.artnet?.set(this.artnetUniverse, 1, this.universe);
      } catch (err) {
        this.logger.error({ err }, "Failed to push Art-Net frame");
      } finally {
        this.pushing = false;
        if (this.pendingFrame) {
          setImmediate(() => this.pushFrame());
        }
      }
      return;
    }
    if (this.mode !== "hardware" || !this.dmx) return;
    this.pendingFrame = false;
    const frame: Record<number, number> = {};
    for (let i = 0; i < this.universe.length; i++) {
      frame[i + 1] = this.universe[i];
    }

    this.pushing = true;
    try {
      // Enttec Open DMX USB is synchronous; push and return immediately.
      this.dmx.update(this.universeName, frame);
    } catch (err) {
      this.logger.error({ err }, "Failed to push DMX frame, switching to simulation mode");
      this.mode = "simulation";
      void this.teardownHardware();
    } finally {
      this.pushing = false;
      if (this.pendingFrame) {
        setImmediate(() => this.pushFrame());
      }
    }
  }

  private async initializeDriver() {
    const port = await this.detectPort();
    if (!port) {
      this.mode = "simulation";
      this.activePort = undefined;
      this.logger.warn(
        { mode: this.mode },
        "No Enttec Open DMX USB interface detected, running in simulation mode"
      );
      return;
    }

    const candidates = this.expandPortCandidates(port);

    for (const candidate of candidates) {
      try {
        this.logger.info({ port: candidate }, "Initializing Enttec Open DMX USB driver");
        this.driver = new EnttecOpenUSBDMXDriver(candidate, { dmxSpeed: this.fps });

        // Allow opening the port even if another process holds a lock (common on macOS with FTDI).
        type DriverWithOptions = { _serialPortOptions?: Record<string, unknown> };
        const driverHack = this.driver as unknown as DriverWithOptions;
        const serialOptions = driverHack._serialPortOptions ?? {};
        driverHack._serialPortOptions = {
          baudRate: 250000,
          dataBits: 8,
          stopBits: 2,
          parity: "none",
          highWaterMark: 1024,
          latencyTimer: 1, // match QLC+ (libftdi) to reduce buffering delays
          ...serialOptions,
          lock: false
        };

        this.dmx = new DMX();
        await this.dmx.addUniverse(this.universeName, this.driver);
        this.mode = "hardware";
        this.activePort = candidate;
        this.logger.info({ port: candidate }, "Enttec Open DMX USB ready");
        return;
      } catch (err) {
        this.logger.error(
          { err, port: candidate },
          "Failed to initialize DMX hardware on candidate port"
        );
        await this.teardownHardware();
      }
    }

    this.mode = "simulation";
    this.activePort = undefined;
    this.logger.warn(
      { mode: this.mode },
      "All DMX port candidates failed, running in simulation mode"
    );
  }

  private async teardownHardware() {
    if (this.artnet) {
      try {
        this.artnet.close();
      } catch {
        // ignore
      }
    }
    this.artnet = null;
    if (this.dmx) {
      try {
        await this.dmx.close();
      } catch (err) {
        this.logger.warn({ err }, "Failed to close DMX driver cleanly");
      }
    }
    this.dmx = null;
    this.driver = null;
    this.mode = "simulation";
    this.activePort = undefined;
  }

  private async detectPort(): Promise<string | null> {
    let ports: SerialPortInfo[] = [];
    try {
      ports = await SerialPort.list();
    } catch (err) {
      this.logger.error({ err }, "Failed to list serial ports");
      if (this.configuredPort) {
        this.logger.warn(
          { port: this.configuredPort },
          "Serial enumeration failed, attempting to use configured DMX port directly"
        );
        return this.configuredPort;
      }
      return null;
    }

    if (this.configuredPort) {
      const explicit = ports.find((port) => port.path === this.configuredPort);
      if (explicit) return explicit.path;

      this.logger.warn(
        { port: this.configuredPort },
        "Configured DMX port not found in serial scan, attempting to open directly"
      );
      return this.configuredPort;
    }

    const enttecPort = ports.find((port) => this.isEnttecOpenDMX(port));
    if (enttecPort) return enttecPort.path;

    return null;
  }

  private isEnttecOpenDMX(port: SerialPortInfo): boolean {
    const vendorId = port.vendorId?.toLowerCase();
    const productId = port.productId?.toLowerCase();
    const manufacturer = port.manufacturer?.toLowerCase() ?? "";

    const isFtdi = vendorId === "0403";
    const looksLikeOpenDmx = productId === "6001" || productId === "6015" || !productId;
    const mentionsEnttec = manufacturer.includes("enttec");

    return mentionsEnttec || (isFtdi && looksLikeOpenDmx);
  }

  private expandPortCandidates(port: string): string[] {
    const candidates = [port];
    if (port.startsWith("/dev/tty.")) {
      const cuPath = port.replace("/dev/tty.", "/dev/cu.");
      if (!candidates.includes(cuPath)) candidates.push(cuPath);
    }
    return candidates;
  }
}

const clampValue = (value: number) => {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
};

const clampFps = (fps: number) => Math.max(1, Math.min(fps, 60));
