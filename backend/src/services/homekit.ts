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
  ChannelFixtureChannels,
  HomeKitChannelFixture,
  HomeKitMovingHead,
  MovingHeadChannels,
  clamp,
  collectHomeKitChannelFixtures,
  collectHomeKitMovingHeads,
  dmxToPctDefault,
  pctToDmxDefault
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

type ManagedChannelSlot = {
  accessory: Accessory;
  service: Service;
  value: number; // 0-100 %
};

type ManagedChannelFixture = {
  cf: HomeKitChannelFixture;
  slots: Map<keyof ChannelFixtureChannels, ManagedChannelSlot>;
};

type ManagedMovingHeadSlot = {
  accessory: Accessory;
  service: Service;
  value: number; // 0-100 %
};

type ManagedMovingHead = {
  mh: HomeKitMovingHead;
  slots: Map<keyof MovingHeadChannels, ManagedMovingHeadSlot>;
  dimmerOn: boolean;
  lastNonZeroDimmer: number;
};

export type HomeKitFixtureStatus = {
  fixtureId: string;
  name: string;
  universe: number;
  channels: Partial<Record<keyof ChannelFixtureChannels, number>>;
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
  private channelFixtures = new Map<string, ManagedChannelFixture>();
  private movingHeads = new Map<string, ManagedMovingHead>();
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
        { pin: this.options.pin, username: this.options.username, accessories: this.channelFixtures.size },
        "HomeKit bridge started"
      );
    } catch (err) {
      this.logger.error({ err }, "Failed to start HomeKit bridge");
      if (this.dmxListener) {
        this.dmx.off("tick", this.dmxListener);
        this.dmxListener = undefined;
      }
      this.channelFixtures.clear();
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
    this.channelFixtures.clear();
    this.movingHeads.clear();
    this.bridge?.unpublish();
    this.bridge?.destroy();
    this.bridge = null;
    this.started = false;
    this.logger.info("HomeKit bridge stopped");
  }

  async syncFixtures(fixtures: Fixture[]) {
    this.cachedFixtures = fixtures;
    if (!this.options.enabled || !this.bridge) return;
    this.syncChannelFixtures(fixtures);
    this.syncMovingHeads(fixtures);
  }

  async updateFixtureState(fixture: Fixture) {
    await this.syncFixtures(this.cachedFixtures.map((f) => (f.id === fixture.id ? fixture : f)));
  }

  getStatus(): HomeKitStatus {
    const fixtures: HomeKitFixtureStatus[] = Array.from(this.channelFixtures.values()).map(({ cf }) => ({
      fixtureId: cf.fixture.id,
      name: cf.name,
      universe: cf.universe,
      channels: Object.fromEntries(
        Object.entries(cf.channels).filter(([, v]) => v !== undefined)
      ) as Partial<Record<keyof ChannelFixtureChannels, number>>
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

  private handleDmxTick(universeState: UniverseState) {
    if (!this.options.enabled) return;
    this.mirrorChannelFixtures(universeState);
    this.mirrorMovingHeads(universeState);
  }

  // ─── Channel Fixtures (one accessory per channel) ─────────────────────────

  private syncChannelFixtures(fixtures: Fixture[]) {
    if (!this.options.enabled || !this.bridge) return;

    const { channelFixtures, skipped } = collectHomeKitChannelFixtures(fixtures);
    skipped.forEach((item) => {
      this.logger.debug({ fixtureId: item.fixtureId, reason: item.reason }, "Skipping fixture for HomeKit");
    });

    const incomingIds = new Set(channelFixtures.map((cf) => cf.fixture.id));
    for (const [fixtureId, managed] of this.channelFixtures.entries()) {
      if (!incomingIds.has(fixtureId)) {
        for (const slot of managed.slots.values()) {
          this.bridge.removeBridgedAccessory(slot.accessory);
        }
        this.channelFixtures.delete(fixtureId);
        this.logger.info({ fixtureId }, "Removed HomeKit channel fixture accessories");
      }
    }

    channelFixtures.forEach((cf) => {
      const existing = this.channelFixtures.get(cf.fixture.id);
      if (existing) {
        this.updateManagedChannelFixture(existing, cf);
      } else {
        const managed = this.buildChannelFixtureAccessories(cf);
        for (const slot of managed.slots.values()) {
          this.bridge?.addBridgedAccessory(slot.accessory);
        }
        this.channelFixtures.set(cf.fixture.id, managed);
        this.logger.info({ fixtureId: cf.fixture.id, name: cf.name, count: managed.slots.size }, "Added HomeKit channel fixture accessories");
      }
    });
  }

  private buildChannelFixtureAccessories(cf: HomeKitChannelFixture): ManagedChannelFixture {
    const universeState = this.dmx.getState();
    const dmxValues = universeState.universe === cf.universe ? universeState.values : new Array(512).fill(0);
    const readPct = (ch: number) => Math.round(((dmxValues[ch - 1] as number) ?? 0) / 255 * 100);

    const channelDefs: Array<[keyof ChannelFixtureChannels, string]> = [
      ["intensity", cf.name],
      ["r", `${cf.name} Red`],
      ["g", `${cf.name} Green`],
      ["b", `${cf.name} Blue`],
      ["w", `${cf.name} White`]
    ];

    const slots = new Map<keyof ChannelFixtureChannels, ManagedChannelSlot>();

    for (const [key, label] of channelDefs) {
      const ch = cf.channels[key];
      if (ch === undefined) continue;

      const acc = new Accessory(label, uuid.generate(`lightbridgedmx:fixture:${cf.deviceId}:${key}`));
      acc
        .getService(Service.AccessoryInformation)
        ?.setCharacteristic(Characteristic.Manufacturer, "LightBridgeDMX")
        .setCharacteristic(Characteristic.Model, "DMX Channel")
        .setCharacteristic(Characteristic.SerialNumber, `${cf.deviceId}-${key}`);

      const svc = acc.addService(Service.Lightbulb);
      const value = readPct(ch);
      const slot: ManagedChannelSlot = { accessory: acc, service: svc, value };

      svc
        .getCharacteristic(Characteristic.On)
        .onGet(() => slot.value > 0)
        .onSet((v: CharacteristicValue) => {
          if (!v) {
            slot.value = 0;
            this.dmx.setChannel(ch, 0);
            svc.updateCharacteristic(Characteristic.Brightness, 0);
          }
        });

      svc
        .getCharacteristic(Characteristic.Brightness)
        .onGet(() => slot.value)
        .onSet((v: CharacteristicValue) => {
          const pct = clamp(Number(v), 0, 100);
          slot.value = pct;
          this.dmx.setChannel(ch, Math.round((pct / 100) * 255));
          svc.updateCharacteristic(Characteristic.On, pct > 0);
        });

      svc.updateCharacteristic(Characteristic.On, value > 0);
      svc.updateCharacteristic(Characteristic.Brightness, value);

      slots.set(key, slot);
    }

    return { cf, slots };
  }

  private updateManagedChannelFixture(existing: ManagedChannelFixture, cf: HomeKitChannelFixture) {
    const channelsChanged =
      existing.cf.deviceId !== cf.deviceId ||
      JSON.stringify(existing.cf.channels) !== JSON.stringify(cf.channels);

    if (channelsChanged) {
      for (const slot of existing.slots.values()) {
        this.bridge?.removeBridgedAccessory(slot.accessory);
      }
      this.channelFixtures.delete(existing.cf.fixture.id);
      const managed = this.buildChannelFixtureAccessories(cf);
      for (const slot of managed.slots.values()) {
        this.bridge?.addBridgedAccessory(slot.accessory);
      }
      this.channelFixtures.set(cf.fixture.id, managed);
      this.logger.info({ fixtureId: cf.fixture.id }, "Recreated HomeKit channel fixture accessories");
      return;
    }

    existing.cf = cf;
    const labels: Record<keyof ChannelFixtureChannels, string> = {
      intensity: cf.name,
      r: `${cf.name} Red`,
      g: `${cf.name} Green`,
      b: `${cf.name} Blue`,
      w: `${cf.name} White`
    };
    for (const [key, slot] of existing.slots.entries()) {
      slot.accessory.displayName = labels[key];
    }
  }

  private mirrorChannelFixtures(universeState: UniverseState) {
    for (const managed of this.channelFixtures.values()) {
      if (universeState.universe !== managed.cf.universe) continue;
      const readPct = (ch: number) =>
        Math.round(((universeState.values[ch - 1] as number) ?? 0) / 255 * 100);

      for (const [key, slot] of managed.slots.entries()) {
        const ch = managed.cf.channels[key];
        if (ch === undefined) continue;
        const newValue = readPct(ch);
        if (newValue === slot.value) continue;
        slot.value = newValue;
        slot.service.updateCharacteristic(Characteristic.On, newValue > 0);
        slot.service.updateCharacteristic(Characteristic.Brightness, newValue);
      }
    }
  }

  // ─── Moving Head (one accessory per channel) ──────────────────────────────

  private syncMovingHeads(fixtures: Fixture[]) {
    if (!this.options.enabled || !this.bridge) return;

    const { movingHeads, skipped } = collectHomeKitMovingHeads(fixtures);
    skipped.forEach((item) => {
      this.logger.debug({ fixtureId: item.fixtureId, reason: item.reason }, "Skipping moving head for HomeKit");
    });

    const incomingIds = new Set(movingHeads.map((mh) => mh.fixture.id));
    for (const [fixtureId, managed] of this.movingHeads.entries()) {
      if (!incomingIds.has(fixtureId)) {
        for (const slot of managed.slots.values()) {
          this.bridge.removeBridgedAccessory(slot.accessory);
        }
        this.movingHeads.delete(fixtureId);
        this.logger.info({ fixtureId }, "Removed HomeKit moving head accessories");
      }
    }

    movingHeads.forEach((mh) => {
      const existing = this.movingHeads.get(mh.fixture.id);
      if (existing) {
        this.updateManagedMovingHead(existing, mh);
      } else {
        const managed = this.buildMovingHeadAccessories(mh);
        for (const slot of managed.slots.values()) {
          this.bridge?.addBridgedAccessory(slot.accessory);
        }
        this.movingHeads.set(mh.fixture.id, managed);
        this.logger.info({ fixtureId: mh.fixture.id, name: mh.name, count: managed.slots.size }, "Added HomeKit moving head accessories");
      }
    });
  }

  private getDefaultDmx(mh: HomeKitMovingHead, key: keyof MovingHeadChannels): number {
    if (key === "pan") return mh.defaults.pan ?? 128;
    if (key === "tilt") return mh.defaults.tilt ?? 128;
    return 0;
  }

  private buildMovingHeadAccessories(mh: HomeKitMovingHead): ManagedMovingHead {
    const universeState = this.dmx.getState();
    const dmxValues = universeState.universe === mh.universe ? universeState.values : new Array(512).fill(0);
    const readPct = (ch: number) => Math.round(((dmxValues[ch - 1] as number) ?? 0) / 255 * 100);
    const readPctFor = (ch: number, key: keyof MovingHeadChannels) => {
      const dmx = (dmxValues[ch - 1] as number) ?? 0;
      return dmxToPctDefault(dmx, this.getDefaultDmx(mh, key));
    };

    const initialDimmer = mh.channels.dimmer !== undefined ? readPct(mh.channels.dimmer) : 0;
    const managed: ManagedMovingHead = {
      mh,
      slots: new Map(),
      dimmerOn: initialDimmer > 0,
      lastNonZeroDimmer: initialDimmer || 100
    };

    const channelDefs: Array<[keyof MovingHeadChannels, string]> = [
      ["dimmer", mh.name],
      ["shutter", `${mh.name} Shutter`],
      ["pan", `${mh.name} Pan`],
      ["tilt", `${mh.name} Tilt`],
      ["color", `${mh.name} Color Wheel`],
      ["gobo", `${mh.name} Gobo`]
    ];

    for (const [key, label] of channelDefs) {
      const ch = mh.channels[key];
      if (ch === undefined) continue;

      const acc = new Accessory(label, uuid.generate(`lightbridgedmx:mh:${mh.deviceId}:${key}`));
      acc
        .getService(Service.AccessoryInformation)
        ?.setCharacteristic(Characteristic.Manufacturer, "LightBridgeDMX")
        .setCharacteristic(Characteristic.Model, "DMX Moving Head")
        .setCharacteristic(Characteristic.SerialNumber, `${mh.deviceId}-${key}`);

      const svc = acc.addService(Service.Lightbulb);
      const defaultDmx = this.getDefaultDmx(mh, key);
      const value = defaultDmx ? readPctFor(ch, key) : readPct(ch);
      const slot: ManagedMovingHeadSlot = { accessory: acc, service: svc, value };

      if (key === "dimmer") {
        svc
          .getCharacteristic(Characteristic.On)
          .onGet(() => managed.dimmerOn)
          .onSet((v: CharacteristicValue) => {
            managed.dimmerOn = Boolean(v);
            const target = managed.dimmerOn ? slot.value || managed.lastNonZeroDimmer : 0;
            if (managed.dimmerOn && slot.value === 0) slot.value = managed.lastNonZeroDimmer;
            this.dmx.setChannel(ch, Math.round(target / 100 * 255));
            svc.updateCharacteristic(Characteristic.Brightness, slot.value);
          });

        svc
          .getCharacteristic(Characteristic.Brightness)
          .onGet(() => slot.value)
          .onSet((v: CharacteristicValue) => {
            const pct = clamp(Number(v), 0, 100);
            slot.value = pct;
            if (pct > 0) { managed.lastNonZeroDimmer = pct; managed.dimmerOn = true; }
            else { managed.dimmerOn = false; }
            this.dmx.setChannel(ch, Math.round(pct / 100 * 255));
            svc.updateCharacteristic(Characteristic.On, managed.dimmerOn);
          });

        svc.updateCharacteristic(Characteristic.On, managed.dimmerOn);
      } else {
        svc
          .getCharacteristic(Characteristic.On)
          .onGet(() => slot.value > 0)
          .onSet((v: CharacteristicValue) => {
            if (!v) {
              slot.value = 0;
              this.dmx.setChannel(ch, defaultDmx);
              svc.updateCharacteristic(Characteristic.Brightness, 0);
            }
          });

        svc
          .getCharacteristic(Characteristic.Brightness)
          .onGet(() => slot.value)
          .onSet((v: CharacteristicValue) => {
            const pct = clamp(Number(v), 0, 100);
            slot.value = pct;
            this.dmx.setChannel(ch, pctToDmxDefault(pct, defaultDmx));
            svc.updateCharacteristic(Characteristic.On, pct > 0);
          });

        svc.updateCharacteristic(Characteristic.On, value > 0);
      }

      svc.updateCharacteristic(Characteristic.Brightness, value);
      managed.slots.set(key, slot);

      // Enforce default DMX value on channels that are below their default
      if (defaultDmx > 0) {
        const currentDmx = (dmxValues[ch - 1] as number) ?? 0;
        if (currentDmx < defaultDmx) {
          this.dmx.setChannel(ch, defaultDmx);
        }
      }
    }

    return managed;
  }

  private updateManagedMovingHead(existing: ManagedMovingHead, mh: HomeKitMovingHead) {
    const channelsChanged =
      existing.mh.deviceId !== mh.deviceId ||
      JSON.stringify(existing.mh.channels) !== JSON.stringify(mh.channels);

    if (channelsChanged) {
      for (const slot of existing.slots.values()) {
        this.bridge?.removeBridgedAccessory(slot.accessory);
      }
      this.movingHeads.delete(existing.mh.fixture.id);
      const managed = this.buildMovingHeadAccessories(mh);
      for (const slot of managed.slots.values()) {
        this.bridge?.addBridgedAccessory(slot.accessory);
      }
      this.movingHeads.set(mh.fixture.id, managed);
      this.logger.info({ fixtureId: mh.fixture.id }, "Recreated HomeKit moving head accessories");
      return;
    }

    existing.mh = mh;
    const labels: Record<keyof MovingHeadChannels, string> = {
      dimmer: mh.name,
      shutter: `${mh.name} Shutter`,
      pan: `${mh.name} Pan`,
      tilt: `${mh.name} Tilt`,
      color: `${mh.name} Color Wheel`,
      gobo: `${mh.name} Gobo`
    };
    for (const [key, slot] of existing.slots.entries()) {
      slot.accessory.displayName = labels[key];
    }
  }

  private mirrorMovingHeads(universeState: UniverseState) {
    for (const managed of this.movingHeads.values()) {
      if (universeState.universe !== managed.mh.universe) continue;
      const readPct = (ch: number) =>
        Math.round(((universeState.values[ch - 1] as number) ?? 0) / 255 * 100);

      for (const [key, slot] of managed.slots.entries()) {
        const ch = managed.mh.channels[key];
        if (ch === undefined) continue;
        const defaultDmx = this.getDefaultDmx(managed.mh, key);
        const newValue = defaultDmx
          ? dmxToPctDefault((universeState.values[ch - 1] as number) ?? 0, defaultDmx)
          : readPct(ch);
        if (newValue === slot.value) continue;
        slot.value = newValue;
        if (key === "dimmer") {
          managed.dimmerOn = newValue > 0;
          if (newValue > 0) managed.lastNonZeroDimmer = newValue;
          slot.service.updateCharacteristic(Characteristic.On, managed.dimmerOn);
        } else {
          slot.service.updateCharacteristic(Characteristic.On, newValue > 0);
        }
        slot.service.updateCharacteristic(Characteristic.Brightness, newValue);
      }
    }
  }

  private prepareStorage() {
    if (!existsSync(this.options.storagePath)) {
      mkdirSync(this.options.storagePath, { recursive: true });
    }
    HAPStorage.setCustomStoragePath(this.options.storagePath);
  }
}
