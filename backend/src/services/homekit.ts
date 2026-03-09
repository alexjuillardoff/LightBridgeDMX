import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Fixture, UniverseState } from "@lightbridgedmx/shared";
import { FastifyBaseLogger } from "fastify";
import {
  Accessory,
  AccessoryEventTypes,
  Bridge,
  Categories,
  Characteristic,
  CharacteristicValue,
  HAPStorage,
  Service,
  uuid
} from "hap-nodejs";
import { DmxService } from "./dmx";
import {
  DmxRgbMapping,
  HsbColor,
  HomeKitLight,
  RgbColor,
  clamp,
  collectHomeKitLights,
  hsbToRgb,
  rgbToHsb
} from "./homekit-utils";

type HomeKitOptions = {
  enabled: boolean;
  name: string;
  pin: string;
  username: string;
  port?: number;
  setupId?: string;
  storagePath: string;
};

type ManagedLight = {
  light: HomeKitLight;
  accessory: Accessory;
  service: Service;
  state: LightState;
};

type LightState = HsbColor & {
  on: boolean;
  lastNonZeroBrightness: number;
  lastAppliedRgb: RgbColor;
};

export type HomeKitFixtureStatus = {
  fixtureId: string;
  name: string;
  source: DmxRgbMapping["source"];
  mapping: {
    r: number;
    g: number;
    b: number;
    universe: number;
    address: number;
  };
};

export type HomeKitStatus = {
  enabled: boolean;
  started: boolean;
  name: string;
  pin: string;
  username: string;
  port?: number;
  setupId?: string;
  setupUri: string | null;
  storagePath: string;
  fixtures: HomeKitFixtureStatus[];
  message?: string;
};

export class HomeKitBridge {
  private readonly logger: FastifyBaseLogger;
  private readonly dmx: DmxService;
  private readonly options: HomeKitOptions;
  private bridge: Bridge | null = null;
  private started = false;
  private lights = new Map<string, ManagedLight>();
  private cachedFixtures: Fixture[] = [];
  private dmxListener?: (state: UniverseState) => void;

  constructor(logger: FastifyBaseLogger, dmx: DmxService, options?: Partial<HomeKitOptions>) {
    this.logger = logger.child({ service: "homekit" });
    this.dmx = dmx;
    this.options = {
      enabled: options?.enabled ?? false,
      name: options?.name ?? "LightBridgeDMX",
      pin: options?.pin ?? "031-45-154",
      username: options?.username ?? "11:22:33:44:55:66",
      port: options?.port,
      setupId: options?.setupId ?? "LBKM",
      storagePath: options?.storagePath ?? path.join(process.cwd(), ".homekit")
    };
  }

  async start(fixtures: Fixture[]) {
    this.cachedFixtures = fixtures;
    if (!this.options.enabled) {
      this.logger.info("HomeKit bridge disabled (HOMEKIT_ENABLED not set)");
      return;
    }
    if (this.started) return;

    try {
      this.prepareStorage();

      this.bridge = new Bridge(this.options.name, uuid.generate(`lightbridgedmx:bridge:${this.options.username}`));
      this.bridge.getService(Service.AccessoryInformation)?.setCharacteristic(Characteristic.Manufacturer, "LightBridgeDMX");
      this.bridge
        .getService(Service.AccessoryInformation)
        ?.setCharacteristic(Characteristic.Model, "DMX Bridge")
        .setCharacteristic(Characteristic.SerialNumber, this.options.username);

      this.bridge.on(AccessoryEventTypes.LISTENING, (port: number) => {
        this.logger.info({ port }, "HomeKit bridge listening");
      });

      await this.syncFixtures(fixtures);
      this.startDmxMirror();

      this.bridge.publish({
        username: this.options.username,
        pincode: this.options.pin,
        category: Categories.BRIDGE,
        port: this.options.port,
        setupID: this.options.setupId
      });

      this.started = true;
      this.logger.info(
        { pin: this.options.pin, username: this.options.username, accessories: this.lights.size },
        "HomeKit bridge started"
      );
    } catch (err) {
      this.logger.error({ err }, "Failed to start HomeKit bridge");
      if (this.dmxListener) {
        this.dmx.off("tick", this.dmxListener);
        this.dmxListener = undefined;
      }
      this.lights.clear();
      this.bridge?.unpublish();
      this.bridge?.destroy();
      this.bridge = null;
    }
  }

  async stop() {
    if (!this.started) return;
    if (this.dmxListener) {
      this.dmx.off("tick", this.dmxListener);
      this.dmxListener = undefined;
    }
    this.lights.clear();
    this.bridge?.unpublish();
    this.bridge?.destroy();
    this.bridge = null;
    this.started = false;
    this.logger.info("HomeKit bridge stopped");
  }

  async syncFixtures(fixtures: Fixture[]) {
    this.cachedFixtures = fixtures;
    if (!this.options.enabled || !this.bridge) return;

    const { lights, skipped } = collectHomeKitLights(fixtures);
    skipped.forEach((item) => {
      this.logger.debug({ fixtureId: item.fixtureId, reason: item.reason }, "Skipping fixture for HomeKit");
    });

    const incomingIds = new Set(lights.map((light) => light.fixture.id));
    for (const [fixtureId, managed] of this.lights.entries()) {
      if (!incomingIds.has(fixtureId)) {
        this.bridge.removeBridgedAccessory(managed.accessory);
        this.lights.delete(fixtureId);
        this.logger.info({ fixtureId }, "Removed HomeKit accessory");
      }
    }

    lights.forEach((light) => {
      const existing = this.lights.get(light.fixture.id);
      if (existing) {
        this.updateManagedLight(existing, light);
      } else {
        const managed = this.buildAccessory(light);
        this.bridge?.addBridgedAccessory(managed.accessory);
        this.lights.set(light.fixture.id, managed);
        this.logger.info({ fixtureId: light.fixture.id, name: light.name }, "Added HomeKit accessory");
      }
    });
  }

  async updateFixtureState(fixture: Fixture) {
    await this.syncFixtures(this.cachedFixtures.map((f) => (f.id === fixture.id ? fixture : f)));
  }

  getStatus(): HomeKitStatus {
    const fixtures: HomeKitFixtureStatus[] = Array.from(this.lights.values()).map(({ light }) => ({
      fixtureId: light.fixture.id,
      name: light.name,
      source: light.mapping.source,
      mapping: {
        r: light.mapping.r,
        g: light.mapping.g,
        b: light.mapping.b,
        universe: light.mapping.universe,
        address: light.mapping.address
      }
    }));
    const started = this.started && Boolean(this.bridge);
    const setupUri = started && typeof this.bridge?.setupURI === "function" ? this.bridge?.setupURI() : null;

    const base: HomeKitStatus = {
      enabled: this.options.enabled,
      started,
      name: this.options.name,
      pin: this.options.pin,
      username: this.options.username,
      port: this.options.port,
      setupId: this.options.setupId,
      setupUri,
      storagePath: this.options.storagePath,
      fixtures
    };

    if (!this.options.enabled) {
      return {
        ...base,
        started: false,
        setupUri: null,
        fixtures: [],
        message: "HomeKit disabled (set HOMEKIT_ENABLED=true)"
      };
    }

    return base;
  }

  private startDmxMirror() {
    if (this.dmxListener) return;
    this.dmxListener = (state: UniverseState) => this.handleDmxTick(state);
    this.dmx.on("tick", this.dmxListener);
  }

  private handleDmxTick(state: UniverseState) {
    if (!this.options.enabled) return;
    for (const managed of this.lights.values()) {
      const { mapping } = managed.light;
      if (state.universe !== mapping.universe) continue;

      const next = this.readRgbFromUniverse(state, mapping);
      if (!next) continue;
      const hsb = rgbToHsb(next);
      const isOn = hsb.brightness > 0;

      const changed =
        isOn !== managed.state.on ||
        Math.round(hsb.hue) !== Math.round(managed.state.hue) ||
        hsb.saturation !== Math.round(managed.state.saturation) ||
        hsb.brightness !== Math.round(managed.state.brightness);

      if (!changed) continue;

      managed.state.hue = hsb.hue;
      managed.state.saturation = hsb.saturation;
      managed.state.brightness = hsb.brightness;
      managed.state.on = isOn;
      if (hsb.brightness > 0) {
        managed.state.lastNonZeroBrightness = hsb.brightness;
      }
      managed.state.lastAppliedRgb = next;
      this.pushStateToHomeKit(managed);
    }
  }

  private readRgbFromUniverse(state: UniverseState, mapping: DmxRgbMapping): RgbColor | null {
    const values = state.values;
    const r = values[mapping.r - 1];
    const g = values[mapping.g - 1];
    const b = values[mapping.b - 1];
    if ([r, g, b].some((v) => typeof v !== "number")) return null;
    return { r, g, b };
  }

  private buildAccessory(light: HomeKitLight): ManagedLight {
    const accessory = new Accessory(light.name, uuid.generate(`lightbridgedmx:fixture:${light.deviceId}`));

    accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, "LightBridgeDMX")
      .setCharacteristic(Characteristic.Model, "DMX RGB Fixture")
      .setCharacteristic(Characteristic.SerialNumber, light.deviceId);

    const service = accessory.addService(Service.Lightbulb, light.name);
    const initialRgb = this.readRgbFromUniverse(this.dmx.getState(), light.mapping) ?? { r: 0, g: 0, b: 0 };
    const initialHsb = rgbToHsb(initialRgb);
    const state: LightState = {
      hue: initialHsb.hue,
      saturation: initialHsb.saturation,
      brightness: initialHsb.brightness,
      on: initialHsb.brightness > 0,
      lastNonZeroBrightness: initialHsb.brightness || 100,
      lastAppliedRgb: initialRgb
    };

    const managed: ManagedLight = { accessory, service, light, state };
    this.registerHandlers(managed);
    this.pushStateToHomeKit(managed);

    return managed;
  }

  private updateManagedLight(existing: ManagedLight, light: HomeKitLight) {
    const needsRecreate =
      existing.light.deviceId !== light.deviceId ||
      existing.light.mapping.r !== light.mapping.r ||
      existing.light.mapping.g !== light.mapping.g ||
      existing.light.mapping.b !== light.mapping.b;

    if (needsRecreate) {
      this.bridge?.removeBridgedAccessory(existing.accessory);
      this.lights.delete(existing.light.fixture.id);
      const managed = this.buildAccessory(light);
      this.bridge?.addBridgedAccessory(managed.accessory);
      this.lights.set(light.fixture.id, managed);
      this.logger.info({ fixtureId: light.fixture.id }, "Recreated HomeKit accessory after config change");
      return;
    }

    existing.light = light;
    existing.service.updateCharacteristic(Characteristic.Name, light.name);
    existing.accessory.displayName = light.name;
    existing.accessory
      .getService(Service.AccessoryInformation)
      ?.updateCharacteristic(Characteristic.Name, light.name)
      .updateCharacteristic(Characteristic.SerialNumber, light.deviceId);
  }

  private registerHandlers(managed: ManagedLight) {
    const { service, light, state } = managed;

    service
      .getCharacteristic(Characteristic.On)
      .onGet(() => state.on)
      .onSet((value: CharacteristicValue) => {
        const requested = Boolean(value);
        state.on = requested;
        if (state.on && state.brightness === 0) {
          state.brightness = state.lastNonZeroBrightness || 100;
          state.lastNonZeroBrightness = state.brightness;
        }
        this.applyStateToDmx(light.mapping, state);
        this.pushStateToHomeKit(managed, false);
      });

    service
      .getCharacteristic(Characteristic.Brightness)
      .onGet(() => state.brightness)
      .onSet((value: CharacteristicValue) => {
        const brightness = clamp(Number(value), 0, 100);
        state.brightness = brightness;
        if (brightness > 0) {
          state.lastNonZeroBrightness = brightness;
          state.on = true;
        } else {
          state.on = false;
        }
        this.applyStateToDmx(light.mapping, state);
        this.pushStateToHomeKit(managed, false);
      });

    service
      .getCharacteristic(Characteristic.Hue)
      .onGet(() => state.hue)
      .onSet((value: CharacteristicValue) => {
        state.hue = clamp(Number(value), 0, 360);
        this.applyStateToDmx(light.mapping, state);
        this.pushStateToHomeKit(managed, false);
      });

    service
      .getCharacteristic(Characteristic.Saturation)
      .onGet(() => state.saturation)
      .onSet((value: CharacteristicValue) => {
        state.saturation = clamp(Number(value), 0, 100);
        this.applyStateToDmx(light.mapping, state);
        this.pushStateToHomeKit(managed, false);
      });
  }

  private applyStateToDmx(mapping: DmxRgbMapping, state: LightState) {
    const brightness = state.on ? state.brightness || state.lastNonZeroBrightness || 100 : 0;
    const rgb = hsbToRgb({
      hue: state.hue,
      saturation: state.saturation,
      brightness
    });
    state.lastAppliedRgb = rgb;
    this.dmx.setChannel(mapping.r, rgb.r);
    this.dmx.setChannel(mapping.g, rgb.g);
    this.dmx.setChannel(mapping.b, rgb.b);
  }

  private pushStateToHomeKit(managed: ManagedLight, pushName = true) {
    const { service, state } = managed;
    service.updateCharacteristic(Characteristic.On, state.on);
    service.updateCharacteristic(Characteristic.Brightness, state.brightness);
    service.updateCharacteristic(Characteristic.Hue, state.hue);
    service.updateCharacteristic(Characteristic.Saturation, state.saturation);
    if (pushName) {
      service.updateCharacteristic(Characteristic.Name, managed.light.name);
    }
  }

  private prepareStorage() {
    if (!existsSync(this.options.storagePath)) {
      mkdirSync(this.options.storagePath, { recursive: true });
    }
    HAPStorage.setCustomStoragePath(this.options.storagePath);
  }
}
