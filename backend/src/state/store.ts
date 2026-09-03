// Store (couche de persistance) : seul point d'acces a la base SQLite via Prisma.
// Centralise la lecture/ecriture des projecteurs (fixtures), scenes, presets,
// config du Mode Dance, lampes connectees (smart lights) et snapshots d'univers DMX.
// Toutes les methodes sont async. La base stocke certains champs complexes en JSON
// (texte), donc on serialise a l'ecriture et on valide avec Zod a la lecture.
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  DanceConfig,
  DanceConfigSchema,
  Fixture,
  FixtureSchema,
  MerossConfig,
  MerossConfigInput,
  MerossConfigSchema,
  Preset,
  PresetSchema,
  Scene,
  SceneSchema,
  SmartLight,
  SmartLightInput,
  SmartLightSchema
} from "@lightbridgedmx/shared";

// Erreur metier du store qui porte un code HTTP. Les routes Fastify peuvent ainsi
// renvoyer le bon statut (404 introuvable, 409 conflit de canaux...) au client.
export class StoreError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

// Donnees d'entree pour creer un projecteur : on omet id et createdAt
// (generes par le store), l'id reste optionnel pour pouvoir l'imposer si besoin.
export type FixtureInput = Omit<Fixture, "id" | "createdAt"> & { id?: string };
export type FixtureUpdate = Partial<FixtureInput>;

// Deplacement d'un projecteur dans le patch : nouvelle adresse, et
// eventuellement nouvel univers. Sert au repatch groupe (voir repatchFixtures).
export type FixtureMove = { id: string; address: number; universe?: number };

// Forme brute d'une ligne fixture telle que stockee en base : les champs
// complexes (channels, profile, homekit) y sont du texte JSON, pas des objets.
type DbFixture = {
  id: string;
  name: string;
  address: number;
  universe: number;
  channels: string;
  createdAt: string;
  profile: string | null;
  homekit: string | null;
  room: string | null;
};

// Forme brute d'une ligne smart light en base : config, dmxMirror, streaming,
// zoneLayout et currentEffect sont stockes en texte JSON (ou NULL si absents).
type DbSmartLight = {
  id: string;
  name: string;
  room: string | null;
  backend: string;
  config: string;
  dmxMirror: string | null;
  streaming: string | null;
  zoneLayout: string | null;
  currentEffect: string | null;
  createdAt: string;
};

// Convertit une ligne brute (DbSmartLight) en objet SmartLight valide.
// On reparse le JSON des champs complexes et on valide le tout avec Zod.
// Les champs optionnels ne sont ajoutes que s'ils existent (sinon Zod recoit
// un objet sans la cle, pas une cle a null/undefined).
function deserializeSmartLight(row: DbSmartLight): SmartLight {
  return SmartLightSchema.parse({
    id: row.id,
    name: row.name,
    backend: row.backend,
    config: JSON.parse(row.config),
    createdAt: row.createdAt,
    ...(row.room ? { room: row.room } : {}),
    ...(row.dmxMirror ? { dmxMirror: JSON.parse(row.dmxMirror) } : {}),
    ...(row.streaming ? { streaming: JSON.parse(row.streaming) } : {}),
    ...(row.zoneLayout ? { zoneLayout: JSON.parse(row.zoneLayout) } : {}),
    ...(row.currentEffect ? { currentEffect: JSON.parse(row.currentEffect) } : {})
  });
}

// Convertit une ligne brute (DbFixture) en objet Fixture valide.
// Meme principe : on reparse le JSON (channels, profile, homekit) et on valide via Zod.
function deserializeFixture(row: DbFixture): Fixture {
  return FixtureSchema.parse({
    id: row.id,
    name: row.name,
    address: row.address,
    universe: row.universe,
    channels: JSON.parse(row.channels),
    createdAt: row.createdAt,
    ...(row.profile ? { profile: JSON.parse(row.profile) } : {}),
    ...(row.homekit ? { homekit: JSON.parse(row.homekit) } : {}),
    ...(row.room ? { room: row.room } : {})
  });
}

// Config par defaut du Mode Dance, utilisee pour l'auto-amorcage (auto-seed)
// au tout premier acces, quand aucune ligne n'existe encore en base.
// intervalMinMs/intervalMaxMs : plage aleatoire (en ms) entre deux pas de chenillard.
// excludePanTilt : par defaut on ne touche pas aux canaux pan/tilt des lyres dans la danse.
// lyre.msPerPanUnit : duree de deplacement (40 ms par unite de pan) pour caler les mouvements.
const DEFAULT_DANCE_CONFIG: Omit<DanceConfig, "updatedAt"> = {
  enabled: false,
  rooms: [],
  intervalMinMs: 55,
  intervalMaxMs: 140,
  patterns: [
    "chase",
    "reverseChase",
    "pingPong",
    "waveLR",
    "waveRL",
    "alternate",
    "pairs",
    "randomSubset",
    "allHit",
    "strobeSync"
  ],
  excludePanTilt: true,
  excludeCapabilities: [],
  lyre: {
    enabled: false,
    shutterOpenValue: 255,
    dimmerOnValue: 255,
    followChase: false,
    positions: [],
    wallEdgeRight: { pan: 20, tilt: 9 },
    speedValue: 0,
    msPerPanUnit: 40
  },
  smartLights: {
    enabled: false,
    lightIds: []
  }
};

// Classe principale : expose toutes les operations de lecture/ecriture.
// Une seule instance est partagee dans le backend.
export class Store {
  private prisma = new PrismaClient();

  // Ouvre la connexion a la base (a appeler au demarrage du backend).
  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  // Ferme proprement la connexion (a l'arret du backend).
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // ----- Projecteurs (fixtures) -----

  async listFixtures(): Promise<Fixture[]> {
    const rows = await this.prisma.fixture.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(deserializeFixture);
  }

  async getFixture(id: string): Promise<Fixture | undefined> {
    const row = await this.prisma.fixture.findUnique({ where: { id } });
    return row ? deserializeFixture(row) : undefined;
  }

  // Cree un projecteur. On verifie d'abord qu'aucun de ses canaux ne chevauche
  // un projecteur deja present (sinon deux projecteurs piloteraient le meme slot DMX).
  // L'id et la date de creation sont generes ici si l'appelant ne les fournit pas.
  async createFixture(input: FixtureInput): Promise<Fixture> {
    await this.assertChannelAvailability(input);
    const now = new Date().toISOString();
    const payload: Fixture = {
      id: input.id ?? randomUUID(),
      createdAt: now,
      ...input
    };
    const parsed = FixtureSchema.parse(payload);
    await this.prisma.fixture.create({
      data: {
        id: parsed.id,
        name: parsed.name,
        address: parsed.address,
        universe: parsed.universe,
        channels: JSON.stringify(parsed.channels),
        createdAt: parsed.createdAt,
        profile: parsed.profile ? JSON.stringify(parsed.profile) : null,
        homekit: parsed.homekit ? JSON.stringify(parsed.homekit) : null,
        room: parsed.room ?? null
      }
    });
    return parsed;
  }

  // Met a jour un projecteur existant. On fusionne le patch sur l'objet courant,
  // puis on re-verifie l'absence de chevauchement de canaux (en s'ignorant soi-meme).
  async updateFixture(id: string, patch: FixtureUpdate): Promise<Fixture> {
    const existing = await this.getFixture(id);
    if (!existing) throw new StoreError("Fixture not found", 404);
    const next: Fixture = { ...existing, ...patch };
    await this.assertChannelAvailability(next, id);
    const parsed = FixtureSchema.parse(next);
    await this.prisma.fixture.update({
      where: { id },
      data: {
        name: parsed.name,
        address: parsed.address,
        universe: parsed.universe,
        channels: JSON.stringify(parsed.channels),
        profile: parsed.profile ? JSON.stringify(parsed.profile) : null,
        homekit: parsed.homekit ? JSON.stringify(parsed.homekit) : null,
        room: parsed.room ?? null
      }
    });
    return parsed;
  }

  // Supprime un projecteur. Le .catch silencieux rend la suppression idempotente :
  // supprimer un id deja absent ne doit pas faire echouer la requete.
  async deleteFixture(id: string): Promise<void> {
    await this.prisma.fixture.delete({ where: { id } }).catch(() => {});
  }

  // ----- Scenes (etats enregistres rappelables) -----

  async listScenes(): Promise<Scene[]> {
    const rows = await this.prisma.scene.findMany({ orderBy: { name: "asc" } });
    return rows.map((row) => SceneSchema.parse({ ...row, steps: JSON.parse(row.steps) }));
  }

  async getScene(id: string): Promise<Scene | undefined> {
    const row = await this.prisma.scene.findUnique({ where: { id } });
    return row ? SceneSchema.parse({ ...row, steps: JSON.parse(row.steps) }) : undefined;
  }

  // Cree une scene. Les pas (steps) sont serialises en JSON pour le stockage.
  async createScene(input: Omit<Scene, "id"> & { id?: string }): Promise<Scene> {
    const scene: Scene = { id: input.id ?? randomUUID(), ...input };
    const parsed = SceneSchema.parse(scene);
    await this.prisma.scene.create({
      data: { id: parsed.id, name: parsed.name, steps: JSON.stringify(parsed.steps) }
    });
    return parsed;
  }

  // Suppression idempotente d'une scene (voir deleteFixture).
  async deleteScene(id: string): Promise<void> {
    await this.prisma.scene.delete({ where: { id } }).catch(() => {});
  }

  // ----- Presets (reglages predefinis reutilisables) -----

  async listPresets(): Promise<Preset[]> {
    const rows = await this.prisma.preset.findMany({ orderBy: { name: "asc" } });
    return rows.map((row) => PresetSchema.parse({ ...row, payload: JSON.parse(row.payload) }));
  }

  // Cree un preset. Son contenu (payload) est serialise en JSON pour le stockage.
  async createPreset(input: Omit<Preset, "id"> & { id?: string }): Promise<Preset> {
    const preset: Preset = { id: input.id ?? randomUUID(), ...input };
    const parsed = PresetSchema.parse(preset);
    await this.prisma.preset.create({
      data: { id: parsed.id, name: parsed.name, payload: JSON.stringify(parsed.payload) }
    });
    return parsed;
  }

  // Suppression idempotente d'un preset (voir deleteFixture).
  async deletePreset(id: string): Promise<void> {
    await this.prisma.preset.delete({ where: { id } }).catch(() => {});
  }

  // ----- Config du Mode Dance (ligne unique "singleton") -----

  // Lit la config de danse. Il n'y a qu'une seule ligne, identifiee par "singleton".
  // Si elle n'existe pas encore, on l'auto-amorce (auto-seed) avec les valeurs par defaut.
  async getDanceConfig(): Promise<DanceConfig> {
    const row = await this.prisma.danceConfig.findUnique({ where: { id: "singleton" } });
    if (!row) {
      const seeded = await this.saveDanceConfig({
        ...DEFAULT_DANCE_CONFIG,
        updatedAt: new Date().toISOString()
      });
      return seeded;
    }
    // NB : la colonne `smartLights` peut etre absente sur les lignes enregistrees
    // avant l'ajout de ce champ. Le @default de Prisma ne s'applique qu'aux nouvelles
    // lignes ; sur SQLite, un ALTER TABLE laisse NULL pour les lignes existantes.
    // On retombe donc sur la valeur par defaut si le champ est absent ou illisible.
    let smartLights = DEFAULT_DANCE_CONFIG.smartLights;
    const raw = (row as { smartLights?: string }).smartLights;
    if (raw) {
      try {
        smartLights = JSON.parse(raw);
      } catch {
        // JSON invalide : on ignore et on garde la valeur par defaut.
      }
    }
    return DanceConfigSchema.parse({
      enabled: row.enabled,
      rooms: JSON.parse(row.rooms),
      intervalMinMs: row.intervalMinMs,
      intervalMaxMs: row.intervalMaxMs,
      patterns: JSON.parse(row.patterns),
      excludePanTilt: row.excludePanTilt,
      excludeCapabilities: JSON.parse(row.excludeCapabilities),
      lyre: JSON.parse(row.lyre),
      smartLights,
      updatedAt: row.updatedAt
    });
  }

  // Enregistre la config de danse (cree la ligne "singleton" ou la met a jour).
  // On force updatedAt a maintenant et on serialise en JSON les champs structures.
  async saveDanceConfig(config: DanceConfig): Promise<DanceConfig> {
    const parsed = DanceConfigSchema.parse({
      ...config,
      updatedAt: new Date().toISOString()
    });
    // Garde-fou : la borne basse de l'intervalle aleatoire ne peut pas depasser la haute.
    if (parsed.intervalMinMs > parsed.intervalMaxMs) {
      throw new StoreError("intervalMinMs must be <= intervalMaxMs", 400);
    }
    const data = {
      enabled: parsed.enabled,
      rooms: JSON.stringify(parsed.rooms),
      intervalMinMs: parsed.intervalMinMs,
      intervalMaxMs: parsed.intervalMaxMs,
      patterns: JSON.stringify(parsed.patterns),
      excludePanTilt: parsed.excludePanTilt,
      excludeCapabilities: JSON.stringify(parsed.excludeCapabilities),
      lyre: JSON.stringify(parsed.lyre),
      smartLights: JSON.stringify(parsed.smartLights),
      updatedAt: parsed.updatedAt
    };
    await this.prisma.danceConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data
    });
    return parsed;
  }

  // ----- Config prise Meross (ligne unique "singleton") -----

  // Lit la config de la prise Meross. Auto-amorce une ligne par defaut si absente,
  // en partant des valeurs fournies (seed depuis l'environnement au premier lancement).
  async getMerossConfig(seed?: MerossConfigInput): Promise<MerossConfig> {
    const row = await this.prisma.merossConfig.findUnique({ where: { id: "singleton" } });
    if (!row) {
      return this.saveMerossConfig(seed ?? {});
    }
    return MerossConfigSchema.parse({
      enabled: row.enabled,
      host: row.host,
      key: row.key,
      channel: row.channel,
      updatedAt: row.updatedAt
    });
  }

  // Met a jour (patch) la config Meross : fusionne avec l'existant puis upsert.
  async saveMerossConfig(patch: MerossConfigInput): Promise<MerossConfig> {
    const existing = await this.prisma.merossConfig.findUnique({ where: { id: "singleton" } });
    const merged = MerossConfigSchema.parse({
      enabled: patch.enabled ?? existing?.enabled ?? false,
      host: patch.host ?? existing?.host ?? "",
      key: patch.key ?? existing?.key ?? "",
      channel: patch.channel ?? existing?.channel ?? 0,
      updatedAt: new Date().toISOString()
    });
    const data = {
      enabled: merged.enabled,
      host: merged.host,
      key: merged.key,
      channel: merged.channel,
      updatedAt: merged.updatedAt
    };
    await this.prisma.merossConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data
    });
    return merged;
  }

  // ----- Lampes connectees (smart lights) -----

  async listSmartLights(): Promise<SmartLight[]> {
    const rows = await this.prisma.smartLight.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(deserializeSmartLight);
  }

  async getSmartLight(id: string): Promise<SmartLight | undefined> {
    const row = await this.prisma.smartLight.findUnique({ where: { id } });
    return row ? deserializeSmartLight(row) : undefined;
  }

  // Cree une lampe connectee. Les champs structures (config, dmxMirror, streaming,
  // zoneLayout, currentEffect) sont serialises en JSON, ou stockes NULL si absents.
  async createSmartLight(input: SmartLightInput): Promise<SmartLight> {
    const now = new Date().toISOString();
    const parsed = SmartLightSchema.parse({
      id: input.id ?? randomUUID(),
      createdAt: now,
      ...input
    });
    await this.prisma.smartLight.create({
      data: {
        id: parsed.id,
        name: parsed.name,
        room: parsed.room ?? null,
        backend: parsed.backend,
        config: JSON.stringify(parsed.config),
        dmxMirror: parsed.dmxMirror ? JSON.stringify(parsed.dmxMirror) : null,
        streaming: parsed.streaming ? JSON.stringify(parsed.streaming) : null,
        zoneLayout: parsed.zoneLayout ? JSON.stringify(parsed.zoneLayout) : null,
        currentEffect: parsed.currentEffect ? JSON.stringify(parsed.currentEffect) : null,
        createdAt: parsed.createdAt
      }
    });
    return parsed;
  }

  // Met a jour une lampe connectee : on fusionne le patch sur l'objet courant,
  // on valide via Zod, puis on re-serialise les champs JSON pour l'ecriture.
  async updateSmartLight(id: string, patch: Partial<SmartLightInput>): Promise<SmartLight> {
    const existing = await this.getSmartLight(id);
    if (!existing) throw new StoreError("Smart light not found", 404);
    const next: SmartLight = { ...existing, ...patch };
    const parsed = SmartLightSchema.parse(next);
    await this.prisma.smartLight.update({
      where: { id },
      data: {
        name: parsed.name,
        room: parsed.room ?? null,
        backend: parsed.backend,
        config: JSON.stringify(parsed.config),
        dmxMirror: parsed.dmxMirror ? JSON.stringify(parsed.dmxMirror) : null,
        streaming: parsed.streaming ? JSON.stringify(parsed.streaming) : null,
        zoneLayout: parsed.zoneLayout ? JSON.stringify(parsed.zoneLayout) : null,
        currentEffect: parsed.currentEffect ? JSON.stringify(parsed.currentEffect) : null
      }
    });
    return parsed;
  }

  // Suppression idempotente d'une lampe connectee (voir deleteFixture).
  async deleteSmartLight(id: string): Promise<void> {
    await this.prisma.smartLight.delete({ where: { id } }).catch(() => {});
  }

  // ----- Pieces (rooms) -----

  // Renvoie la liste triee et dedupliquee des pieces utilisees, en croisant
  // les projecteurs et les lampes connectees (une piece peut contenir les deux).
  async listRooms(): Promise<string[]> {
    const [fixtureRows, smartRows] = await Promise.all([
      this.prisma.fixture.findMany({
        where: { room: { not: null } },
        select: { room: true }
      }),
      this.prisma.smartLight.findMany({
        where: { room: { not: null } },
        select: { room: true }
      })
    ]);
    const set = new Set<string>();
    for (const r of fixtureRows) if (r.room) set.add(r.room);
    for (const r of smartRows) if (r.room) set.add(r.room);
    return [...set].sort();
  }

  // ----- Snapshots d'univers DMX (etat des 512 canaux) -----

  // Recharge l'instantane (snapshot) des 512 canaux d'un univers DMX, par defaut l'univers 0.
  // Stocke en base comme un Buffer binaire d'au plus 512 octets ; on le re-eclate
  // en tableau de 512 entiers (les canaux manquants restent a 0).
  // Renvoie null si aucun snapshot n'a encore ete enregistre.
  async loadUniverseSnapshot(universe = 0): Promise<number[] | null> {
    const row = await this.prisma.universeSnapshot.findUnique({ where: { universe } });
    if (!row) return null;
    const buf = Buffer.from(row.values);
    const out = new Array<number>(512).fill(0);
    for (let i = 0; i < Math.min(buf.length, 512); i++) {
      out[i] = buf[i];
    }
    return out;
  }

  // Enregistre l'instantane (snapshot) des 512 canaux d'un univers DMX.
  // On borne (clamp) chaque valeur a 0-255 et on arrondit ; toute valeur non finie
  // (NaN, Infinity) retombe a 0 pour ne jamais ecrire de canal invalide.
  async saveUniverseSnapshot(values: number[], universe = 0): Promise<void> {
    const buf = Buffer.alloc(512);
    for (let i = 0; i < Math.min(values.length, 512); i++) {
      const v = values[i];
      buf[i] = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
    }
    const updatedAt = new Date().toISOString();
    await this.prisma.universeSnapshot.upsert({
      where: { universe },
      create: { universe, values: buf, updatedAt },
      update: { values: buf, updatedAt }
    });
  }

  // ----- Helpers internes : detection de chevauchement de canaux -----

  // Verifie qu'aucun canal du projecteur n'est deja occupe par un autre projecteur.
  // Deux projecteurs sur le meme slot DMX se piloteraient mutuellement : on l'interdit (409).
  // ignoreId permet de s'exclure soi-meme lors d'une mise a jour.
  private async assertChannelAvailability(fixture: FixtureInput, ignoreId?: string): Promise<void> {
    const all = await this.listFixtures();
    const ranges = this.computeRanges(fixture);
    for (const existing of all) {
      if (existing.id === ignoreId) continue;
      // Un canal n'est partage qu'a l'interieur d'un meme univers : le canal 1
      // de l'univers 0 et celui de l'univers 1 sont deux fils physiques distincts.
      if (existing.universe !== fixture.universe) continue;
      const existingRanges = this.computeRanges(existing);
      const clash = ranges.find((channel) => existingRanges.includes(channel));
      if (clash !== undefined) {
        // Le message remonte tel quel dans l'UI : il doit dire QUI bloque et OU.
        throw new StoreError(
          `Conflit d'adresse au canal ${fixture.universe}.${clash} avec « ${existing.name} »`,
          409
        );
      }
    }
  }

  // Repatche plusieurs projecteurs d'un coup.
  //
  // Les deplacer un par un ne marche pas : decaler A vers l'adresse encore
  // occupee par B leve un 409 alors que la disposition FINALE, elle, est saine.
  // On valide donc la disposition complete resultante avant d'ecrire quoi que ce
  // soit, puis on ecrit dans une transaction : soit tout le patch bouge, soit rien.
  async repatchFixtures(moves: FixtureMove[]): Promise<Fixture[]> {
    const all = await this.listFixtures();
    const known = new Set(all.map((fixture) => fixture.id));
    for (const move of moves) {
      if (!known.has(move.id)) throw new StoreError(`Fixture not found: ${move.id}`, 404);
    }

    const movesById = new Map(moves.map((move) => [move.id, move]));
    // Disposition envisagee : tous les projecteurs, les deplaces a leur nouvelle place.
    const next = all.map((fixture) => {
      const move = movesById.get(fixture.id);
      return move ? { ...fixture, address: move.address, universe: move.universe ?? fixture.universe } : fixture;
    });

    // Un slot DMX n'appartient qu'a un projecteur : on parcourt la disposition
    // complete et on refuse au premier canal reclame deux fois.
    const owners = new Map<string, string>();
    for (const fixture of next) {
      for (const channel of this.computeRanges(fixture)) {
        if (channel < 1 || channel > 512) {
          throw new StoreError(`« ${fixture.name} » sortirait de l'univers (canal ${channel})`, 400);
        }
        const key = `${fixture.universe}:${channel}`;
        const owner = owners.get(key);
        if (owner) {
          throw new StoreError(
            `Conflit d'adresse au canal ${fixture.universe}.${channel} entre « ${owner} » et « ${fixture.name} »`,
            409
          );
        }
        owners.set(key, fixture.name);
      }
    }

    const moved = next.filter((fixture) => movesById.has(fixture.id));
    await this.prisma.$transaction(
      moved.map((fixture) =>
        this.prisma.fixture.update({
          where: { id: fixture.id },
          data: { address: fixture.address, universe: fixture.universe }
        })
      )
    );
    return moved;
  }

  // Calcule la liste des canaux DMX absolus occupes par un projecteur.
  // Canal absolu = adresse de depart + offset du canal - 1 (les offsets demarrent a 1).
  private computeRanges(fixture: Pick<Fixture, "address" | "channels">): number[] {
    return fixture.channels.map((ch) => fixture.address + ch.channel - 1);
  }
}
