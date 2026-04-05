import { Fixture, FixtureHomeKitMovingHeadChannels } from "@lightbridgedmx/shared";

export type HsbColor = {
  hue: number;
  saturation: number;
  brightness: number;
};

export type RgbColor = {
  r: number;
  g: number;
  b: number;
};

export type DmxRgbMapping = {
  r: number;
  g: number;
  b: number;
  universe: number;
  source: "config" | "capability";
  address: number;
};

export type HomeKitLight = {
  fixture: Fixture;
  name: string;
  deviceId: string;
  mapping: DmxRgbMapping;
};

export type HomeKitLightResolution =
  | { light: HomeKitLight; reason?: undefined }
  | { light?: undefined; reason: string };

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

export const isMovingHead = (fixture: Fixture): boolean =>
  fixture.channels.some((ch) => ch.capability === "pan" || ch.capability === "tilt");

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

  const deviceId = fixture.homekit?.deviceId?.trim() || fixture.id;
  const name = fixture.homekit?.name?.trim() || fixture.name;

  return {
    light: {
      fixture,
      name,
      deviceId,
      mapping: inferred
    }
  };
};

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

const inferFromCapabilities = (fixture: Fixture) => {
  const r = fixture.channels.find((ch) => ch.capability === "r")?.channel;
  const g = fixture.channels.find((ch) => ch.capability === "g")?.channel;
  const b = fixture.channels.find((ch) => ch.capability === "b")?.channel;
  if (!r || !g || !b) return null;

  return toAbsoluteChannels(fixture.address, { r, g, b });
};

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

const toAbsolute = (address: number, channel: number) => address + channel - 1;

// ─── Channel Fixture (per-channel RGB/W/Master) ──────────────────────────────

export type ChannelFixtureChannels = {
  r?: number;       // absolute DMX channel (1-512)
  g?: number;
  b?: number;
  w?: number;
  intensity?: number;
};

export type HomeKitChannelFixture = {
  fixture: Fixture;
  name: string;
  deviceId: string;
  channels: ChannelFixtureChannels;
  universe: number;
};

type HomeKitChannelFixtureResolution =
  | { cf: HomeKitChannelFixture; reason?: undefined }
  | { cf?: undefined; reason: string };

const resolveChannelFixture = (fixture: Fixture): HomeKitChannelFixtureResolution => {
  if (fixture.homekit?.enabled === false) {
    return { reason: "HomeKit disabled in fixture config" };
  }

  if (isMovingHead(fixture)) {
    return { reason: "Moving head — handled by moving head service" };
  }

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
  const name = fixture.homekit?.name?.trim() || fixture.name;

  return { cf: { fixture, name, deviceId, channels, universe: fixture.universe } };
};

export const collectHomeKitChannelFixtures = (fixtures: Fixture[]) => {
  const channelFixtures: HomeKitChannelFixture[] = [];
  const skipped: Array<{ fixtureId: string; reason: string }> = [];

  fixtures.forEach((fixture) => {
    if (isMovingHead(fixture)) return;
    const resolution = resolveChannelFixture(fixture);
    if (resolution.cf) {
      channelFixtures.push(resolution.cf);
    } else if (resolution.reason) {
      skipped.push({ fixtureId: fixture.id, reason: resolution.reason });
    }
  });

  return { channelFixtures, skipped };
};

// ─── Moving Head ────────────────────────────────────────────────────────────

export type MovingHeadChannels = {
  dimmer?: number; // absolute DMX channel (1-512)
  shutter?: number;
  pan?: number;
  tilt?: number;
  color?: number;
  gobo?: number;
};

export type MovingHeadDefaults = {
  pan?: number;  // DMX value 0-255
  tilt?: number; // DMX value 0-255
};

export type HomeKitMovingHead = {
  fixture: Fixture;
  name: string;
  deviceId: string;
  channels: MovingHeadChannels;
  defaults: MovingHeadDefaults;
  universe: number;
};

/** Convert HomeKit 0-100% to DMX value, mapping 0% to defaultDmx and 100% to 255 */
export const pctToDmxDefault = (pct: number, defaultDmx: number = 0): number =>
  Math.round(defaultDmx + (clamp(pct, 0, 100) / 100) * (255 - defaultDmx));

/** Convert DMX value to HomeKit 0-100%, mapping defaultDmx to 0% and 255 to 100% */
export const dmxToPctDefault = (dmx: number, defaultDmx: number = 0): number => {
  if (defaultDmx >= 255) return 0;
  return clamp(Math.round(((dmx - defaultDmx) / (255 - defaultDmx)) * 100), 0, 100);
};

type HomeKitMovingHeadResolution =
  | { mh: HomeKitMovingHead; reason?: undefined }
  | { mh?: undefined; reason: string };

const resolveMovingHead = (fixture: Fixture): HomeKitMovingHeadResolution => {
  if (fixture.homekit?.enabled === false) {
    return { reason: "HomeKit disabled in fixture config" };
  }

  const overrides: Partial<FixtureHomeKitMovingHeadChannels> = fixture.homekit?.movingHeadChannels ?? {};

  const resolveAbsolute = (cap: string, override?: number): number | undefined => {
    if (override !== undefined) return toAbsolute(fixture.address, override);
    const ch = fixture.channels.find((c) => c.capability === cap);
    return ch ? toAbsolute(fixture.address, ch.channel) : undefined;
  };

  const pan = resolveAbsolute("pan", overrides.panChannel);
  const tilt = resolveAbsolute("tilt", overrides.tiltChannel);

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
  const name = fixture.homekit?.name?.trim() || fixture.name;

  return { mh: { fixture, name, deviceId, channels, defaults, universe: fixture.universe } };
};

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
