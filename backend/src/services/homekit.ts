// Pont HomeKit : expose les projecteurs (fixtures) DMX dans l'app Maison via hap-nodejs.
// Deux familles d'appareils sont gerees :
//  - les projecteurs "a canaux" (intensite + RGBW) -> 1 accessoire HomeKit par canal, chacun en Service.Lightbulb ;
//  - les lyres (moving heads) -> 1 accessoire par canal (dimmer, shutter, pan, tilt, roue de couleurs, gobo).
// Le pont est bidirectionnel : une commande HomeKit ecrit dans le DMX, et chaque tick DMX
// est reflete (mirror) vers HomeKit pour garder l'app Maison synchronisee.
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
  collectHomeKitMovingHeads
} from "./homekit-utils";

// Options de configuration du pont HomeKit (lues depuis l'environnement / la config).
type HomeKitOptions = {
  enabled: boolean;
  name: string;
  pin: string;
  username: string;
  port?: number;
  setupId?: string;
  storagePath: string;
};

// Un "slot" represente un accessoire HomeKit pilotant un seul canal DMX.
type ManagedChannelSlot = {
  accessory: Accessory;
  service: Service;
  value: number; // valeur courante en pourcentage (0-100 %)
};

// Projecteur a canaux suivi en memoire : sa definition + un slot par canal expose.
type ManagedChannelFixture = {
  cf: HomeKitChannelFixture;
  slots: Map<keyof ChannelFixtureChannels, ManagedChannelSlot>;
};

// Slot d'une lyre : meme principe qu'un slot de projecteur (un accessoire par canal).
type ManagedMovingHeadSlot = {
  accessory: Accessory;
  service: Service;
  value: number; // valeur courante en pourcentage (0-100 %)
};

// Lyre suivie en memoire. On garde l'etat du variateur (dimmer) pour pouvoir
// rallumer a la derniere intensite connue apres une extinction (toggle On/Off).
type ManagedMovingHead = {
  mh: HomeKitMovingHead;
  slots: Map<keyof MovingHeadChannels, ManagedMovingHeadSlot>;
  dimmerOn: boolean;
  lastNonZeroDimmer: number; // derniere intensite > 0, pour restaurer apres un Off
};

// Etat d'un projecteur expose, renvoye par l'API de statut (pour l'UI).
export type HomeKitFixtureStatus = {
  fixtureId: string;
  name: string;
  universe: number;
  channels: Partial<Record<keyof ChannelFixtureChannels, number>>;
};

// Statut global du pont HomeKit, renvoye a l'UI (Reglages) : etat, PIN, QR d'appairage, projecteurs.
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

// Pont HomeKit : cree et publie un Bridge hap-nodejs, lui attache un accessoire
// par canal de chaque projecteur, et maintient la synchro DMX <-> HomeKit.
export class HomeKitBridge {
  private readonly logger: FastifyBaseLogger;
  private readonly dmx: DmxService;
  private readonly options: HomeKitOptions;
  private bridge: Bridge | null = null;
  private started = false;
  // Projecteurs et lyres actuellement exposes, indexes par id de projecteur (fixture).
  private channelFixtures = new Map<string, ManagedChannelFixture>();
  private movingHeads = new Map<string, ManagedMovingHead>();
  // Derniere liste de projecteurs recue, conservee pour re-synchroniser sans la redemander.
  private cachedFixtures: Fixture[] = [];
  // Reference de l'ecouteur "tick" DMX, gardee pour pouvoir le retirer a l'arret.
  private dmxListener?: (state: UniverseState) => void;

  // Construit le pont avec des valeurs par defaut sures (PIN, username MAC, dossier de stockage).
  // Le pont reste inactif tant que `enabled` est faux (HOMEKIT_ENABLED non defini).
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

  // Demarre le pont : prepare le stockage, cree le Bridge, attache les accessoires,
  // branche le miroir DMX, puis publie le pont sur le reseau pour l'appairage HomeKit.
  async start(fixtures: Fixture[]) {
    this.cachedFixtures = fixtures;
    if (!this.options.enabled) {
      this.logger.info("HomeKit bridge disabled (HOMEKIT_ENABLED not set)");
      return;
    }
    if (this.started) return;

    try {
      this.prepareStorage();

      // L'UUID du pont est derive du username (MAC) : il reste stable d'un demarrage a l'autre,
      // ce qui evite que l'app Maison re-decouvre un pont "neuf" a chaque relance.
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

      // Publication : rend le pont visible sur le reseau (mDNS) et active l'appairage HomeKit.
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
      // En cas d'echec, on nettoie tout (ecouteur DMX, accessoires, pont) pour
      // ne pas laisser un pont a moitie publie qui troublerait l'app Maison.
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

  // Arrete proprement le pont : retire l'ecouteur DMX, vide les caches et detruit le Bridge.
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

  // Reconcilie les accessoires HomeKit avec la liste de projecteurs fournie :
  // ajoute les nouveaux, met a jour les existants, retire ceux qui ont disparu.
  async syncFixtures(fixtures: Fixture[]) {
    this.cachedFixtures = fixtures;
    if (!this.options.enabled || !this.bridge) return;
    this.syncChannelFixtures(fixtures);
    this.syncMovingHeads(fixtures);
  }

  // Met a jour un seul projecteur dans le cache, puis resynchronise tout le pont.
  async updateFixtureState(fixture: Fixture) {
    await this.syncFixtures(this.cachedFixtures.map((f) => (f.id === fixture.id ? fixture : f)));
  }

  // Construit le statut courant du pont pour l'UI (etat, PIN, URI d'appairage, projecteurs exposes).
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
    // setupURI : URI X-HM:// servant a generer le QR code d'appairage cote UI.
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

    // Pont desactive : on renvoie un statut neutre avec un message explicatif pour l'UI.
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

  // Branche le miroir DMX : a chaque tick (battement de la boucle DMX), HomeKit est mis a jour.
  private startDmxMirror() {
    if (this.dmxListener) return;
    this.dmxListener = (state: UniverseState) => this.handleDmxTick(state);
    this.dmx.on("tick", this.dmxListener);
  }

  // Reflete l'etat DMX courant vers les caracteristiques HomeKit (sens DMX -> HomeKit).
  private handleDmxTick(universeState: UniverseState) {
    if (!this.options.enabled) return;
    this.mirrorChannelFixtures(universeState);
    this.mirrorMovingHeads(universeState);
  }

  // ─── Projecteurs a canaux (un accessoire HomeKit par canal) ───────────────

  // Reconcilie les accessoires des projecteurs a canaux avec la liste fournie.
  private syncChannelFixtures(fixtures: Fixture[]) {
    if (!this.options.enabled || !this.bridge) return;

    // collectHomeKitChannelFixtures filtre les projecteurs eligibles ; `skipped`
    // liste ceux ecartes (et pourquoi), juste tracee en debug.
    const { channelFixtures, skipped } = collectHomeKitChannelFixtures(fixtures);
    skipped.forEach((item) => {
      this.logger.debug({ fixtureId: item.fixtureId, reason: item.reason }, "Skipping fixture for HomeKit");
    });

    // 1) Retrait : tout projecteur deja expose mais absent de la nouvelle liste est supprime du pont.
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

    // 2) Ajout / mise a jour : on cree les accessoires manquants, on met a jour les existants.
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

  // Cree les accessoires HomeKit d'un projecteur a canaux : un Service.Lightbulb par
  // canal present (intensite, R, G, B, W). Chaque ampoule pilote son canal DMX.
  private buildChannelFixtureAccessories(cf: HomeKitChannelFixture): ManagedChannelFixture {
    // On lit l'etat DMX courant pour initialiser les accessoires a la bonne valeur.
    // Si l'univers DMX ne correspond pas, on part de 512 canaux a zero.
    const universeState = this.dmx.getState();
    const dmxValues = universeState.universe === cf.universe ? universeState.values : new Array(512).fill(0);
    // Convertit une valeur DMX (0-255, canal 1-indexe) en pourcentage HomeKit (0-100).
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
      if (ch === undefined) continue; // canal non defini sur ce projecteur : pas d'accessoire

      // UUID derive du deviceId + du role du canal : stable dans le temps pour ce canal precis.
      const acc = new Accessory(label, uuid.generate(`lightbridgedmx:fixture:${cf.deviceId}:${key}`));
      acc
        .getService(Service.AccessoryInformation)
        ?.setCharacteristic(Characteristic.Manufacturer, "LightBridgeDMX")
        .setCharacteristic(Characteristic.Model, "DMX Channel")
        .setCharacteristic(Characteristic.SerialNumber, `${cf.deviceId}-${key}`);

      const svc = acc.addService(Service.Lightbulb);
      const value = readPct(ch);
      const slot: ManagedChannelSlot = { accessory: acc, service: svc, value };

      // On (allumage) : un canal est "allume" des que sa valeur > 0.
      // On ne gere que l'extinction ici ; l'allumage se fait via Brightness
      // (HomeKit envoie On=true puis Brightness lors d'une montee depuis 0).
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

      // Brightness (luminosite) : convertit le pourcentage HomeKit en valeur DMX 0-255.
      svc
        .getCharacteristic(Characteristic.Brightness)
        .onGet(() => slot.value)
        .onSet((v: CharacteristicValue) => {
          const pct = clamp(Number(v), 0, 100);
          slot.value = pct;
          this.dmx.setChannel(ch, Math.round((pct / 100) * 255));
          svc.updateCharacteristic(Characteristic.On, pct > 0);
        });

      // Initialise l'etat HomeKit avec la valeur DMX lue au demarrage.
      svc.updateCharacteristic(Characteristic.On, value > 0);
      svc.updateCharacteristic(Characteristic.Brightness, value);

      slots.set(key, slot);
    }

    return { cf, slots };
  }

  // Met a jour un projecteur deja expose. Si les canaux ou le nom changent,
  // on recree les accessoires ; sinon on se contente de rafraichir les libelles.
  private updateManagedChannelFixture(existing: ManagedChannelFixture, cf: HomeKitChannelFixture) {
    const channelsChanged =
      existing.cf.deviceId !== cf.deviceId ||
      JSON.stringify(existing.cf.channels) !== JSON.stringify(cf.channels);
    // NB : un changement de nom doit se propager a Characteristic.Name (lu par iOS) ET
    // forcer une nouvelle version de config du pont pour que l'app Maison rafraichisse son cache.
    // updateCharacteristic seul ne change pas la version de config ; seul l'ajout/retrait
    // d'accessoires le fait. On recree donc les accessoires lors d'un renommage.
    const nameChanged = existing.cf.name !== cf.name;

    if (channelsChanged || nameChanged) {
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

    // Aucun changement structurel : on rafraichit juste les libelles affiches.
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

  // Miroir DMX -> HomeKit pour les projecteurs a canaux : pour chaque canal dont la
  // valeur DMX a change, on met a jour On + Brightness dans l'app Maison.
  private mirrorChannelFixtures(universeState: UniverseState) {
    for (const managed of this.channelFixtures.values()) {
      if (universeState.universe !== managed.cf.universe) continue;
      const readPct = (ch: number) =>
        Math.round(((universeState.values[ch - 1] as number) ?? 0) / 255 * 100);

      for (const [key, slot] of managed.slots.entries()) {
        const ch = managed.cf.channels[key];
        if (ch === undefined) continue;
        const newValue = readPct(ch);
        if (newValue === slot.value) continue; // pas de changement : evite des notifications inutiles
        slot.value = newValue;
        slot.service.updateCharacteristic(Characteristic.On, newValue > 0);
        slot.service.updateCharacteristic(Characteristic.Brightness, newValue);
      }
    }
  }

  // ─── Lyres / moving heads (un accessoire HomeKit par canal) ───────────────

  // Reconcilie les accessoires des lyres avec la liste fournie (meme logique que les projecteurs a canaux).
  private syncMovingHeads(fixtures: Fixture[]) {
    if (!this.options.enabled || !this.bridge) return;

    const { movingHeads, skipped } = collectHomeKitMovingHeads(fixtures);
    skipped.forEach((item) => {
      this.logger.debug({ fixtureId: item.fixtureId, reason: item.reason }, "Skipping moving head for HomeKit");
    });

    // 1) Retrait des lyres absentes de la nouvelle liste.
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

    // 2) Ajout / mise a jour des lyres.
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

  // Valeur DMX de repos (home) d'un canal de lyre.
  // Pour pan/tilt, on vise le centre (128) afin que la lyre pointe droit au repos.
  private getDefaultDmx(mh: HomeKitMovingHead, key: keyof MovingHeadChannels): number {
    if (key === "pan") return mh.defaults.pan ?? 128;
    if (key === "tilt") return mh.defaults.tilt ?? 128;
    return 0;
  }

  // Cree les accessoires d'une lyre : un Service.Lightbulb par canal present
  // (dimmer, shutter, pan, tilt, roue de couleurs, gobo). Le dimmer a un traitement
  // special (memorise la derniere intensite pour le toggle On/Off).
  private buildMovingHeadAccessories(mh: HomeKitMovingHead): ManagedMovingHead {
    const universeState = this.dmx.getState();
    const dmxValues = universeState.universe === mh.universe ? universeState.values : new Array(512).fill(0);
    const readPct = (ch: number) => Math.round(((dmxValues[ch - 1] as number) ?? 0) / 255 * 100);

    // Etat initial du variateur (dimmer). lastNonZeroDimmer demarre a 100 % si le canal est a 0,
    // pour qu'un premier "On" depuis l'app Maison rallume a pleine intensite.
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
      if (ch === undefined) continue; // canal absent sur cette lyre

      const acc = new Accessory(label, uuid.generate(`lightbridgedmx:mh:${mh.deviceId}:${key}`));
      acc
        .getService(Service.AccessoryInformation)
        ?.setCharacteristic(Characteristic.Manufacturer, "LightBridgeDMX")
        .setCharacteristic(Characteristic.Model, "DMX Moving Head")
        .setCharacteristic(Characteristic.SerialNumber, `${mh.deviceId}-${key}`);

      const svc = acc.addService(Service.Lightbulb);
      const defaultDmx = this.getDefaultDmx(mh, key);
      const value = readPct(ch);
      const slot: ManagedMovingHeadSlot = { accessory: acc, service: svc, value };

      // Le variateur (dimmer) gere l'intensite. On distingue l'etat On/Off de la valeur
      // pour pouvoir eteindre puis rallumer a la derniere intensite memorisee.
      if (key === "dimmer") {
        svc
          .getCharacteristic(Characteristic.On)
          .onGet(() => managed.dimmerOn)
          .onSet((v: CharacteristicValue) => {
            managed.dimmerOn = Boolean(v);
            // A l'allumage, on restaure l'intensite courante, ou la derniere connue si on etait a 0.
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
            // Toute intensite > 0 est memorisee pour le prochain rallumage.
            if (pct > 0) { managed.lastNonZeroDimmer = pct; managed.dimmerOn = true; }
            else { managed.dimmerOn = false; }
            this.dmx.setChannel(ch, Math.round(pct / 100 * 255));
            svc.updateCharacteristic(Characteristic.On, managed.dimmerOn);
          });

        svc.updateCharacteristic(Characteristic.On, managed.dimmerOn);
      } else {
        // Autres canaux (shutter, pan, tilt, roue de couleurs, gobo) :
        // a l'extinction, on revient a la valeur de repos (defaultDmx), pas forcement 0
        // (ex. pan/tilt reviennent au centre pour que la lyre pointe droit).
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
            this.dmx.setChannel(ch, Math.round((pct / 100) * 255));
            svc.updateCharacteristic(Characteristic.On, pct > 0);
          });

        svc.updateCharacteristic(Characteristic.On, value > 0);
      }

      svc.updateCharacteristic(Characteristic.Brightness, value);
      managed.slots.set(key, slot);

      // Position de repos (home) : on l'applique seulement si le canal est encore a 0.
      // Sinon on ecraserait une valeur deja posee (ex. une scene en cours).
      if (defaultDmx > 0) {
        const currentDmx = (dmxValues[ch - 1] as number) ?? 0;
        if (currentDmx === 0) {
          this.dmx.setChannel(ch, defaultDmx);
        }
      }
    }

    return managed;
  }

  // Met a jour une lyre deja exposee : recree les accessoires si les canaux ou le nom
  // changent, sinon rafraichit seulement les libelles.
  private updateManagedMovingHead(existing: ManagedMovingHead, mh: HomeKitMovingHead) {
    const channelsChanged =
      existing.mh.deviceId !== mh.deviceId ||
      JSON.stringify(existing.mh.channels) !== JSON.stringify(mh.channels);
    // Meme logique que pour les projecteurs a canaux : un changement de nom doit declencher
    // une nouvelle version de config pour que l'app Maison le prenne en compte. On recree
    // donc les accessoires au lieu de modifier displayName sur place.
    const nameChanged = existing.mh.name !== mh.name;

    if (channelsChanged || nameChanged) {
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

    // Aucun changement structurel : on met juste a jour les libelles affiches.
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

  // Miroir DMX -> HomeKit pour les lyres. Le canal dimmer met aussi a jour l'etat On/Off
  // memorise (dimmerOn) et la derniere intensite non nulle.
  private mirrorMovingHeads(universeState: UniverseState) {
    for (const managed of this.movingHeads.values()) {
      if (universeState.universe !== managed.mh.universe) continue;
      const readPct = (ch: number) =>
        Math.round(((universeState.values[ch - 1] as number) ?? 0) / 255 * 100);

      for (const [key, slot] of managed.slots.entries()) {
        const ch = managed.mh.channels[key];
        if (ch === undefined) continue;
        const newValue = readPct(ch);
        if (newValue === slot.value) continue; // valeur inchangee : rien a notifier
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

  // Prepare le dossier de stockage HAP (cle d'appairage, etat persistant) et l'enregistre
  // aupres de hap-nodejs. Sans ce dossier dedie, l'appairage HomeKit serait perdu a chaque relance.
  private prepareStorage() {
    if (!existsSync(this.options.storagePath)) {
      mkdirSync(this.options.storagePath, { recursive: true });
    }
    HAPStorage.setCustomStoragePath(this.options.storagePath);
  }
}
