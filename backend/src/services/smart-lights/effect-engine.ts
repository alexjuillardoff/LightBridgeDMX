import type {
  Point3D,
  RgbColor,
  SmartLightEffectConfig,
  SmartLightZoneLayout
} from "@lightbridgedmx/shared";

type ZoneSegment = SmartLightZoneLayout["segments"][number];

export type RgbFrame = RgbColor[];

/**
 * Pure function: given (effect config, zone layout, current time, brightness override),
 * return one RGB color per zone. Called every ~33 ms by the SmartLightService stream loop.
 *
 * All effects respect the optional `brightness` field on each effect kind as a master
 * multiplier (0–100 %).
 *
 * Position-aware effects (gradient, wave) use the midpoint of each zone segment, projected
 * onto the configured 3D direction vector. The direction is auto-normalised.
 */
export function evaluateEffect(
  effect: SmartLightEffectConfig,
  layout: SmartLightZoneLayout,
  timeSeconds: number
): RgbFrame {
  const zoneCount = layout.segments.length;
  const spare = new Set(layout.spareZones ?? []);
  const out: RgbFrame = new Array(zoneCount);

  const BLACK: RgbColor = { r: 0, g: 0, b: 0 };
  const finalize = (): RgbFrame => {
    // Always force spare zones to black so they don't show through any effect.
    for (const idx of spare) {
      if (idx >= 0 && idx < zoneCount) out[idx] = BLACK;
    }
    return out;
  };

  switch (effect.kind) {
    case "static": {
      const bri = (effect.brightness ?? 100) / 100;
      for (let i = 0; i < zoneCount; i++) {
        const c = effect.palette[i];
        out[i] = c ? scale(c, bri) : { r: 0, g: 0, b: 0 };
      }
      return finalize();
    }

    case "solid": {
      const c = scale(effect.color, (effect.brightness ?? 100) / 100);
      for (let i = 0; i < zoneCount; i++) out[i] = c;
      return finalize();
    }

    case "gradient": {
      const dir = normalize(effect.direction ?? { x: 1, y: 0, z: 0 });
      const bri = (effect.brightness ?? 100) / 100;
      const scrollOffset = (effect.scrollSpeed ?? 0) * timeSeconds;

      // Project all midpoints onto dir, find min/max for normalization.
      const projections = new Array(zoneCount);
      let pmin = Infinity, pmax = -Infinity;
      for (let i = 0; i < zoneCount; i++) {
        const m = midpoint(layout.segments[i]);
        const p = dot(m, dir);
        projections[i] = p;
        if (p < pmin) pmin = p;
        if (p > pmax) pmax = p;
      }
      const span = Math.max(pmax - pmin, 1e-6);

      for (let i = 0; i < zoneCount; i++) {
        const t = ((projections[i] - pmin) / span + scrollOffset) % 1;
        const tt = t < 0 ? t + 1 : t;
        out[i] = scale(lerpRgb(effect.from, effect.to, tt), bri);
      }
      return finalize();
    }

    case "chase": {
      const bri = (effect.brightness ?? 100) / 100;
      const head = effect.color;
      const bg = effect.bgColor ?? { r: 0, g: 0, b: 0 };
      const width = Math.max(1, effect.width);
      const period = zoneCount + width;
      let pos = (effect.speed * timeSeconds) % period;
      if (pos < 0) pos += period;

      if (effect.bounce) {
        // Triangle wave: 0..zoneCount..0
        const dbl = pos * 2;
        const triPeriod = zoneCount * 2;
        pos = dbl % triPeriod;
        if (pos > zoneCount) pos = triPeriod - pos;
      }

      for (let i = 0; i < zoneCount; i++) {
        const d = Math.abs(i - pos);
        if (d < width / 2) {
          // Linear falloff toward the edges of the head
          const k = 1 - (d / (width / 2));
          out[i] = scale(lerpRgb(bg, head, k), bri);
        } else {
          out[i] = scale(bg, bri);
        }
      }
      return finalize();
    }

    case "wave": {
      const dir = normalize(effect.direction ?? { x: 1, y: 0, z: 0 });
      const bri = (effect.brightness ?? 100) / 100;
      const wl = Math.max(0.01, effect.wavelength);
      const speed = effect.speed;

      for (let i = 0; i < zoneCount; i++) {
        const m = midpoint(layout.segments[i]);
        const p = dot(m, dir);
        const phase = (p / wl + speed * timeSeconds) * 2 * Math.PI;
        const t = (Math.sin(phase) + 1) / 2;
        out[i] = scale(lerpRgb(effect.from, effect.to, t), bri);
      }
      return finalize();
    }
  }
}


/** Re-export from shared so callers can import the engine + builders from one place. */
export { buildLinearLayout as defaultLinearLayout, buildUShapeLayout } from "@lightbridgedmx/shared";

// ─── vector helpers ─────────────────────────────────────────────────────────

function midpoint(seg: ZoneSegment): Point3D {
  return {
    x: (seg.start.x + seg.end.x) / 2,
    y: (seg.start.y + seg.end.y) / 2,
    z: (seg.start.z + seg.end.z) / 2
  };
}

function normalize(p: Point3D): Point3D {
  const len = Math.hypot(p.x, p.y, p.z);
  if (len < 1e-9) return { x: 1, y: 0, z: 0 };
  return { x: p.x / len, y: p.y / len, z: p.z / len };
}

function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function lerpRgb(a: RgbColor, b: RgbColor, t: number): RgbColor {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t)
  };
}

function scale(c: RgbColor, k: number): RgbColor {
  return {
    r: Math.max(0, Math.min(255, Math.round(c.r * k))),
    g: Math.max(0, Math.min(255, Math.round(c.g * k))),
    b: Math.max(0, Math.min(255, Math.round(c.b * k)))
  };
}
