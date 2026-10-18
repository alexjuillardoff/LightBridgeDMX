// Vocabulaire MA3 : groupes de fonctions (1 Dimmer … 8 Shapers), attributs
// (Dim, Pan, Tilt, Gobo1, R, G, B…) et leur traduction en capabilities du patch.
//
// C'est la brique commune de la fixture sheet, de l'encoder bar, du color picker
// et de la ligne de commande : toutes parlent d'ATTRIBUTS, jamais de numéros de
// canaux ; la traduction attribut → canaux absolus se fait ici, une seule fois.
import type { Capability, Fixture } from "@lightbridgedmx/shared";
import { DIMMABLE_CAPABILITIES, channelsFor } from "./patch";

export type FeatureGroupId = "dimmer" | "position" | "gobo" | "color" | "beam" | "focus" | "control" | "shapers";

/** Les 8 groupes de fonctions de l'encoder bar, dans l'ordre des touches. */
export const FEATURE_GROUPS: { id: FeatureGroupId; index: number; label: string }[] = [
  { id: "dimmer", index: 1, label: "Dimmer" },
  { id: "position", index: 2, label: "Position" },
  { id: "gobo", index: 3, label: "Gobo" },
  { id: "color", index: 4, label: "Color" },
  { id: "beam", index: 5, label: "Beam" },
  { id: "focus", index: 6, label: "Focus" },
  { id: "control", index: 7, label: "Control" },
  { id: "shapers", index: 8, label: "Shapers" }
];

/** Groupe par son numéro de touche (1-8), ou undefined. */
export const featureGroupByIndex = (index: number): FeatureGroupId | undefined =>
  FEATURE_GROUPS.find((g) => g.index === index)?.id;

export type AttrKey =
  | "dimmer"
  | "pan"
  | "tilt"
  | "gobo"
  | "red"
  | "green"
  | "blue"
  | "white"
  | "uv"
  | "ctemp"
  | "colorWheel"
  | "shutter"
  | "prism"
  | "focus"
  | "speed"
  | "effect"
  | "control";

export type AttrInfo = {
  /** Libellé MA3 (en-tête de colonne, boîte d'encodeur). */
  label: string;
  /** Variante compacte (tuiles, DMX sheet). */
  short: string;
  group: FeatureGroupId;
  capability: Capability;
  /** Atténué par un master (GM, fader d'executor). */
  dimmable: boolean;
};

/** Ordre = ordre des colonnes de la fixture sheet et des encodeurs dans chaque groupe. */
export const ATTRIBUTES: Record<AttrKey, AttrInfo> = {
  dimmer: { label: "Dim", short: "Dim", group: "dimmer", capability: "intensity", dimmable: true },
  pan: { label: "Pan", short: "Pan", group: "position", capability: "pan", dimmable: false },
  tilt: { label: "Tilt", short: "Tilt", group: "position", capability: "tilt", dimmable: false },
  gobo: { label: "Gobo1", short: "Gobo", group: "gobo", capability: "gobo", dimmable: false },
  red: { label: "R", short: "R", group: "color", capability: "r", dimmable: true },
  green: { label: "G", short: "G", group: "color", capability: "g", dimmable: true },
  blue: { label: "B", short: "B", group: "color", capability: "b", dimmable: true },
  white: { label: "W", short: "W", group: "color", capability: "w", dimmable: true },
  uv: { label: "UV", short: "UV", group: "color", capability: "uv", dimmable: true },
  ctemp: { label: "CTO", short: "CTO", group: "color", capability: "colorTemp", dimmable: false },
  colorWheel: { label: "Color1", short: "Col1", group: "color", capability: "color", dimmable: false },
  shutter: { label: "Shutter", short: "Shut", group: "beam", capability: "strobe", dimmable: false },
  prism: { label: "Prism1", short: "Prism", group: "beam", capability: "prism", dimmable: false },
  focus: { label: "Focus", short: "Focus", group: "focus", capability: "focus", dimmable: false },
  speed: { label: "Speed", short: "Speed", group: "control", capability: "speed", dimmable: false },
  effect: { label: "Effect", short: "Effect", group: "control", capability: "effect", dimmable: false },
  control: { label: "Control", short: "Ctrl", group: "control", capability: "maintenance", dimmable: false }
};

/** Noms longs MA3, pour les infobulles. */
export const ATTR_LONG_NAMES: Record<AttrKey, string> = {
  dimmer: "Dimmer",
  pan: "Pan",
  tilt: "Tilt",
  gobo: "Gobo1",
  red: "ColorRGB_R",
  green: "ColorRGB_G",
  blue: "ColorRGB_B",
  white: "ColorRGB_W",
  uv: "ColorRGB_UV",
  ctemp: "CTO",
  colorWheel: "Color1",
  shutter: "Shutter1",
  prism: "Prism1",
  focus: "Focus",
  speed: "Speed",
  effect: "Effect",
  control: "Control"
};

/** Tous les attributs dans l'ordre canonique (colonnes de la fixture sheet). */
export const ATTR_ORDER: AttrKey[] = Object.keys(ATTRIBUTES) as AttrKey[];

/** Capabilities atténuables par un master : intensity r g b w uv. */
export const DIMMABLE: Set<Capability> = new Set(DIMMABLE_CAPABILITIES);

// Capability → attribut, pour retrouver le groupe d'un canal du patch (presets par pool, sheets).
const ATTR_BY_CAPABILITY: Partial<Record<Capability, AttrKey>> = {};
for (const key of ATTR_ORDER) ATTR_BY_CAPABILITY[ATTRIBUTES[key].capability] = key;

/** Attribut porté par une capability, ou null (beam, other…). */
export const attrForCapability = (capability: Capability): AttrKey | null => ATTR_BY_CAPABILITY[capability] ?? null;

/** Attributs d'un groupe de fonctions, dans l'ordre canonique (4 par page d'encodeurs). */
export function attrsOfGroup(group: FeatureGroupId): AttrKey[] {
  return ATTR_ORDER.filter((key) => ATTRIBUTES[key].group === group);
}

/** Canaux absolus d'un attribut ; "dimmer" sans canal intensity retombe sur r+g+b (PAR RGB). */
export function channelsForAttr(f: Fixture, attr: AttrKey): number[] {
  const direct = channelsFor(f, ATTRIBUTES[attr].capability);
  if (direct.length || attr !== "dimmer") return direct;
  return [...channelsFor(f, "r"), ...channelsFor(f, "g"), ...channelsFor(f, "b")];
}

/** Vrai si le projecteur expose cet attribut (canal dédié, ou repli dimmer → RGB). */
export function hasAttr(f: Fixture, attr: AttrKey): boolean {
  return channelsForAttr(f, attr).length > 0;
}

/** Groupes de fonctions disponibles sur au moins un des projecteurs (points de l'encoder bar). */
export function groupsAvailable(fixtures: Fixture[]): Set<FeatureGroupId> {
  const groups = new Set<FeatureGroupId>();
  for (const key of ATTR_ORDER) {
    const group = ATTRIBUTES[key].group;
    if (groups.has(group)) continue;
    if (fixtures.some((f) => hasAttr(f, key))) groups.add(group);
  }
  return groups;
}

/** Attributs présents sur au moins un des projecteurs, dans l'ordre canonique. */
export function attrsAvailable(fixtures: Fixture[]): AttrKey[] {
  return ATTR_ORDER.filter((key) => fixtures.some((f) => hasAttr(f, key)));
}

/** Valeur DMX d'un attribut pour un projecteur : max de ses canaux (HTP), ou null s'il ne l'a pas. */
export function readAttr(f: Fixture, attr: AttrKey, values: number[]): number | null {
  const channels = channelsForAttr(f, attr);
  if (!channels.length) return null;
  return channels.reduce((max, ch) => Math.max(max, values[ch - 1] ?? 0), 0);
}

export type Readout = "natural" | "percent" | "decimal8";

/** Cycle du bouton Readout : natural → percent → decimal8 → natural. */
export const nextReadout = (r: Readout): Readout =>
  r === "natural" ? "percent" : r === "percent" ? "decimal8" : "natural";

export const READOUT_LABELS: Record<Readout, string> = { natural: "Natural", percent: "Percent", decimal8: "Dec8" };

// Conversions DMX (0-255) ↔ pourcentage (0-100).
export const toPct = (value: number): number => Math.round((value / 255) * 100);
export const fromPct = (pct: number): number => Math.round((Math.max(0, Math.min(100, pct)) / 100) * 255);

// Attributs continus affichés en % en readout naturel ; les roues restent en brut.
const PERCENT_ATTRS = new Set<AttrKey>(["dimmer", "red", "green", "blue", "white", "uv", "ctemp", "focus"]);

/**
 * Formate une valeur DMX selon le readout.
 * natural : % pour dimmer/couleurs/CTO/focus, ° pour pan (-270..270) et tilt (-135..135), brut pour les roues.
 */
export function formatValue(value: number, attr: AttrKey, readout: Readout): string {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  if (readout === "decimal8") return String(v);
  if (readout === "percent") return `${toPct(v)}%`;
  if (attr === "pan") return `${Math.round((v / 255) * 540 - 270)}°`;
  if (attr === "tilt") return `${Math.round((v / 255) * 270 - 135)}°`;
  if (PERCENT_ATTRS.has(attr)) return `${toPct(v)}%`;
  return String(v);
}

/** Lecture inverse pour un encodeur : texte saisi (readout naturel) → DMX. null si illisible. */
export function parseNaturalValue(text: string, attr: AttrKey): number | null {
  const t = text.trim().replace(/[%°]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (attr === "pan") return Math.max(0, Math.min(255, Math.round(((n + 270) / 540) * 255)));
  if (attr === "tilt") return Math.max(0, Math.min(255, Math.round(((n + 135) / 270) * 255)));
  if (PERCENT_ATTRS.has(attr)) return fromPct(n);
  return Math.max(0, Math.min(255, Math.round(n)));
}
