// Vocabulaire de la fenêtre Effets : les libellés français des notions du pupitre,
// et les quelques conversions dont l'éditeur a besoin.
//
// Les identifiants du schéma restent en anglais (ce sont des clés Zod) ; c'est ici
// qu'on les traduit une fois pour toutes, au lieu d'écrire « Rampe ↑ » dans trois
// composants différents.
import {
  DmxEffect,
  DmxEffectPreset,
  EffectAttribute,
  EffectForm,
  EffectLine,
  RgbColor
} from "@lightbridgedmx/shared";

export const GROUP_LABELS: Record<DmxEffectPreset["group"], string> = {
  pupitre: "Pupitre",
  "3d": "Espace",
  meuble: "Meuble TV"
};

export const ATTRIBUTE_LABELS: Record<EffectAttribute, string> = {
  dimmer: "Dimmer",
  red: "Rouge",
  green: "Vert",
  blue: "Bleu",
  pan: "Pan",
  tilt: "Tilt",
  color: "Couleur",
  hue: "Teinte"
};

/** Libellé court, pour les endroits où la place manque (tuiles, liste des effets
 *  en cours). Repris de l'abréviation d'encodeur du pupitre : « Dim », « Pan ». */
export const ATTRIBUTE_SHORT: Record<EffectAttribute, string> = {
  dimmer: "Dim",
  red: "R",
  green: "V",
  blue: "B",
  pan: "Pan",
  tilt: "Tilt",
  color: "Col",
  hue: "Hue"
};

/** Groupe d'attributs, au sens des touches de groupe du pupitre. Sert au code
 *  couleur des lignes : une ligne de position ne se lit pas comme une intensité. */
export const ATTRIBUTE_GROUP: Record<EffectAttribute, "dimmer" | "color" | "position"> = {
  dimmer: "dimmer",
  red: "color",
  green: "color",
  blue: "color",
  color: "color",
  hue: "color",
  pan: "position",
  tilt: "position"
};

export const FORM_LABELS: Record<EffectForm, string> = {
  sin: "Sinus",
  cos: "Cosinus",
  rampUp: "Rampe ↑",
  rampDown: "Rampe ↓",
  triangle: "Triangle",
  pwm: "Créneau",
  random: "Aléatoire"
};

/** Formes à fronts durs : les seules où Width / Attack / Decay / Seed changent
 *  quelque chose. Sur un sinus, ces champs seraient des boutons morts — l'éditeur
 *  les grise plutôt que de laisser croire qu'ils agissent. */
export const isHardEdged = (form: EffectForm): boolean => form === "pwm" || form === "random";

/** Ligne neutre proposée par « + Ligne » : un dimmer sinus à l'unisson. On part
 *  de l'unisson (phase 0 → 0) et non d'un cycle réparti, parce qu'une deuxième
 *  ligne sert le plus souvent à croiser un attribut, pas à refaire un chenillard. */
export const NEW_LINE: EffectLine = {
  attribute: "dimmer",
  form: "sin",
  mode: "absolute",
  low: 0,
  high: 100,
  phaseFrom: 0,
  phaseTo: 0,
  width: 50,
  attack: 0,
  decay: 0,
  seed: 1
};

/** Résumé d'un effet en une ligne : « Dim + Pan · 60 BPM ». */
export const describeEffect = (effect: DmxEffect): string => {
  const attrs = effect.lines.map((l) => ATTRIBUTE_SHORT[l.attribute]).join(" + ");
  return `${attrs} · ${Math.round(effect.speed * effect.rate)} BPM`;
};

/** Cycles par seconde réellement joués : BPM et Rate se composent (Rate 1 = 60 BPM).
 *  Affiché à côté des deux champs, faute de quoi personne ne sait ce que
 *  « 90 BPM × 0,5 » donne à l'œil. */
export const cyclesPerSecond = (effect: DmxEffect): number => (effect.speed / 60) * effect.rate;

/** RgbColor -> #rrggbb, pour <input type="color">. */
export const toHex = (color: RgbColor | undefined, fallback: string): string => {
  if (!color) return fallback;
  const hex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
};

/** #rrggbb -> RgbColor. */
export const fromHex = (hex: string): RgbColor => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16)
});

/** Depuis combien de temps un effet tourne, en « 1 min 20 s ». */
export const elapsedSince = (iso: string, now: number): string => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};
