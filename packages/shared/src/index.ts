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

export const FixtureHomeKitSchema = z.object({
  enabled: z.boolean().default(true).optional(),
  name: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  dmxChannels: FixtureHomeKitDmxSchema.optional()
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
  homekit: FixtureHomeKitSchema.optional()
});

export type Fixture = z.infer<typeof FixtureSchema>;

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
  z.object({ type: z.literal("log"), data: LogEventSchema })
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
