import { Capability, QxfMode, QxfParseResult, QxfParseResultSchema } from "@lightbridgedmx/shared";
import { XMLParser } from "fast-xml-parser";
import type { FixtureInput } from "../state/store";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  allowBooleanAttributes: true
});

type RawQxf = {
  FixtureDefinition?: {
    Manufacturer?: string;
    Model?: string;
    Channel?: RawChannel | RawChannel[];
    Mode?: RawMode | RawMode[];
  };
};

type RawChannel = {
  Name?: string;
  Preset?: string;
  Group?: unknown;
};

type RawMode = {
  Name?: string;
  Channel?: RawModeChannel | RawModeChannel[];
};

type RawModeChannel = {
  text?: string;
  Number?: string;
  Name?: string;
};

type QxfSource = { qxf?: string; url?: string };

export class QxfError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

export const loadQxfFromSource = async (source: QxfSource): Promise<string> => {
  if (source.qxf?.trim()) return source.qxf;
  if (!source.url) {
    throw new QxfError("Provide a QXF file or URL");
  }

  let response: Response;
  try {
    response = await fetch(source.url);
  } catch (err) {
    throw new QxfError(`Failed to download QXF: ${(err as Error).message}`);
  }

  if (!response.ok) {
    throw new QxfError(`Failed to download QXF (HTTP ${response.status})`, response.status);
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new QxfError("Downloaded QXF is empty");
  }

  return text;
};

export const parseQxf = (xml: string): QxfParseResult => {
  let parsed: RawQxf;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    throw new QxfError("Invalid QXF: failed to parse XML");
  }

  const fixture = parsed?.FixtureDefinition;
  if (!fixture) throw new QxfError("Invalid QXF: missing FixtureDefinition root");

  const manufacturer = fixture.Manufacturer ?? "Unknown manufacturer";
  const model = fixture.Model ?? "Unknown model";
  const channelDefinitions = new Map<string, RawChannel>();

  toArray(fixture.Channel).forEach((channel) => {
    if (channel?.Name) {
      channelDefinitions.set(channel.Name, channel);
    }
  });

  const rawModes = toArray(fixture.Mode);
  if (rawModes.length === 0) throw new QxfError("QXF file has no mode definitions");

  const modes: QxfMode[] = rawModes.map((mode, modeIndex) => {
    const rawChannels = toArray(mode.Channel);
    if (rawChannels.length === 0) {
      throw new QxfError(`Mode "${mode.Name ?? modeIndex + 1}" has no channels`);
    }

    const resolved = rawChannels
      .map((modeChannel, channelIndex) => {
        const name =
          typeof modeChannel === "string"
            ? modeChannel
            : modeChannel.text ?? modeChannel.Name ?? `Channel ${channelIndex + 1}`;

        const orderRaw =
          typeof modeChannel === "object" && "Number" in modeChannel
            ? (modeChannel as RawModeChannel).Number
            : undefined;
        const order = orderRaw ? Number.parseInt(orderRaw, 10) : Number.NaN;
        const channelNumber = Number.isFinite(order) ? order + 1 : channelIndex + 1;
        if (channelNumber < 1 || channelNumber > 512) {
          throw new QxfError(`Channel number out of DMX range in mode "${mode.Name ?? modeIndex + 1}"`);
        }

        const definition = name ? channelDefinitions.get(name) : undefined;
        const group = normalizeGroup(definition?.Group);
        const preset = definition?.Preset;
        const capability = resolveCapability({ preset, group, name });

        return { channel: channelNumber, capability, name, group, preset };
      })
      .sort((a, b) => a.channel - b.channel);

    return {
      name: mode.Name ?? `Mode ${modeIndex + 1}`,
      channels: resolved,
      channelCount: resolved.length
    };
  });

  return QxfParseResultSchema.parse({ manufacturer, model, modes });
};

export const selectQxfMode = (parsed: QxfParseResult, desired?: string): QxfMode => {
  if (!parsed.modes.length) {
    throw new QxfError("No modes found in QXF");
  }
  if (!desired) return parsed.modes[0];

  const mode = parsed.modes.find((m) => m.name.toLowerCase() === desired.toLowerCase());
  if (!mode) throw new QxfError(`Mode "${desired}" not found in QXF`);
  return mode;
};

export const buildFixtureFromQxf = (
  parsed: QxfParseResult,
  options: { address: number; universe?: number; mode?: string; name?: string }
): FixtureInput => {
  const mode = selectQxfMode(parsed, options.mode);
  const fallbackName = `${parsed.manufacturer} ${parsed.model} (${mode.name})`;

  return {
    name: options.name?.trim() || fallbackName,
    address: options.address,
    universe: options.universe ?? 0,
    channels: mode.channels.map(({ channel, capability, name }) => ({
      channel,
      capability,
      name
    })),
    profile: {
      source: "qxf",
      manufacturer: parsed.manufacturer,
      model: parsed.model,
      mode: mode.name
    }
  };
};

const toArray = <T>(value?: T | T[]): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const normalizeGroup = (group: unknown): string | undefined => {
  if (!group) return undefined;
  if (typeof group === "string") return group;
  if (typeof group === "object" && group !== null) {
    const maybe = (group as Record<string, unknown>).text ?? (group as Record<string, unknown>).Name;
    if (typeof maybe === "string") return maybe;
  }
  return undefined;
};

const resolveCapability = (input: { preset?: string; group?: string; name?: string }): Capability => {
  const fromPreset = presetToCapability(input.preset);
  if (fromPreset) return fromPreset;

  const fromGroup = groupToCapability(input.group);
  if (fromGroup) return fromGroup;

  const fromName = nameToCapability(input.name);
  if (fromName) return fromName;

  return "other";
};

const presetToCapability = (preset?: string): Capability | null => {
  if (!preset) return null;
  const value = preset.toLowerCase();
  if (value.includes("red")) return "r";
  if (value.includes("green")) return "g";
  if (value.includes("blue")) return "b";
  if (value.includes("uv")) return "uv";
  if (value.includes("white") || value.includes("amber")) return "w";
  if (value.includes("strobe") || value.includes("shutter")) return "strobe";
  if (value.includes("intensity") || value.includes("dimmer")) return "intensity";
  if (value.includes("color") && value.includes("temp")) return "colorTemp";
  if (value.includes("cct") || value.includes("ct")) return "colorTemp";
  return null;
};

const groupToCapability = (group?: string): Capability | null => {
  if (!group) return null;
  const normalized = group.toLowerCase();
  switch (normalized) {
    case "intensity":
      return "intensity";
    case "colour":
    case "color":
      return "color";
    case "gobo":
      return "gobo";
    case "beam":
      return "beam";
    case "pan":
      return "pan";
    case "tilt":
      return "tilt";
    case "effect":
      return "effect";
    case "speed":
      return "speed";
    case "prism":
      return "prism";
    case "focus":
      return "focus";
    case "maintenance":
      return "maintenance";
    case "shutter":
      return "strobe";
    default:
      return null;
  }
};

const nameToCapability = (name?: string): Capability | null => {
  if (!name) return null;
  const value = name.toLowerCase();
  if (value.includes("red")) return "r";
  if (value.includes("green")) return "g";
  if (value.includes("blue")) return "b";
  if (value.includes("uv")) return "uv";
  if (value.includes("white") || value.includes("amber")) return "w";
  if (value.includes("strobe") || value.includes("shutter")) return "strobe";
  if (value.includes("intensity") || value.includes("dimmer") || value.includes("master")) return "intensity";
  if (value.includes("gobo")) return "gobo";
  if (value.includes("pan")) return "pan";
  if (value.includes("tilt")) return "tilt";
  if (value.includes("prism")) return "prism";
  if (value.includes("focus")) return "focus";
  if (value.includes("beam") || value.includes("zoom") || value.includes("iris")) return "beam";
  if (value.includes("speed")) return "speed";
  if (value.includes("effect") || value.includes("fx") || value.includes("macro")) return "effect";
  if (value.includes("ct") || value.includes("cct") || value.includes("kelvin") || value.includes("temp")) {
    return "colorTemp";
  }
  if (value.includes("color") || value.includes("colour")) return "color";
  return null;
};
