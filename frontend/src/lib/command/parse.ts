// Analyseur de la ligne de commande, syntaxe grandMA3 (§4.12 du cahier des charges).
//
// Ce module ne fait QUE transformer le texte en intention typée (Command) ; il
// ne touche à aucun store (execute.ts s'en charge). Il est pur et testable sous Node.
//
// Conventions :
//  - insensible à la casse et aux accents (« Projecteur 1 À 50 » = « fixture 1 at 50 ») ;
//  - raccourcis FR acceptés (projecteur, groupe, rouge, vert, bleu, blanc, vue, aide…) ;
//  - valeurs en POURCENT par défaut, suffixe d/dmx = brut 0-255, Full = 255,
//    Out/Zero = 0, Half = 128 ;
//  - « Please » final ignoré (c'est la touche Entrée du pupitre) ;
//  - « 1 Thru 3 » seul = Fixture par défaut ; « Fixture Thru » = tout ;
//  - Preset pool.slot (« Preset 4.1 » = pool 4 Color, slot 1) ; « Preset 1 » = pool All.
import type { AttrKey } from "../attributes";
import type { PresetPool } from "../../state/playback";

export type AttrSet = { attr: AttrKey; value: number; fanTo?: number };

export type Command =
  | { kind: "select"; fids: number[]; openEnd?: boolean; then?: AttrSet }
  | { kind: "selectAll"; then?: AttrSet }
  | { kind: "attr"; attr: AttrKey; value: number; fanTo?: number }
  | { kind: "channel"; channels: number[]; value: number }
  | { kind: "clear" }
  | { kind: "clearAll" }
  | { kind: "group"; slot: number }
  | { kind: "storeGroup"; slot: number; name?: string }
  | { kind: "deleteGroup"; slot: number }
  | { kind: "labelGroup"; slot: number; name: string }
  | { kind: "preset"; pool: PresetPool; slot: number }
  | { kind: "storePreset"; pool: PresetPool; slot: number; name?: string }
  | { kind: "deletePreset"; pool: PresetPool; slot: number }
  | { kind: "storeExecutor"; slot: number; name?: string }
  | { kind: "go"; slot: number }
  | { kind: "off"; slot: number }
  | { kind: "deleteExecutor"; slot: number }
  | { kind: "labelExecutor"; slot: number; name: string }
  | { kind: "executorLevel"; slot: number; level: number }
  | { kind: "phaserOff" }
  | { kind: "blackout"; on: boolean }
  | { kind: "view"; index: number }
  | { kind: "storeView"; index: number; name?: string }
  | { kind: "highlight" }
  | { kind: "help" }
  | { kind: "error"; message: string };

export type CommandKind = Command["kind"];

// ─── Jetons ─────────────────────────────────────────────────────────────────

type Token = { raw: string; norm: string; quoted: boolean };

/** Minuscules, sans accents : « À » → « a », « Préset » → « preset ». */
export const normalize = (word: string): string =>
  word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const TOKEN_RE = /"([^"]*)"|'([^']*)'|([+\-@,])|([^\s+\-@,"']+)/g;

/** Découpe la ligne : chaînes entre guillemets, opérateurs isolés (+ - @ ,), mots. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // « Go+ » est un mot-clé à part entière : on le protège avant de séparer les « + ».
  const prepared = text.replace(/\bgo\+/gi, "goplus");
  for (const match of prepared.matchAll(TOKEN_RE)) {
    if (match[1] !== undefined || match[2] !== undefined) {
      const raw = match[1] ?? match[2] ?? "";
      tokens.push({ raw, norm: normalize(raw), quoted: true });
    } else {
      const raw = match[3] ?? match[4] ?? "";
      if (raw) tokens.push({ raw, norm: normalize(raw), quoted: false });
    }
  }
  // « Please » final = Entrée : ignoré.
  while (tokens.length && !tokens[tokens.length - 1].quoted && PLEASE.has(tokens[tokens.length - 1].norm)) tokens.pop();
  return tokens;
}

const PLEASE = new Set(["please", "pls", "enter"]);
const FIXTURE = new Set(["fixture", "fixtures", "fix", "f", "projecteur", "projecteurs", "proj"]);
const THRU = new Set(["thru", "through", "jusqua", "jusque"]);
const AT = new Set(["at", "@", "a"]);
const ATTRIBUTE = new Set(["attribute", "attr", "attribut"]);
const DMX = new Set(["dmx", "channel", "channels", "chan", "ch", "canal", "canaux"]);
const GROUP = new Set(["group", "groups", "grp", "groupe", "groupes"]);
const PRESET = new Set(["preset", "presets", "pre"]);
const SEQUENCE = new Set(["sequence", "sequences", "seq", "sequ", "executor", "executors", "exec", "cue", "scene"]);
const STORE = new Set(["store", "st", "memoriser", "enregistrer"]);
const DELETE = new Set(["delete", "del", "supprimer"]);
const LABEL = new Set(["label", "renommer", "rename", "nommer"]);
const GO = new Set(["go", "goplus"]);
const OFF = new Set(["off"]);
const PHASER = new Set(["phaser", "phasers", "effet", "effets"]);
const BLACKOUT = new Set(["blackout", "bo"]);
const VIEW = new Set(["view", "vue"]);
const HIGHLIGHT = new Set(["highlight", "high", "hl"]);
const HELP = new Set(["help", "aide", "?"]);
const CLEAR = new Set(["clear", "cl"]);
const CLEAR_ALL = new Set(["clearall"]);
const ALL = new Set(["all", "tout", "tous"]);
const FULL = new Set(["full", "plein"]);
const OUT = new Set(["out", "zero"]);
const HALF = new Set(["half", "moitie"]);
const STOP = new Set(["off", "stop", "arret"]);
const ON = new Set(["on"]);

/** Mots d'attribut (EN + FR + abréviations) → clé interne. */
export const ATTR_WORDS: Record<string, AttrKey> = {
  dimmer: "dimmer",
  dim: "dimmer",
  intensity: "dimmer",
  intensite: "dimmer",
  int: "dimmer",
  pan: "pan",
  tilt: "tilt",
  gobo: "gobo",
  gobo1: "gobo",
  red: "red",
  rouge: "red",
  r: "red",
  green: "green",
  vert: "green",
  g: "green",
  blue: "blue",
  bleu: "blue",
  b: "blue",
  white: "white",
  blanc: "white",
  w: "white",
  uv: "uv",
  ctemp: "ctemp",
  cto: "ctemp",
  colortemp: "ctemp",
  temperature: "ctemp",
  color: "colorWheel",
  colour: "colorWheel",
  couleur: "colorWheel",
  color1: "colorWheel",
  colorwheel: "colorWheel",
  roue: "colorWheel",
  shutter: "shutter",
  shutter1: "shutter",
  strobe: "shutter",
  prism: "prism",
  prism1: "prism",
  prisme: "prism",
  focus: "focus",
  speed: "speed",
  vitesse: "speed",
  effect: "effect",
  control: "control",
  ctrl: "control"
};

// Pools de presets par nom (« Preset Color 2 ») et par numéro de groupe (« Preset 4.1 »).
const POOL_WORDS: Record<string, PresetPool> = {
  all: "all",
  dimmer: "dimmer",
  position: "position",
  gobo: "gobo",
  color: "color",
  couleur: "color",
  beam: "beam",
  focus: "focus",
  control: "control",
  shapers: "shapers"
};
const POOL_BY_INDEX: PresetPool[] = ["all", "dimmer", "position", "gobo", "color", "beam", "focus", "control", "shapers"];

const error = (message: string): Command => ({ kind: "error", message });
const isInt = (t: Token | undefined): boolean => t !== undefined && !t.quoted && /^\d+$/.test(t.norm);
const intOf = (t: Token): number => Number(t.norm);

/** Lit une valeur : % par défaut, d/dmx = brut, Full/Out/Zero/Half. Renvoie DMX 0-255 ou null. */
export function parseValue(token: string): number | null {
  const t = normalize(token).replace("%", "");
  if (FULL.has(t)) return 255;
  if (OUT.has(t)) return 0;
  if (HALF.has(t)) return 128;
  const raw = /^(\d+(?:\.\d+)?)(d|dmx)$/.exec(t);
  if (raw) return Math.max(0, Math.min(255, Math.round(Number(raw[1]))));
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
  const pct = Math.max(0, Math.min(100, Number(t)));
  return Math.round((pct / 100) * 255);
}

// Liste de numéros : « 1 Thru 3 + 5 - 2 », « Thru 4 » (= 1 Thru 4), « 3 Thru » (ouvert).
type NumberList = { items: number[]; openEnd: boolean; next: number; error?: string };

function parseList(tokens: Token[], start: number): NumberList {
  const items: number[] = [];
  let openEnd = false;
  let sign: 1 | -1 = 1;
  let i = start;

  const push = (n: number) => {
    if (sign === 1) {
      if (!items.includes(n)) items.push(n);
    } else {
      const idx = items.indexOf(n);
      if (idx >= 0) items.splice(idx, 1);
    }
  };
  const pushRange = (from: number, to: number) => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (hi - lo > 2048) return;
    if (from <= to) for (let n = lo; n <= hi; n += 1) push(n);
    else for (let n = hi; n >= lo; n -= 1) push(n);
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (t.quoted) break;
    if (isInt(t)) {
      const n = intOf(t);
      const nextTok = tokens[i + 1];
      if (nextTok && !nextTok.quoted && THRU.has(nextTok.norm)) {
        const endTok = tokens[i + 2];
        if (isInt(endTok)) {
          pushRange(n, intOf(endTok));
          i += 3;
        } else {
          // « 3 Thru » : du 3 jusqu'au dernier projecteur (résolu à l'exécution).
          push(n);
          if (sign === 1) openEnd = true;
          i += 2;
        }
        continue;
      }
      push(n);
      i += 1;
      continue;
    }
    if (t.norm === "+") {
      sign = 1;
      i += 1;
      continue;
    }
    if (t.norm === "-") {
      sign = -1;
      i += 1;
      continue;
    }
    if (THRU.has(t.norm) && items.length === 0 && i === start) {
      // « Thru 4 » = 1 Thru 4.
      const endTok = tokens[i + 1];
      if (!isInt(endTok)) return { items, openEnd, next: i, error: "Thru : numéro de fin attendu" };
      pushRange(1, intOf(endTok));
      i += 2;
      continue;
    }
    break;
  }
  return { items, openEnd, next: i };
}

// « [At] valeur [Thru valeur2] », rien d'autre après. Renvoie la valeur (et le fan) ou une erreur.
function parseAtValue(tokens: Token[], start: number, what: string): { value: number; fanTo?: number; next: number } | Command {
  let i = start;
  if (tokens[i] && !tokens[i].quoted && AT.has(tokens[i].norm)) i += 1;
  const valueTok = tokens[i];
  if (!valueTok) return error(`Valeur attendue après ${what} (ex. ${what} At 50)`);
  const value = parseValue(valueTok.raw);
  if (value === null) return error(`Valeur illisible : « ${valueTok.raw} » (ex. 50, 100 %, 200d, Full, Out)`);
  i += 1;
  let fanTo: number | undefined;
  if (tokens[i] && !tokens[i].quoted && THRU.has(tokens[i].norm)) {
    const toTok = tokens[i + 1];
    const to = toTok ? parseValue(toTok.raw) : null;
    if (to === null) return error("Thru : seconde valeur attendue (ex. At 50 Thru 100)");
    fanTo = to;
    i += 2;
  }
  if (i < tokens.length) return error(`Jeton inattendu : « ${tokens[i].raw} »`);
  return { value, fanTo, next: i };
}

const isCommand = (x: unknown): x is Command => typeof x === "object" && x !== null && "kind" in x;

// Suite optionnelle d'une sélection : « At 50 », « Red 100 », « Pan At 50 ».
function parseThen(tokens: Token[], start: number): AttrSet | undefined | Command {
  if (start >= tokens.length) return undefined;
  const t = tokens[start];
  if (!t.quoted && AT.has(t.norm)) {
    const parsed = parseAtValue(tokens, start, "At");
    if (isCommand(parsed)) return parsed;
    return { attr: "dimmer", value: parsed.value, fanTo: parsed.fanTo };
  }
  if (!t.quoted && (FULL.has(t.norm) || OUT.has(t.norm) || HALF.has(t.norm))) {
    if (start + 1 < tokens.length) return error(`Jeton inattendu : « ${tokens[start + 1].raw} »`);
    return { attr: "dimmer", value: parseValue(t.raw) ?? 0 };
  }
  const attr = t.quoted ? undefined : ATTR_WORDS[t.norm];
  if (attr) {
    const parsed = parseAtValue(tokens, start + 1, t.raw);
    if (isCommand(parsed)) return parsed;
    return { attr, value: parsed.value, fanTo: parsed.fanTo };
  }
  return error(`Mot-clé inattendu : « ${t.raw} »`);
}

// Nom libre : tout ce qui reste, guillemets retirés.
const nameFrom = (tokens: Token[], start: number): string | undefined => {
  const name = tokens
    .slice(start)
    .map((t) => t.raw)
    .join(" ")
    .trim();
  return name || undefined;
};

// Référence de preset : « 4.1 », « 1 » (pool All), « Color 2 ».
function parsePresetRef(tokens: Token[], start: number): { pool: PresetPool; slot: number; next: number } | Command {
  const t = tokens[start];
  if (!t) return error("Preset : référence attendue (ex. Preset 4.1, Preset 1)");
  if (!t.quoted && POOL_WORDS[t.norm] && isInt(tokens[start + 1])) {
    return { pool: POOL_WORDS[t.norm], slot: intOf(tokens[start + 1]), next: start + 2 };
  }
  const dotted = /^(\d+)\.(\d+)$/.exec(t.norm);
  if (dotted) {
    const poolIdx = Number(dotted[1]);
    const pool = POOL_BY_INDEX[poolIdx];
    if (!pool) return error(`Preset : pool ${poolIdx} inconnu (1 Dimmer … 8 Shapers)`);
    const slot = Number(dotted[2]);
    if (slot < 1) return error("Preset : slot attendu ≥ 1");
    return { pool, slot, next: start + 1 };
  }
  if (isInt(t)) {
    const slot = intOf(t);
    if (slot < 1) return error("Preset : slot attendu ≥ 1");
    return { pool: "all", slot, next: start + 1 };
  }
  return error(`Preset : référence illisible « ${t.raw} » (ex. Preset 4.1)`);
}

// Numéro de slot suivi éventuellement d'un nom.
function parseSlot(tokens: Token[], start: number, what: string): { slot: number; next: number } | Command {
  const t = tokens[start];
  if (!isInt(t)) return error(`${what} : numéro attendu (ex. ${what} 1)`);
  const slot = intOf(t);
  if (slot < 1) return error(`${what} : numéro attendu ≥ 1`);
  return { slot, next: start + 1 };
}

const noTrailing = (tokens: Token[], start: number): Command | null =>
  start < tokens.length ? error(`Jeton inattendu : « ${tokens[start].raw} »`) : null;

// ─── Store / Delete / Label ─────────────────────────────────────────────────

function parseStore(tokens: Token[], start: number): Command {
  const t = tokens[start];
  if (!t) return error("Store : cible attendue (Store 1, Store Group 2, Store Preset 4.1, Store View 3)");
  if (!t.quoted && GROUP.has(t.norm)) {
    const slot = parseSlot(tokens, start + 1, "Store Group");
    if (isCommand(slot)) return slot;
    return { kind: "storeGroup", slot: slot.slot, name: nameFrom(tokens, slot.next) };
  }
  if (!t.quoted && PRESET.has(t.norm)) {
    const ref = parsePresetRef(tokens, start + 1);
    if (isCommand(ref)) return ref;
    return { kind: "storePreset", pool: ref.pool, slot: ref.slot, name: nameFrom(tokens, ref.next) };
  }
  if (!t.quoted && VIEW.has(t.norm)) {
    const slot = parseSlot(tokens, start + 1, "Store View");
    if (isCommand(slot)) return slot;
    return { kind: "storeView", index: slot.slot - 1, name: nameFrom(tokens, slot.next) };
  }
  const offset = !t.quoted && SEQUENCE.has(t.norm) ? start + 1 : start;
  const slot = parseSlot(tokens, offset, "Store");
  if (isCommand(slot)) return slot;
  return { kind: "storeExecutor", slot: slot.slot, name: nameFrom(tokens, slot.next) };
}

function parseDelete(tokens: Token[], start: number): Command {
  const t = tokens[start];
  if (!t) return error("Delete : cible attendue (Delete Group 2, Delete Preset 4.1, Delete Sequence 1)");
  if (!t.quoted && GROUP.has(t.norm)) {
    const slot = parseSlot(tokens, start + 1, "Delete Group");
    if (isCommand(slot)) return slot;
    return noTrailing(tokens, slot.next) ?? { kind: "deleteGroup", slot: slot.slot };
  }
  if (!t.quoted && PRESET.has(t.norm)) {
    const ref = parsePresetRef(tokens, start + 1);
    if (isCommand(ref)) return ref;
    return noTrailing(tokens, ref.next) ?? { kind: "deletePreset", pool: ref.pool, slot: ref.slot };
  }
  const offset = !t.quoted && SEQUENCE.has(t.norm) ? start + 1 : start;
  const slot = parseSlot(tokens, offset, "Delete");
  if (isCommand(slot)) return slot;
  return noTrailing(tokens, slot.next) ?? { kind: "deleteExecutor", slot: slot.slot };
}

function parseLabel(tokens: Token[], start: number): Command {
  const t = tokens[start];
  if (!t) return error("Label : cible attendue (Label Group 2 \"Nom\", Label Sequence 1 \"Nom\")");
  if (!t.quoted && GROUP.has(t.norm)) {
    const slot = parseSlot(tokens, start + 1, "Label Group");
    if (isCommand(slot)) return slot;
    const name = nameFrom(tokens, slot.next);
    if (!name) return error("Label : nom attendu (ex. Label Group 2 \"Salon\")");
    return { kind: "labelGroup", slot: slot.slot, name };
  }
  const offset = !t.quoted && SEQUENCE.has(t.norm) ? start + 1 : start;
  const slot = parseSlot(tokens, offset, "Label");
  if (isCommand(slot)) return slot;
  const name = nameFrom(tokens, slot.next);
  if (!name) return error("Label : nom attendu (ex. Label Sequence 1 \"Look\")");
  return { kind: "labelExecutor", slot: slot.slot, name };
}

// ─── Entrée principale ──────────────────────────────────────────────────────

/**
 * Transforme une ligne saisie en commande typée. Toute entrée non reconnue
 * renvoie { kind: "error", message } : on ne lève jamais d'exception ici.
 */
export function parseCommand(text: string): Command {
  const tokens = tokenize(text);
  if (!tokens.length) return error("Commande vide");
  const head = tokens[0];
  const h = head.quoted ? "" : head.norm;
  const second = tokens[1];
  const s = second && !second.quoted ? second.norm : "";

  if (HELP.has(h)) return { kind: "help" };
  if (CLEAR_ALL.has(h) || (CLEAR.has(h) && ALL.has(s))) return { kind: "clearAll" };
  if (CLEAR.has(h)) return noTrailing(tokens, 1) ?? { kind: "clear" };
  if (HIGHLIGHT.has(h)) return { kind: "highlight" };
  if (BLACKOUT.has(h)) {
    if (!second) return { kind: "blackout", on: true };
    if (STOP.has(s)) return { kind: "blackout", on: false };
    if (ON.has(s)) return { kind: "blackout", on: true };
    return error(`Blackout : « ${second.raw} » inattendu (Blackout, Blackout Off)`);
  }
  if (PHASER.has(h)) {
    if (!second || STOP.has(s)) return { kind: "phaserOff" };
    return error("Phaser : seul « Phaser Off » est disponible en ligne de commande");
  }
  if (VIEW.has(h)) {
    const slot = parseSlot(tokens, 1, "View");
    if (isCommand(slot)) return slot;
    return noTrailing(tokens, slot.next) ?? { kind: "view", index: slot.slot - 1 };
  }
  if (STORE.has(h)) return parseStore(tokens, 1);
  if (DELETE.has(h)) return parseDelete(tokens, 1);
  if (LABEL.has(h)) return parseLabel(tokens, 1);
  if (GO.has(h)) {
    const offset = SEQUENCE.has(s) ? 2 : 1;
    const slot = parseSlot(tokens, offset, "Go");
    if (isCommand(slot)) return slot;
    return noTrailing(tokens, slot.next) ?? { kind: "go", slot: slot.slot };
  }
  if (OFF.has(h)) {
    if (!second) return { kind: "attr", attr: "dimmer", value: 0 };
    if (PHASER.has(s)) return { kind: "phaserOff" };
    const offset = SEQUENCE.has(s) ? 2 : 1;
    const slot = parseSlot(tokens, offset, "Off");
    if (isCommand(slot)) return slot;
    return noTrailing(tokens, slot.next) ?? { kind: "off", slot: slot.slot };
  }
  if (GROUP.has(h)) {
    const slot = parseSlot(tokens, 1, "Group");
    if (isCommand(slot)) return slot;
    return noTrailing(tokens, slot.next) ?? { kind: "group", slot: slot.slot };
  }
  if (PRESET.has(h)) {
    const ref = parsePresetRef(tokens, 1);
    if (isCommand(ref)) return ref;
    return noTrailing(tokens, ref.next) ?? { kind: "preset", pool: ref.pool, slot: ref.slot };
  }
  if (SEQUENCE.has(h)) {
    const slot = parseSlot(tokens, 1, "Executor");
    if (isCommand(slot)) return slot;
    if (slot.next >= tokens.length) return { kind: "go", slot: slot.slot };
    const parsed = parseAtValue(tokens, slot.next, "Executor");
    if (isCommand(parsed)) return parsed;
    return { kind: "executorLevel", slot: slot.slot, level: parsed.value / 255 };
  }
  if (DMX.has(h)) {
    const list = parseList(tokens, 1);
    if (list.error) return error(list.error);
    if (!list.items.length) return error("Dmx : numéro de canal attendu (ex. Dmx 12 Thru 20 At 50)");
    const channels = list.items.filter((n) => n >= 1 && n <= 512);
    if (!channels.length) return error("Canal hors univers (1-512)");
    const parsed = parseAtValue(tokens, list.next, "Dmx");
    if (isCommand(parsed)) return parsed;
    if (parsed.fanTo !== undefined) return error("Dmx : le fan (Thru) n'est pas disponible sur les canaux");
    return { kind: "channel", channels, value: parsed.value };
  }
  if (FIXTURE.has(h)) {
    if (!second) return error("Fixture : numéro attendu (ex. Fixture 1 Thru 3, Fixture Thru)");
    // « Fixture Thru » = tout sélectionner (+ suite optionnelle).
    if (THRU.has(s) && !isInt(tokens[2])) {
      const then = parseThen(tokens, 2);
      if (isCommand(then)) return then;
      return then ? { kind: "selectAll", then } : { kind: "selectAll" };
    }
    const list = parseList(tokens, 1);
    if (list.error) return error(list.error);
    if (!list.items.length) return error(`Fixture : numéro attendu, pas « ${second.raw} »`);
    const then = parseThen(tokens, list.next);
    if (isCommand(then)) return then;
    const cmd: Command = { kind: "select", fids: list.items };
    if (list.openEnd) cmd.openEnd = true;
    if (then) cmd.then = then;
    return cmd;
  }
  if (ATTRIBUTE.has(h)) {
    if (!second) return error("Attribute : nom attendu (ex. Attribute \"Pan\" At 50)");
    const attr = ATTR_WORDS[second.norm];
    if (!attr) return error(`Attribut inconnu : « ${second.raw} »`);
    const parsed = parseAtValue(tokens, 2, second.raw);
    if (isCommand(parsed)) return parsed;
    return { kind: "attr", attr, value: parsed.value, fanTo: parsed.fanTo };
  }
  if (AT.has(h)) {
    const parsed = parseAtValue(tokens, 0, "At");
    if (isCommand(parsed)) return parsed;
    return { kind: "attr", attr: "dimmer", value: parsed.value, fanTo: parsed.fanTo };
  }
  if (FULL.has(h) || OUT.has(h) || HALF.has(h)) {
    return noTrailing(tokens, 1) ?? { kind: "attr", attr: "dimmer", value: parseValue(head.raw) ?? 0 };
  }
  const attr = ATTR_WORDS[h];
  if (attr) {
    const parsed = parseAtValue(tokens, 1, head.raw);
    if (isCommand(parsed)) return parsed;
    return { kind: "attr", attr, value: parsed.value, fanTo: parsed.fanTo };
  }
  if (isInt(head) || THRU.has(h)) {
    // « 1 Thru 3 » seul : le mot-clé par défaut est Fixture.
    const list = parseList(tokens, 0);
    if (list.error) return error(list.error);
    if (!list.items.length) return error("Numéro de projecteur attendu");
    const then = parseThen(tokens, list.next);
    if (isCommand(then)) return then;
    const cmd: Command = { kind: "select", fids: list.items };
    if (list.openEnd) cmd.openEnd = true;
    if (then) cmd.then = then;
    return cmd;
  }
  return error(`Commande inconnue : « ${head.raw} » (Help pour la liste)`);
}
