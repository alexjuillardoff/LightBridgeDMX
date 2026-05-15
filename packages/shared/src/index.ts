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

export const WsEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("universe_tick"), data: UniverseStateSchema }),
  z.object({ type: z.literal("fixture_updated"), data: FixtureSchema }),
  z.object({ type: z.literal("scene_activated"), data: SceneSchema }),
  z.object({ type: z.literal("log"), data: LogEventSchema }),
  z.object({ type: z.literal("dance_state"), data: DanceStateSchema })
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
