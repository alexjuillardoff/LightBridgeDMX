import { Fixture } from "@lightbridgedmx/shared";

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

export const resolveHomeKitLight = (fixture: Fixture): HomeKitLightResolution => {
  if (fixture.homekit?.enabled === false) {
    return { reason: "HomeKit disabled in fixture config" };
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
