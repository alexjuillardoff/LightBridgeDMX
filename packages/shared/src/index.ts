import { z } from "zod";

const capabilities = [
  "intensity",
  "r",
  "g",
  "b",
  "w",
  "uv",
  "strobe",
  "colorTemp",
  "color",
  "pan",
  "tilt",
  "gobo",
  "beam",
  "effect",
  "speed",
  "prism",
  "focus",
  "maintenance",
  "other"
] as const;

export const CapabilitySchema = z.enum(capabilities);

export type Capability = z.infer<typeof CapabilitySchema>;

export const FixtureHomeKitDmxSchema = z.object({
  r: z.number().int().min(1).max(512),
  g: z.number().int().min(1).max(512),
  b: z.number().int().min(1).max(512)
});

export type FixtureHomeKitDmx = z.infer<typeof FixtureHomeKitDmxSchema>;

export const FixtureHomeKitMovingHeadChannelsSchema = z.object({
  dimmerChannel: z.number().int().min(1).optional(),
  shutterChannel: z.number().int().min(1).optional(),
  panChannel: z.number().int().min(1).optional(),
  tiltChannel: z.number().int().min(1).optional(),
  colorChannel: z.number().int().min(1).optional(),
  goboChannel: z.number().int().min(1).optional(),
  panDefault: z.number().int().min(0).max(255).optional(),
  tiltDefault: z.number().int().min(0).max(255).optional()
});

export type FixtureHomeKitMovingHeadChannels = z.infer<typeof FixtureHomeKitMovingHeadChannelsSchema>;

export const FixtureHomeKitSchema = z.object({
  enabled: z.boolean().default(true).optional(),
  name: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  dmxChannels: FixtureHomeKitDmxSchema.optional(),
  movingHeadChannels: FixtureHomeKitMovingHeadChannelsSchema.optional()
});

export type FixtureHomeKit = z.infer<typeof FixtureHomeKitSchema>;

export const FixtureChannelSchema = z.object({
  channel: z.number().int().min(1).max(512),
  capability: CapabilitySchema,
  name: z.string().min(1).optional()
});

export type FixtureChannel = z.infer<typeof FixtureChannelSchema>;

export const FixtureProfileSchema = z.object({
  source: z.literal("qxf"),
  manufacturer: z.string(),
  model: z.string(),
  mode: z.string()
});

export type FixtureProfile = z.infer<typeof FixtureProfileSchema>;

export const FixtureSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  address: z.number().int().min(1).max(512),
  channels: z.array(FixtureChannelSchema).min(1),
  universe: z.number().int().min(0).default(0),
  createdAt: z.string().datetime(),
  profile: FixtureProfileSchema.optional(),
  homekit: FixtureHomeKitSchema.optional(),
  room: z.string().min(1).optional()
});

export type Fixture = z.infer<typeof FixtureSchema>;

export const DancePatternIds = [
  "chase",
  "reverseChase",
  "pingPong",
  "waveLR",
  "waveRL",
  "alternate",
  "pairs",
  "randomSubset",
  "allHit",
  "strobeSync",
  "bookendIn",
  "bookendOut"
] as const;

export const DancePatternIdSchema = z.enum(DancePatternIds);
export type DancePatternId = z.infer<typeof DancePatternIdSchema>;

export const DanceLyrePositionSchema = z.object({
  fixtureId: z.string().uuid(),
  pan: z.number().int().min(0).max(255),
  tilt: z.number().int().min(0).max(255)
});

export type DanceLyrePosition = z.infer<typeof DanceLyrePositionSchema>;

export const DanceFreeAnchorSchema = z.object({
  pan: z.number().int().min(0).max(255),
  tilt: z.number().int().min(0).max(255)
});

export type DanceFreeAnchor = z.infer<typeof DanceFreeAnchorSchema>;

export const DanceLyreModeSchema = z.object({
  enabled: z.boolean(),
  shutterOpenValue: z.number().int().min(0).max(255),
  dimmerOnValue: z.number().int().min(0).max(255),
  followChase: z.boolean(),
  positions: z.array(DanceLyrePositionSchema),
  // Wall edge to the right of the rightmost fixture in the visual chain. Used as an
  // additional anchor for piecewise interpolation/extrapolation beyond the last fixture.
  wallEdgeRight: DanceFreeAnchorSchema.nullable(),
  // DMX value written to the lyre's "speed" capability channel (response speed).
  // For Stairville MH-X20: 0 = fastest movement, 251 = slowest (255 = vector modes).
  speedValue: z.number().int().min(0).max(255),
  // Time the lyre needs to traverse 1 DMX unit of pan or tilt, in ms. Used to compute
  // the per-move duration based on distance — and to black out the dimmer + close the
  // shutter while the lyre is in transit (a lyre flashing mid-flight looks bad).
  // For Stairville MH-X20 at speed=0: ~40 ms/unit (Lava→Café = 10 units ≈ 400 ms).
  msPerPanUnit: z.number().int().min(1).max(500)
});

export type DanceLyreMode = z.infer<typeof DanceLyreModeSchema>;

export const DanceConfigSchema = z.object({
  enabled: z.boolean(),
  rooms: z.array(z.string().min(1)),
  intervalMinMs: z.number().int().min(1).max(2000),
  intervalMaxMs: z.number().int().min(1).max(2000),
  patterns: z.array(DancePatternIdSchema),
  excludePanTilt: z.boolean(),
  excludeCapabilities: z.array(CapabilitySchema),
  lyre: DanceLyreModeSchema,
  updatedAt: z.string().datetime()
});

export type DanceConfig = z.infer<typeof DanceConfigSchema>;

export const DanceStateSchema = z.object({
  config: DanceConfigSchema,
  running: z.boolean(),
  activeFixtureIds: z.array(z.string().uuid()),
  currentPattern: z.string().nullable(),
  phasesSent: z.number().int().nonnegative()
});

export type DanceState = z.infer<typeof DanceStateSchema>;

export const SceneStepSchema = z.object({
  fixtureId: z.string().uuid(),
  values: z.array(z.number().int().min(0).max(255)).min(1)
});

export type SceneStep = z.infer<typeof SceneStepSchema>;

export const SceneSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  steps: z.array(SceneStepSchema).default([])
});

export type Scene = z.infer<typeof SceneSchema>;

export const PresetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  payload: z.record(z.number().int().min(0).max(255))
});

export type Preset = z.infer<typeof PresetSchema>;

export const UniverseStateSchema = z.object({
  fps: z.number().nonnegative(),
  universe: z.number().int().min(0),
  values: z.array(z.number().int().min(0).max(255)).length(512),
  timestamp: z.string().datetime()
});

export type UniverseState = z.infer<typeof UniverseStateSchema>;

export const LogEventSchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  message: z.string(),
  timestamp: z.string().datetime()
});

export type LogEvent = z.infer<typeof LogEventSchema>;

// ─── Smart Lights (Nanoleaf / HomeKit / Matter externes) ────────────────────

export const SmartLightBackendTypeSchema = z.enum(["nanoleaf-http"]);
export type SmartLightBackendType = z.infer<typeof SmartLightBackendTypeSchema>;

// Backend config: discriminated on `type`. Each backend describes how to reach the device.
export const NanoleafHttpConfigSchema = z.object({
  type: z.literal("nanoleaf-http"),
  host: z.string().min(1),         // e.g. "192.168.0.234"
  port: z.number().int().min(1).max(65535).default(16021).optional(),
  token: z.string().min(1).optional(), // auth token from /api/v1/new (set after pairing)
  deviceName: z.string().optional()    // device-reported name (e.g. "Light Strip 5DA6")
});
export type NanoleafHttpConfig = z.infer<typeof NanoleafHttpConfigSchema>;

export const SmartLightBackendConfigSchema = z.discriminatedUnion("type", [
  NanoleafHttpConfigSchema
]);
export type SmartLightBackendConfig = z.infer<typeof SmartLightBackendConfigSchema>;

// Optional mirror: bind the smart light to DMX channels in the universe so that
// existing scenes / Dance mode / channel sliders drive it transparently.
export const SmartLightDmxMirrorSchema = z.object({
  universe: z.number().int().min(0).default(0).optional(),
  rChannel: z.number().int().min(1).max(512).optional(),
  gChannel: z.number().int().min(1).max(512).optional(),
  bChannel: z.number().int().min(1).max(512).optional(),
  briChannel: z.number().int().min(1).max(512).optional() // optional master dimmer override
});
export type SmartLightDmxMirror = z.infer<typeof SmartLightDmxMirrorSchema>;

export const SmartLightColorModeSchema = z.enum(["hs", "ct", "effect"]);
export type SmartLightColorMode = z.infer<typeof SmartLightColorModeSchema>;

export const SmartLightStateSchema = z.object({
  on: z.boolean(),
  hue: z.number().min(0).max(360),       // degrees
  sat: z.number().min(0).max(100),       // percent
  brightness: z.number().min(0).max(100),// percent
  ct: z.number().min(1000).max(10000).optional(),         // Kelvin (NL72K3 ≈ 2127–6535)
  colorMode: SmartLightColorModeSchema.optional(),
  currentEffect: z.string().optional(),  // when colorMode = "effect"
  reachable: z.boolean().default(true).optional()
});
export type SmartLightState = z.infer<typeof SmartLightStateSchema>;

// User-tunable streaming config (UDP extControl for Nanoleaf).
// When enabled the SmartLightService maintains a continuous UDP stream
// instead of HTTP coalesced PUT /state writes — dropping latency from
// ~100 ms to ~5–15 ms, useful for DMX-mirror and music-sync use cases.
export const SmartLightStreamingSchema = z.object({
  enabled: z.boolean().default(false).optional(),
  zoneCount: z.number().int().min(1).max(500).optional() // discovered from device
});
export type SmartLightStreaming = z.infer<typeof SmartLightStreamingSchema>;

// ─── 3D Layout ──────────────────────────────────────────────────────────────

export const Point3DSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number()
});
export type Point3D = z.infer<typeof Point3DSchema>;

/** A single addressable zone of an LED strip: a line segment from start to end in 3D space.
 *  Effects use start, end, and midpoint to compute per-zone colors. */
export const ZoneSegmentSchema = z.object({
  start: Point3DSchema,
  end: Point3DSchema
});
export type ZoneSegment = z.infer<typeof ZoneSegmentSchema>;

export const SmartLightZoneLayoutSchema = z.object({
  /** Linked = consecutive segments share an endpoint (polyline). Unlinked = every segment is free. */
  mode: z.enum(["linked", "unlinked"]).default("linked").optional(),
  segments: z.array(ZoneSegmentSchema).min(1).max(500),
  /** Indices (0-based) of zones that are SPARE — present in the streaming protocol but no physical
   *  LED behind them. The EffectEngine forces these to black; the 3D editor hides their segments;
   *  the painter shows them as hatched. Example on NL72K3 where strip < 50 LEDs. */
  spareZones: z.array(z.number().int().min(0).max(999)).optional(),
  /** Optional logical labels for sides (e.g. "back", "left", "front", "right") with zone ranges.
   *  Used by the U-shape preset and as guidance for the user. */
  sides: z
    .array(
      z.object({
        label: z.string().min(1),
        zoneStart: z.number().int().min(0).max(499),
        zoneEnd: z.number().int().min(0).max(499),
        color: z.string().optional() // hex for UI hint
      })
    )
    .optional()
});
export type SmartLightZoneLayout = z.infer<typeof SmartLightZoneLayoutSchema>;

// ─── Effects ────────────────────────────────────────────────────────────────

export const RgbColorSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255)
});
export type RgbColor = z.infer<typeof RgbColorSchema>;

/**
 * Effect config — discriminated by `kind`. The EffectEngine evaluates these every frame
 * (30 Hz) against the zone layout and pushes a per-zone color frame via the streamer.
 *
 *   • "static"   — fixed per-zone palette painted in the UI
 *   • "solid"    — single color across all zones
 *   • "gradient" — interpolate between two colors along a direction in 3D space
 *   • "chase"    — a moving lit "head" of N zones traveling along the strip
 *   • "wave"     — sine wave colored from→to traveling along a direction
 */
export const EffectStaticSchema = z.object({
  kind: z.literal("static"),
  palette: z.array(RgbColorSchema),
  brightness: z.number().min(0).max(100).default(100).optional()
});
export const EffectSolidSchema = z.object({
  kind: z.literal("solid"),
  color: RgbColorSchema,
  brightness: z.number().min(0).max(100).default(100).optional()
});
export const EffectGradientSchema = z.object({
  kind: z.literal("gradient"),
  from: RgbColorSchema,
  to: RgbColorSchema,
  direction: Point3DSchema.optional(),
  scrollSpeed: z.number().default(0).optional(),
  brightness: z.number().min(0).max(100).default(100).optional()
});
export const EffectChaseSchema = z.object({
  kind: z.literal("chase"),
  color: RgbColorSchema,
  bgColor: RgbColorSchema.optional(),
  speed: z.number().min(0.1).max(50).default(5),
  width: z.number().int().min(1).max(50).default(3),
  bounce: z.boolean().default(false).optional(),
  brightness: z.number().min(0).max(100).default(100).optional()
});
export const EffectWaveSchema = z.object({
  kind: z.literal("wave"),
  from: RgbColorSchema,
  to: RgbColorSchema,
  direction: Point3DSchema.optional(),
  wavelength: z.number().min(0.05).max(50).default(1),
  speed: z.number().min(-20).max(20).default(1),
  brightness: z.number().min(0).max(100).default(100).optional()
});

export const SmartLightEffectConfigSchema = z.discriminatedUnion("kind", [
  EffectStaticSchema,
  EffectSolidSchema,
  EffectGradientSchema,
  EffectChaseSchema,
  EffectWaveSchema
]);
export type SmartLightEffectConfig = z.infer<typeof SmartLightEffectConfigSchema>;

// ─── Layout builders (pure helpers, shared between backend & frontend) ──────

function _lerpPoint(a: Point3D, b: Point3D, t: number): Point3D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Linear strip along the X axis from -0.5 to +0.5. Used as a default when no layout is set. */
export function buildLinearLayout(zoneCount: number): SmartLightZoneLayout {
  const segments: ZoneSegment[] = [];
  for (let i = 0; i < zoneCount; i++) {
    const t0 = i / zoneCount;
    const t1 = (i + 1) / zoneCount;
    segments.push({
      start: { x: t0 - 0.5, y: 0, z: 0 },
      end: { x: t1 - 0.5, y: 0, z: 0 }
    });
  }
  return { mode: "linked", segments };
}

/**
 * Build a U-shape layout around 4 sides of a rectangular room.
 *
 * Input: number of active zones per side (back / right / front / left) + dimensions.
 * Coordinate system: X = left↔right (back/front edges), Z = back↔front (left/right edges), Y = floor.
 * The trace runs clockwise viewed from above: back-left → back-right → front-right → front-left.
 *
 * Total active = back + right + front + left. Remaining zones (totalZones - active) → auto-spare,
 * positioned in a hidden corner to keep the streaming frame well-formed.
 */
export function buildUShapeLayout(opts: {
  totalZones: number;
  backZones: number;
  rightZones: number;
  frontZones: number;
  leftZones: number;
  width?: number;  // back/front edges length (default 4 m)
  depth?: number;  // left/right edges length (default 3 m)
  height?: number; // Y position of the strip (default 0)
}): SmartLightZoneLayout {
  const w = opts.width ?? 4;
  const d = opts.depth ?? 3;
  const y = opts.height ?? 0;
  const halfW = w / 2;
  const segments: ZoneSegment[] = [];
  const sides: NonNullable<SmartLightZoneLayout["sides"]> = [];

  const pushSide = (
    label: string,
    n: number,
    color: string,
    start: Point3D,
    end: Point3D
  ): void => {
    if (n <= 0) return;
    const startIdx = segments.length;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      segments.push({
        start: _lerpPoint(start, end, t0),
        end: _lerpPoint(start, end, t1)
      });
    }
    sides.push({ label, zoneStart: startIdx, zoneEnd: segments.length - 1, color });
  };

  pushSide("back",  opts.backZones,  "#ffeb3b", { x: -halfW, y, z: 0 }, { x: +halfW, y, z: 0 });
  pushSide("right", opts.rightZones, "#f44336", { x: +halfW, y, z: 0 }, { x: +halfW, y, z: d });
  pushSide("front", opts.frontZones, "#2196f3", { x: +halfW, y, z: d }, { x: -halfW, y, z: d });
  pushSide("left",  opts.leftZones,  "#4caf50", { x: -halfW, y, z: d }, { x: -halfW, y, z: 0 });

  // Pad with hidden spare zones up to totalZones.
  const active = segments.length;
  const spareZones: number[] = [];
  for (let i = active; i < opts.totalZones; i++) {
    segments.push({
      start: { x: -halfW - 0.2, y, z: -0.2 - (i - active) * 0.02 },
      end:   { x: -halfW - 0.2, y, z: -0.2 - (i - active + 1) * 0.02 }
    });
    spareZones.push(i);
  }

  return { mode: "linked", segments, spareZones, sides };
}

export const SmartLightSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  room: z.string().min(1).optional(),
  backend: SmartLightBackendTypeSchema,
  config: SmartLightBackendConfigSchema,
  dmxMirror: SmartLightDmxMirrorSchema.nullable().optional(),
  streaming: SmartLightStreamingSchema.optional(),
  /** Per-zone physical placement (for position-aware effects). */
  zoneLayout: SmartLightZoneLayoutSchema.nullable().optional(),
  /** Active effect — runs continuously in the EffectEngine when streaming is enabled. */
  currentEffect: SmartLightEffectConfigSchema.nullable().optional(),
  state: SmartLightStateSchema.optional(),
  createdAt: z.string().datetime()
});
export type SmartLight = z.infer<typeof SmartLightSchema>;

export const SmartLightInputSchema = SmartLightSchema.omit({
  id: true,
  createdAt: true,
  state: true
}).extend({
  id: z.string().uuid().optional()
});
export type SmartLightInput = z.infer<typeof SmartLightInputSchema>;

export const SmartLightStateInputSchema = z.object({
  on: z.boolean().optional(),
  hue: z.number().min(0).max(360).optional(),
  sat: z.number().min(0).max(100).optional(),
  brightness: z.number().min(0).max(100).optional(),
  ct: z.number().min(1000).max(10000).optional(),
  // Convenience: clients can pass RGB directly; backend converts to HSV.
  rgb: z
    .object({
      r: z.number().int().min(0).max(255),
      g: z.number().int().min(0).max(255),
      b: z.number().int().min(0).max(255)
    })
    .optional()
});
export type SmartLightStateInput = z.infer<typeof SmartLightStateInputSchema>;

// Per-zone palette (for strips like NL72K3 with addressable LEDs).
// Each entry maps a zone index to a color; zones omitted stay at their last value.
export const SmartLightZonePaletteSchema = z.object({
  zones: z
    .array(
      z.object({
        index: z.number().int().min(0).max(999),
        r: z.number().int().min(0).max(255),
        g: z.number().int().min(0).max(255),
        b: z.number().int().min(0).max(255),
        w: z.number().int().min(0).max(255).optional()
      })
    )
    .min(1)
});
export type SmartLightZonePalette = z.infer<typeof SmartLightZonePaletteSchema>;


export const SmartLightEffectSchema = z.object({
  name: z.string(),
  active: z.boolean().default(false).optional()
});
export type SmartLightEffect = z.infer<typeof SmartLightEffectSchema>;

export const NanoleafDiscoveredSchema = z.object({
  host: z.string(),
  port: z.number().int().default(16021),
  name: z.string().optional(),
  model: z.string().optional()
});
export type NanoleafDiscovered = z.infer<typeof NanoleafDiscoveredSchema>;

export const SmartLightPairInputSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(16021).optional(),
  name: z.string().min(1).optional(),
  room: z.string().min(1).optional()
});
export type SmartLightPairInput = z.infer<typeof SmartLightPairInputSchema>;

export const WsEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("universe_tick"), data: UniverseStateSchema }),
  z.object({ type: z.literal("fixture_updated"), data: FixtureSchema }),
  z.object({ type: z.literal("scene_activated"), data: SceneSchema }),
  z.object({ type: z.literal("log"), data: LogEventSchema }),
  z.object({ type: z.literal("dance_state"), data: DanceStateSchema }),
  z.object({ type: z.literal("smart_light_updated"), data: SmartLightSchema })
]);

export type WsEvent = z.infer<typeof WsEventSchema>;

export const QxfModeChannelSchema = FixtureChannelSchema.extend({
  name: z.string().min(1),
  group: z.string().optional(),
  preset: z.string().optional()
});

export type QxfModeChannel = z.infer<typeof QxfModeChannelSchema>;

export const QxfModeSchema = z.object({
  name: z.string().min(1),
  channels: z.array(QxfModeChannelSchema),
  channelCount: z.number().int().min(1)
});

export type QxfMode = z.infer<typeof QxfModeSchema>;

export const QxfParseResultSchema = z.object({
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  modes: z.array(QxfModeSchema)
});

export type QxfParseResult = z.infer<typeof QxfParseResultSchema>;

export const QxfLibraryFixtureSchema = QxfParseResultSchema.extend({
  path: z.string(),
  brand: z.string().optional()
});

export type QxfLibraryFixture = z.infer<typeof QxfLibraryFixtureSchema>;
