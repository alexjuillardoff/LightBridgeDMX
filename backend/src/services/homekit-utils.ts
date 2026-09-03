// Utilitaires du pont HomeKit.
// Ce module ne touche pas au reseau : il ne fait que des conversions de couleurs
// (HSB <-> RGB) et resout, pour chaque projecteur (fixture), quels canaux DMX
// piloter et comment l'exposer dans l'app Maison.
// Trois familles de projecteurs sont gerees :
//   - lumiere RGB classique (Service.Lightbulb couleur),
//   - "channel fixture" : pilotage canal par canal (R/G/B/W/intensite),
//   - lyre (moving head) : pan/tilt + dimmer/shutter/color/gobo.
// Le service homekit.ts appelle ces fonctions pour construire les accessoires.

import { Fixture, FixtureHomeKitMovingHeadChannels, SmartLight } from "@lightbridgedmx/shared";

/** Nettoie un nom pour HomeKit.
 *
 *  HAP n'accepte dans un nom que lettres, chiffres, espaces et apostrophes, et
 *  exige qu'il commence et finisse par une lettre ou un chiffre. Un nom hors
 *  regles fait avertir hap-nodejs et peut rendre l'accessoire inajoutable ou
 *  muet dans l'app Maison — ce qui arrive vite avec les noms de la bibliotheque
 *  QXF, du genre « Showtec LED Par 56 (6 Channel) ».
 *
 *  Le pupitre, lui, garde le nom tel quel : seul le miroir HomeKit est nettoye. */
export const hapName = (raw: string): string => {
  const cleaned = raw
    .normalize("NFD")
    // Les accents partent avec leurs diacritiques : « Café » -> « Cafe ».
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Un nom doit commencer ET finir par une lettre ou un chiffre.
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9]+$/, "");
  // Un nom entierement illisible vaut mieux remplace que vide.
  return cleaned || "Projecteur";
};


// Couleur en HSB (Hue/Saturation/Brightness) telle qu'exposee par HomeKit.
export type HsbColor = {
  hue: number;
  saturation: number;
  brightness: number;
};

// Couleur en RGB (0-255 par composante) telle qu'envoyee sur les canaux DMX.
export type RgbColor = {
  r: number;
  g: number;
  b: number;
};

// Resultat de la resolution RGB : quels canaux DMX absolus piloter pour
// les composantes r/g/b, dans quel univers DMX, et d'ou vient le mapping
// (source "config" = canaux forces a la main, "capability" = deduits des capabilities).
export type DmxRgbMapping = {
  r: number;
  g: number;
  b: number;
  universe: number;
  source: "config" | "capability";
  address: number;
};

// Un projecteur RGB pret a etre expose en accessoire HomeKit (ampoule couleur).
export type HomeKitLight = {
  fixture: Fixture;
  name: string;
  deviceId: string;
  mapping: DmxRgbMapping;
};

// Union discriminee : soit on a une lumiere exploitable (light),
// soit une raison (reason) qui explique pourquoi le projecteur est ignore.
export type HomeKitLightResolution =
  | { light: HomeKitLight; reason?: undefined }
  | { light?: undefined; reason: string };

// Borne une valeur dans l'intervalle [min, max].
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Convertit une couleur HomeKit (HSB) en RGB 0-255 pour le DMX.
// Implementation standard HSV->RGB par secteurs de 60 degres de teinte.
// On normalise d'abord : teinte ramenee dans [0, 360), saturation/luminosite en [0, 1].
// Les valeurs non finies (NaN, Infinity) sont remplacees par 0 pour eviter des sorties incoherentes.
export const hsbToRgb = ({ hue, saturation, brightness }: HsbColor): RgbColor => {
  const h = ((Number.isFinite(hue) ? hue : 0) % 360 + 360) % 360;
  const s = clamp(Number.isFinite(saturation) ? saturation : 0, 0, 100) / 100;
  const v = clamp(Number.isFinite(brightness) ? brightness : 0, 0, 100) / 100;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
};

// Conversion inverse RGB 0-255 -> HSB pour renvoyer l'etat couleur a HomeKit.
// Saturation et luminosite sont rendues en pourcentage (0-100), teinte en degres.
export const rgbToHsb = ({ r, g, b }: RgbColor): HsbColor => {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    switch (max) {
      case rn:
        hue = ((gn - bn) / delta) % 6;
        break;
      case gn:
        hue = (bn - rn) / delta + 2;
        break;
      default:
        hue = (rn - gn) / delta + 4;
        break;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const saturation = max === 0 ? 0 : delta / max;

  return {
    hue,
    saturation: Math.round(saturation * 100),
    brightness: Math.round(max * 100)
  };
};

// Un projecteur est une lyre (moving head) des qu'il possede un canal pan ou tilt.
// Sert a aiguiller chaque projecteur vers le bon traitement HomeKit.
export const isMovingHead = (fixture: Fixture): boolean =>
  fixture.channels.some((ch) => ch.capability === "pan" || ch.capability === "tilt");

// Decide si un projecteur peut etre expose comme ampoule RGB HomeKit.
// Renvoie soit la lumiere resolue, soit une raison de rejet :
//   - HomeKit explicitement desactive dans la config,
//   - lyre (geree ailleurs par le service moving head),
//   - aucun mapping RGB exploitable.
export const resolveHomeKitLight = (fixture: Fixture): HomeKitLightResolution => {
  if (fixture.homekit?.enabled === false) {
    return { reason: "HomeKit disabled in fixture config" };
  }

  if (isMovingHead(fixture)) {
    return { reason: "Moving head — handled by moving head service" };
  }

  const inferred = resolveRgbChannels(fixture);
  if (!inferred) {
    return { reason: "Missing RGB channel mapping for HomeKit" };
  }

  // On prefere les overrides HomeKit (deviceId/name) ; sinon on retombe sur l'id et le nom du projecteur.
  const deviceId = fixture.homekit?.deviceId?.trim() || fixture.id;
  const name = hapName(fixture.homekit?.name?.trim() || fixture.name);

  return {
    light: {
      fixture,
      name,
      deviceId,
      mapping: inferred
    }
  };
};

// Determine les canaux DMX absolus r/g/b d'un projecteur.
// Priorite aux canaux forces a la main (homekit.dmxChannels) ; a defaut, on deduit
// le mapping a partir des capabilities r/g/b declarees sur les canaux.
export const resolveRgbChannels = (fixture: Fixture): DmxRgbMapping | null => {
  const explicit = fixture.homekit?.dmxChannels;
  if (explicit) {
    const resolved = toAbsoluteChannels(fixture.address, explicit);
    if (!resolved) return null;
    return { ...resolved, universe: fixture.universe, source: "config", address: fixture.address };
  }

  const fromCaps = inferFromCapabilities(fixture);
  if (fromCaps) {
    return { ...fromCaps, universe: fixture.universe, source: "capability", address: fixture.address };
  }

  return null;
};

// Parcourt tous les projecteurs et separe ceux exposables en ampoule RGB
// de ceux ignores (avec leur raison), pour les logs et le diagnostic.
export const collectHomeKitLights = (fixtures: Fixture[]) => {
  const lights: HomeKitLight[] = [];
  const skipped: Array<{ fixtureId: string; reason: string }> = [];

  fixtures.forEach((fixture) => {
    const resolution = resolveHomeKitLight(fixture);
    if (resolution.light) {
      lights.push(resolution.light);
    } else if (resolution.reason) {
      skipped.push({ fixtureId: fixture.id, reason: resolution.reason });
    }
  });

  return { lights, skipped };
};

// Deduit les canaux r/g/b a partir des capabilities du projecteur.
// Renvoie null s'il manque l'une des trois composantes.
const inferFromCapabilities = (fixture: Fixture) => {
  const r = fixture.channels.find((ch) => ch.capability === "r")?.channel;
  const g = fixture.channels.find((ch) => ch.capability === "g")?.channel;
  const b = fixture.channels.find((ch) => ch.capability === "b")?.channel;
  if (!r || !g || !b) return null;

  return toAbsoluteChannels(fixture.address, { r, g, b });
};

// Convertit des numeros de canal relatifs au projecteur en canaux DMX absolus,
// puis valide le resultat. Renvoie null si :
//   - un canal sort de la plage 1-512 (debordement de l'univers DMX),
//   - deux composantes pointent sur le meme canal (mapping incoherent).
const toAbsoluteChannels = (
  address: number,
  channels: { r: number; g: number; b: number }
): Omit<DmxRgbMapping, "universe" | "source" | "address"> | null => {
  const r = toAbsolute(address, channels.r);
  const g = toAbsolute(address, channels.g);
  const b = toAbsolute(address, channels.b);
  const all = [r, g, b];
  if (all.some((value) => value < 1 || value > 512)) return null;
  if (new Set(all).size !== all.length) return null;
  return { r, g, b };
};

// Passe d'un canal relatif (1 = premier canal du projecteur) au canal DMX absolu.
// L'adresse de depart occupe deja le canal 1, d'ou le "- 1".
const toAbsolute = (address: number, channel: number) => address + channel - 1;

// ─── Channel Fixture (pilotage canal par canal R/G/B/W/intensite) ────────────

// Canaux DMX absolus (1-512) d'un projecteur pilote canal par canal.
// Tous optionnels : on n'expose que les canaux reellement presents.
export type ChannelFixtureChannels = {
  r?: number;       // canal DMX absolu (1-512)
  g?: number;
  b?: number;
  w?: number;
  intensity?: number;
};

// Projecteur pret a etre expose en pilotage canal par canal dans HomeKit.
export type HomeKitChannelFixture = {
  fixture: Fixture;
  name: string;
  deviceId: string;
  channels: ChannelFixtureChannels;
  universe: number;
};

// Soit le projecteur est exploitable (cf), soit une raison de rejet est fournie.
type HomeKitChannelFixtureResolution =
  | { cf: HomeKitChannelFixture; reason?: undefined }
  | { cf?: undefined; reason: string };

// Resout les canaux pilotables (r/g/b/w/intensite) d'un projecteur.
// Rejete si HomeKit est desactive, si c'est une lyre (geree ailleurs),
// ou si aucun canal controlable n'est trouve.
const resolveChannelFixture = (fixture: Fixture): HomeKitChannelFixtureResolution => {
  if (fixture.homekit?.enabled === false) {
    return { reason: "HomeKit disabled in fixture config" };
  }

  if (isMovingHead(fixture)) {
    return { reason: "Moving head — handled by moving head service" };
  }

  // Helper local : trouve le canal portant cette capability et le rend en canal DMX absolu.
  const resolve = (cap: string): number | undefined => {
    const ch = fixture.channels.find((c) => c.capability === cap);
    return ch ? toAbsolute(fixture.address, ch.channel) : undefined;
  };

  const r = resolve("r");
  const g = resolve("g");
  const b = resolve("b");
  const w = resolve("w");
  const intensity = resolve("intensity");

  if (!r && !g && !b && !w && !intensity) {
    return { reason: "No controllable channels (r/g/b/w/intensity) found" };
  }

  const channels: ChannelFixtureChannels = { r, g, b, w, intensity };
  const deviceId = fixture.homekit?.deviceId?.trim() || fixture.id;
  const name = hapName(fixture.homekit?.name?.trim() || fixture.name);

  return { cf: { fixture, name, deviceId, channels, universe: fixture.universe } };
};

// Collecte les projecteurs pilotables canal par canal et liste les ignores.
// Les lyres sont ecartees d'emblee (elles ont leur propre service).
/** Canaux DMX absolus occupes par un projecteur. */
const absoluteChannels = (fixture: Fixture): number[] =>
  fixture.channels.map((ch) => fixture.address + ch.channel - 1);

/** Le projecteur qui sert de FACADE DMX a une lampe connectee, s'il existe.
 *
 *  Une Nanoleaf pilotee en DMX a deux representations : la lampe elle-meme, et
 *  un projecteur bidon dont les canaux servent de prise en main depuis le
 *  pupitre. Ce sont deux faces du meme objet — l'exposer deux fois dans l'app
 *  Maison (une ampoule « Nanoleaf A19 26N3 » plus quatre ampoules Dimmer/R/V/B)
 *  n'a aucun sens pour qui ouvre l'app.
 *
 *  Le miroir par zone porte deja `fixtureId`. Le miroir uniforme, lui, ne
 *  memorise que des canaux absolus : on retrouve la facade en cherchant le
 *  projecteur dont l'empreinte couvre TOUS les canaux du miroir. */
export const findFacadeFixture = (light: SmartLight, fixtures: Fixture[]): Fixture | undefined => {
  const mirror = light.dmxMirror;
  if (!mirror) return undefined;

  if (mirror.zones?.fixtureId) {
    const byId = fixtures.find((f) => f.id === mirror.zones?.fixtureId);
    if (byId) return byId;
  }

  const universe = mirror.universe ?? 0;
  const wanted = [mirror.rChannel, mirror.gChannel, mirror.bChannel, mirror.briChannel].filter(
    (ch): ch is number => ch !== undefined
  );
  if (!wanted.length) return undefined;

  return fixtures.find((fixture) => {
    if (fixture.universe !== universe) return false;
    const owned = new Set(absoluteChannels(fixture));
    return wanted.every((ch) => owned.has(ch));
  });
};

/** Ce qu'on expose dans HomeKit pour une lampe connectee, sous quel nom, et
 *  dans quelle generation d'accessoire (voir accessoryRevision). */
export type HomeKitSmartLightExposure = { light: SmartLight; name: string; revision: number };

/** Graine de l'UUID de l'accessoire d'une lampe connectee.
 *
 *  La generation 0 garde la graine historique, sans suffixe : sans cela, TOUS
 *  les accessoires deja appaires changeraient d'identite d'un coup et
 *  perdraient leur piece dans l'app Maison. */
export const smartLightAccessorySeed = (light: SmartLight, revision = 0): string =>
  revision > 0
    ? `lightbridgedmx:smartlight:${light.id}:r${revision}`
    : `lightbridgedmx:smartlight:${light.id}`;

/** Trie les lampes connectees exposables, et decide de leur nom.
 *
 *  Une lampe qui a une facade DMX suit la facade : c'est elle que l'utilisateur
 *  voit dans le patch, c'est donc son nom et sa case « Exposer dans HomeKit » qui
 *  comptent. Une lampe sans facade se represente elle-meme.
 *
 *  Dans les deux cas la forme est la meme : UNE ampoule normale (teinte,
 *  saturation, luminosite), jamais une ampoule par canal DMX. */
export const collectHomeKitSmartLights = (lights: SmartLight[], fixtures: Fixture[]) => {
  const exposed: HomeKitSmartLightExposure[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  lights.forEach((light) => {
    const facade = findFacadeFixture(light, fixtures);
    if (!facade) {
      exposed.push({ light, name: hapName(light.name), revision: 0 });
      return;
    }
    if (facade.homekit?.enabled === false) {
      skipped.push({ id: light.id, reason: `Exposition HomeKit desactivee sur « ${facade.name} »` });
      return;
    }
    exposed.push({
      light,
      name: hapName(facade.homekit?.name?.trim() || facade.name),
      // La generation est portee par la facade : c'est elle qui represente la
      // lampe dans HomeKit, donc c'est elle qui decide de son identite.
      revision: facade.homekit?.accessoryRevision ?? 0
    });
  });

  return { exposed, skipped };
};

export const collectHomeKitChannelFixtures = (fixtures: Fixture[], smartLights: SmartLight[] = []) => {
  const channelFixtures: HomeKitChannelFixture[] = [];
  const skipped: Array<{ fixtureId: string; reason: string }> = [];

  // Les facades de lampes connectees sortent du flux canal-par-canal : elles sont
  // exposees en une seule ampoule par collectHomeKitSmartLights. Sans ce filtre,
  // cocher « Exposer dans HomeKit » sur la facade donnerait les DEUX formes.
  const facadeIds = new Set(
    smartLights
      .map((light) => findFacadeFixture(light, fixtures)?.id)
      .filter((id): id is string => id !== undefined)
  );

  fixtures.forEach((fixture) => {
    if (isMovingHead(fixture)) return;
    if (facadeIds.has(fixture.id)) {
      skipped.push({ fixtureId: fixture.id, reason: "Facade DMX d'une lampe connectee (exposee en ampoule)" });
      return;
    }
    const resolution = resolveChannelFixture(fixture);
    if (resolution.cf) {
      channelFixtures.push(resolution.cf);
    } else if (resolution.reason) {
      skipped.push({ fixtureId: fixture.id, reason: resolution.reason });
    }
  });

  return { channelFixtures, skipped };
};

// ─── Lyre (moving head) ──────────────────────────────────────────────────────

// Canaux DMX absolus d'une lyre : intensite (dimmer), shutter (obturateur),
// pan (rotation horizontale), tilt (inclinaison verticale),
// color (roue de couleurs) et gobo. Tous optionnels.
export type MovingHeadChannels = {
  dimmer?: number; // canal DMX absolu (1-512)
  shutter?: number;
  pan?: number;
  tilt?: number;
  color?: number;
  gobo?: number;
};

// Valeurs DMX de repos pour pan/tilt : position prise quand HomeKit demande 0 %.
// Permet de recentrer la lyre plutot que de l'envoyer en butee.
export type MovingHeadDefaults = {
  pan?: number;  // valeur DMX 0-255
  tilt?: number; // valeur DMX 0-255
};

// Lyre prete a etre exposee en accessoire HomeKit multi-services.
export type HomeKitMovingHead = {
  fixture: Fixture;
  name: string;
  deviceId: string;
  channels: MovingHeadChannels;
  defaults: MovingHeadDefaults;
  universe: number;
};

/** Convertit un pourcentage HomeKit (0-100 %) en valeur DMX : 0 % -> defaultDmx, 100 % -> 255. */
export const pctToDmxDefault = (pct: number, defaultDmx: number = 0): number =>
  Math.round(defaultDmx + (clamp(pct, 0, 100) / 100) * (255 - defaultDmx));

/**
 * Conversion inverse : valeur DMX -> pourcentage HomeKit (0-100 %), defaultDmx -> 0 %, 255 -> 100 %.
 * NB : si defaultDmx vaut deja 255, la plage est nulle, on renvoie 0 % pour eviter une division par zero.
 */
export const dmxToPctDefault = (dmx: number, defaultDmx: number = 0): number => {
  if (defaultDmx >= 255) return 0;
  return clamp(Math.round(((dmx - defaultDmx) / (255 - defaultDmx)) * 100), 0, 100);
};

// Soit la lyre est exploitable (mh), soit une raison de rejet est fournie.
type HomeKitMovingHeadResolution =
  | { mh: HomeKitMovingHead; reason?: undefined }
  | { mh?: undefined; reason: string };

// Resout les canaux d'une lyre pour HomeKit.
// Les overrides (homekit.movingHeadChannels) ont priorite sur les capabilities :
// ils permettent de forcer un canal precis quand l'auto-detection ne suffit pas.
const resolveMovingHead = (fixture: Fixture): HomeKitMovingHeadResolution => {
  if (fixture.homekit?.enabled === false) {
    return { reason: "HomeKit disabled in fixture config" };
  }

  const overrides: Partial<FixtureHomeKitMovingHeadChannels> = fixture.homekit?.movingHeadChannels ?? {};

  // Trouve un canal absolu : on prend d'abord l'override (relatif a l'adresse de depart),
  // sinon on cherche la capability correspondante sur les canaux du projecteur.
  const resolveAbsolute = (cap: string, override?: number): number | undefined => {
    if (override !== undefined) return toAbsolute(fixture.address, override);
    const ch = fixture.channels.find((c) => c.capability === cap);
    return ch ? toAbsolute(fixture.address, ch.channel) : undefined;
  };

  const pan = resolveAbsolute("pan", overrides.panChannel);
  const tilt = resolveAbsolute("tilt", overrides.tiltChannel);

  // Sans pan ni tilt, ce n'est pas une lyre pilotable : on l'ecarte.
  if (!pan && !tilt) {
    return { reason: "No pan/tilt channels found" };
  }

  const channels: MovingHeadChannels = {
    dimmer: resolveAbsolute("intensity", overrides.dimmerChannel),
    shutter: resolveAbsolute("strobe", overrides.shutterChannel),
    pan,
    tilt,
    color: resolveAbsolute("color", overrides.colorChannel),
    gobo: resolveAbsolute("gobo", overrides.goboChannel)
  };

  const defaults: MovingHeadDefaults = {
    pan: overrides.panDefault,
    tilt: overrides.tiltDefault
  };

  const deviceId = fixture.homekit?.deviceId?.trim() || fixture.id;
  const name = hapName(fixture.homekit?.name?.trim() || fixture.name);

  return { mh: { fixture, name, deviceId, channels, defaults, universe: fixture.universe } };
};

// Collecte uniquement les lyres exposables en HomeKit et liste les ignorees.
export const collectHomeKitMovingHeads = (fixtures: Fixture[]) => {
  const movingHeads: HomeKitMovingHead[] = [];
  const skipped: Array<{ fixtureId: string; reason: string }> = [];

  fixtures.forEach((fixture) => {
    if (!isMovingHead(fixture)) return;
    const resolution = resolveMovingHead(fixture);
    if (resolution.mh) {
      movingHeads.push(resolution.mh);
    } else {
      skipped.push({ fixtureId: fixture.id, reason: resolution.reason });
    }
  });

  return { movingHeads, skipped };
};
