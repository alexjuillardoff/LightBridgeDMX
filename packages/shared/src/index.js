"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QxfLibraryFixtureSchema = exports.QxfParseResultSchema = exports.QxfModeSchema = exports.QxfModeChannelSchema = exports.WsEventSchema = exports.LogEventSchema = exports.UniverseStateSchema = exports.PresetSchema = exports.SceneSchema = exports.SceneStepSchema = exports.FixtureSchema = exports.FixtureProfileSchema = exports.FixtureChannelSchema = exports.FixtureHomeKitSchema = exports.FixtureHomeKitDmxSchema = exports.CapabilitySchema = void 0;
const zod_1 = require("zod");
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
];
exports.CapabilitySchema = zod_1.z.enum(capabilities);
exports.FixtureHomeKitDmxSchema = zod_1.z.object({
    r: zod_1.z.number().int().min(1).max(512),
    g: zod_1.z.number().int().min(1).max(512),
    b: zod_1.z.number().int().min(1).max(512)
});
exports.FixtureHomeKitSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(true).optional(),
    name: zod_1.z.string().min(1).optional(),
    deviceId: zod_1.z.string().min(1).optional(),
    dmxChannels: exports.FixtureHomeKitDmxSchema.optional()
});
exports.FixtureChannelSchema = zod_1.z.object({
    channel: zod_1.z.number().int().min(1).max(512),
    capability: exports.CapabilitySchema,
    name: zod_1.z.string().min(1).optional()
});
exports.FixtureProfileSchema = zod_1.z.object({
    source: zod_1.z.literal("qxf"),
    manufacturer: zod_1.z.string(),
    model: zod_1.z.string(),
    mode: zod_1.z.string()
});
exports.FixtureSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    name: zod_1.z.string().min(1),
    address: zod_1.z.number().int().min(1).max(512),
    channels: zod_1.z.array(exports.FixtureChannelSchema).min(1),
    universe: zod_1.z.number().int().min(0).default(0),
    createdAt: zod_1.z.string().datetime(),
    profile: exports.FixtureProfileSchema.optional(),
    homekit: exports.FixtureHomeKitSchema.optional()
});
exports.SceneStepSchema = zod_1.z.object({
    fixtureId: zod_1.z.string().uuid(),
    values: zod_1.z.array(zod_1.z.number().int().min(0).max(255)).min(1)
});
exports.SceneSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    name: zod_1.z.string().min(1),
    steps: zod_1.z.array(exports.SceneStepSchema).default([])
});
exports.PresetSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    name: zod_1.z.string().min(1),
    payload: zod_1.z.record(zod_1.z.number().int().min(0).max(255))
});
exports.UniverseStateSchema = zod_1.z.object({
    fps: zod_1.z.number().nonnegative(),
    universe: zod_1.z.number().int().min(0),
    values: zod_1.z.array(zod_1.z.number().int().min(0).max(255)).length(512),
    timestamp: zod_1.z.string().datetime()
});
exports.LogEventSchema = zod_1.z.object({
    level: zod_1.z.enum(["info", "warn", "error"]),
    message: zod_1.z.string(),
    timestamp: zod_1.z.string().datetime()
});
exports.WsEventSchema = zod_1.z.discriminatedUnion("type", [
    zod_1.z.object({ type: zod_1.z.literal("universe_tick"), data: exports.UniverseStateSchema }),
    zod_1.z.object({ type: zod_1.z.literal("fixture_updated"), data: exports.FixtureSchema }),
    zod_1.z.object({ type: zod_1.z.literal("scene_activated"), data: exports.SceneSchema }),
    zod_1.z.object({ type: zod_1.z.literal("log"), data: exports.LogEventSchema })
]);
exports.QxfModeChannelSchema = exports.FixtureChannelSchema.extend({
    name: zod_1.z.string().min(1),
    group: zod_1.z.string().optional(),
    preset: zod_1.z.string().optional()
});
exports.QxfModeSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    channels: zod_1.z.array(exports.QxfModeChannelSchema),
    channelCount: zod_1.z.number().int().min(1)
});
exports.QxfParseResultSchema = zod_1.z.object({
    manufacturer: zod_1.z.string().min(1),
    model: zod_1.z.string().min(1),
    modes: zod_1.z.array(exports.QxfModeSchema)
});
exports.QxfLibraryFixtureSchema = exports.QxfParseResultSchema.extend({
    path: zod_1.z.string(),
    brand: zod_1.z.string().optional()
});
