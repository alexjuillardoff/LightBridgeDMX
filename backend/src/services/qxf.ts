// Service QXF : lit un fichier de definition de projecteur (fixture) au format
// QLC+ (.qxf, du XML) et le convertit en projecteur exploitable par le backend.
// Roles : telecharger ou recevoir le QXF, parser le XML, deviner la capability
// de chaque canal (r, g, b, pan, tilt...), puis construire un FixtureInput pret
// a etre enregistre dans le store avec une adresse DMX et un univers DMX.

import { Capability, QxfMode, QxfParseResult, QxfParseResultSchema } from "@lightbridgedmx/shared";
import { XMLParser } from "fast-xml-parser";
import type { FixtureInput } from "../state/store";

// Parseur XML configure pour coller au format QXF : on garde les attributs,
// on ne les prefixe pas, et le texte d'une balise est lisible via la cle "text".
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  allowBooleanAttributes: true
});

// Types "Raw" : ils decrivent la forme brute du XML telle que la rend le parseur.
// Tout est optionnel car un QXF mal forme peut omettre n'importe quel champ.
// Channel/Mode peuvent etre un objet seul ou un tableau (un ou plusieurs elements).
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

// Source d'un QXF : soit le contenu XML directement (qxf), soit une URL a telecharger.
type QxfSource = { qxf?: string; url?: string };

// Erreur metier du service QXF. Porte un statusCode HTTP pour que la route
// puisse repondre avec le bon code (400 par defaut, ou celui renvoye par fetch).
export class QxfError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

// Recupere le contenu XML d'un QXF depuis la source fournie.
// Si le contenu est deja la, on le renvoie tel quel ; sinon on telecharge l'URL.
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

// Parse le XML d'un QXF et en extrait les modes et leurs canaux.
// Un QXF declare des canaux (avec leur role) puis des modes qui reutilisent ces
// canaux dans un ordre donne. On reconstruit chaque mode avec le bon numero de
// canal et la capability devinee, puis on valide le tout via le schema Zod.
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

  // Indexe les definitions de canaux par leur nom. Les modes ne citent que le
  // nom du canal ; on retrouve ici son groupe et son preset pour deviner le role.
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
        // Le canal d'un mode peut etre une simple chaine (le nom) ou un objet.
        // On recupere le nom selon la forme rencontree.
        const name =
          typeof modeChannel === "string"
            ? modeChannel
            : modeChannel.text ?? modeChannel.Name ?? `Channel ${channelIndex + 1}`;

        // L'attribut "Number" du QXF est l'offset 0-based dans le mode.
        // On le convertit en numero de canal 1-based (+1). Faute de "Number",
        // on retombe sur la position dans la liste.
        const orderRaw =
          typeof modeChannel === "object" && "Number" in modeChannel
            ? (modeChannel as RawModeChannel).Number
            : undefined;
        const order = orderRaw ? Number.parseInt(orderRaw, 10) : Number.NaN;
        const channelNumber = Number.isFinite(order) ? order + 1 : channelIndex + 1;
        // Un canal DMX valide tient dans l'univers DMX : entre 1 et 512.
        if (channelNumber < 1 || channelNumber > 512) {
          throw new QxfError(`Channel number out of DMX range in mode "${mode.Name ?? modeIndex + 1}"`);
        }

        // On retrouve la definition complete du canal pour deviner son role.
        const definition = name ? channelDefinitions.get(name) : undefined;
        const group = normalizeGroup(definition?.Group);
        const preset = definition?.Preset;
        const capability = resolveCapability({ preset, group, name });

        return { channel: channelNumber, capability, name, group, preset };
      })
      // On range les canaux par numero croissant pour un ordre stable et lisible.
      .sort((a, b) => a.channel - b.channel);

    return {
      name: mode.Name ?? `Mode ${modeIndex + 1}`,
      channels: resolved,
      channelCount: resolved.length
    };
  });

  // Derniere validation : le schema Zod garantit que le resultat est bien forme.
  return QxfParseResultSchema.parse({ manufacturer, model, modes });
};

// Choisit le mode a utiliser parmi ceux du QXF.
// Sans nom demande, on prend le premier mode. La comparaison ignore la casse.
export const selectQxfMode = (parsed: QxfParseResult, desired?: string): QxfMode => {
  if (!parsed.modes.length) {
    throw new QxfError("No modes found in QXF");
  }
  if (!desired) return parsed.modes[0];

  const mode = parsed.modes.find((m) => m.name.toLowerCase() === desired.toLowerCase());
  if (!mode) throw new QxfError(`Mode "${desired}" not found in QXF`);
  return mode;
};

// Construit un FixtureInput pret a etre enregistre dans le store a partir d'un
// QXF parse et d'options de placement (adresse DMX, univers DMX, mode, nom).
// Le nom par defaut reprend fabricant + modele + mode si aucun nom n'est fourni.
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

// Le parseur XML rend un seul element comme objet et plusieurs comme tableau.
// Ce helper uniformise toujours en tableau pour simplifier les boucles.
const toArray = <T>(value?: T | T[]): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

// Extrait le nom du groupe d'un canal, que le XML le donne en texte simple
// ou en objet (avec une cle "text" ou "Name"). Renvoie undefined si introuvable.
const normalizeGroup = (group: unknown): string | undefined => {
  if (!group) return undefined;
  if (typeof group === "string") return group;
  if (typeof group === "object" && group !== null) {
    const maybe = (group as Record<string, unknown>).text ?? (group as Record<string, unknown>).Name;
    if (typeof maybe === "string") return maybe;
  }
  return undefined;
};

// Devine le role (capability) d'un canal. Le QXF ne donne pas toujours une info
// fiable, donc on tente plusieurs sources par ordre de confiance decroissant :
// 1) le Preset (le plus precis), 2) le Group, 3) le Name (heuristique par mots-cles).
// Si rien ne correspond, on retombe sur "other".
const resolveCapability = (input: { preset?: string; group?: string; name?: string }): Capability => {
  const fromPreset = presetToCapability(input.preset);
  if (fromPreset) return fromPreset;

  const fromGroup = groupToCapability(input.group);
  if (fromGroup) return fromGroup;

  const fromName = nameToCapability(input.name);
  if (fromName) return fromName;

  return "other";
};

// Traduit le champ Preset du QXF en capability. C'est la source la plus fiable
// car elle decrit explicitement le role du canal (ex. "IntensityRed" -> "r").
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

// Traduit le Group du QXF en capability. Le Group est une categorie large
// (Colour, Gobo, Pan, Tilt...). NB : un Group "shutter" devient la capability
// "strobe" car c'est ce role que gere le shutter (obturateur) cote backend.
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

// Dernier recours : devine la capability a partir du nom du canal, par mots-cles.
// Heuristique la moins fiable, utilisee seulement si Preset et Group n'ont rien donne.
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
