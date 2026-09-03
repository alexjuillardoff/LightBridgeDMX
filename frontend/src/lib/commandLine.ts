// Analyseur (parser) de la ligne de commande facon pupitre.
//
// L'idee est celle d'un grandMA : on tape une phrase courte du genre
// "Fixture 1 thru 3 At 50", et le pupitre l'execute sur la selection.
// Ce fichier ne fait QUE transformer le texte en intention (objet typé) ;
// l'execution reelle (ecriture DMX, navigation) est faite par le composant
// CommandLine, qui a acces aux contextes React.
//
// Conventions retenues :
//  - les valeurs sont en POURCENT par defaut (comme sur un pupitre) ;
//  - un suffixe "d" ou "dmx" bascule en valeur brute 0-255 (ex. "pan 51d") ;
//  - les mots-cles existent en anglais (syntaxe MA) et en francais.
import { AttrKey } from "./programmer";

export type ParsedCommand =
  | { kind: "help" }
  | { kind: "clear" }
  | { kind: "blackout" }
  | { kind: "selectAll" }
  // Selection par numeros de projecteur (numerotation affichee dans la sheet).
  | { kind: "select"; numbers: number[]; then?: { attr: AttrKey; value: number } }
  // Reglage d'un attribut sur la selection courante.
  | { kind: "attr"; attr: AttrKey; value: number }
  // Ecriture directe sur une liste de canaux de l'univers (deja developpee :
  // "1 thru 4 + 9" arrive ici sous la forme [1, 2, 3, 4, 9]).
  | { kind: "channel"; channels: number[]; value: number }
  // Memorisation : "store 3", "store group 2 Salon", "store preset 1 Bleu".
  // `number` est le numero affiche (1-indexe), pas l'index interne.
  | { kind: "store"; target: "exec" | "group" | "preset"; number: number; name?: string }
  // Rappel d'un executor : "go 3".
  | { kind: "go"; number: number }
  // Extinction d'un executor : "off 3".
  | { kind: "off"; number: number }
  // Rappel d'un groupe de selection : "group 2".
  | { kind: "group"; number: number }
  // Application d'un preset : "preset 4".
  | { kind: "preset"; number: number }
  // Changement de vue (onglet).
  | { kind: "view"; view: string }
  | { kind: "error"; message: string };

// Mots-cles de selection acceptes avant une liste de numeros.
const FIXTURE_WORDS = new Set(["fixture", "fix", "f", "projecteur", "proj", "p"]);
// Mots-cles d'ecriture directe de canaux.
const CHANNEL_WORDS = new Set(["channel", "chan", "ch", "canal", "c"]);
// Mots-cles introduisant une valeur.
const AT_WORDS = new Set(["at", "a", "@"]);

// Attributs adressables directement par leur nom (FR + EN).
const ATTR_WORDS: Record<string, AttrKey> = {
  dim: "dimmer",
  dimmer: "dimmer",
  intensity: "dimmer",
  intensite: "dimmer",
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
  strobe: "strobe",
  color: "color",
  couleur: "color",
  gobo: "gobo",
  pan: "pan",
  tilt: "tilt",
  focus: "focus",
  beam: "beam"
};

// Destinations atteignables par "goto <vue>". La valeur est un hash resolu par
// resolveRoute() : une vue ("patch") ou une vue et son volet ("patch/lampes").
// Les mots de l'ancienne vue "Réseau" (reseau, appareils, lampes...) restent
// valables et ouvrent le volet de Patch qui a repris leur contenu.
const VIEW_WORDS: Record<string, string> = {
  live: "live",
  console: "live",
  dashboard: "live",
  vue: "live",
  patch: "patch",
  fixtures: "patch",
  projecteurs: "patch",
  reseau: "patch/inventaire",
  network: "patch/inventaire",
  inventaire: "patch/inventaire",
  inventory: "patch/inventaire",
  appareils: "patch/inventaire",
  devices: "patch/inventaire",
  lampes: "patch/lampes",
  lights: "patch/lampes",
  setup: "setup",
  reglages: "setup",
  settings: "setup"
};

// Cibles de STORE : "store 1" vise un executor par defaut, "store group 2" un
// groupe, "store preset 3" un preset.
const STORE_TARGETS: Record<string, "exec" | "group" | "preset"> = {
  exec: "exec",
  executor: "exec",
  scene: "exec",
  cue: "exec",
  group: "group",
  groupe: "group",
  grp: "group",
  preset: "preset",
  pre: "preset"
};

// Normalise un mot : minuscules et sans accents, pour accepter "intensité"
// aussi bien que "intensite".
const norm = (word: string): string =>
  word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// Lit une valeur : pourcentage par defaut, brute (0-255) si suffixee d/dmx.
// Accepte aussi les mots du pupitre : full, out/off, half.
// Renvoie une valeur DMX 0-255, ou null si le jeton n'est pas une valeur.
const parseValue = (token: string): number | null => {
  const t = norm(token).replace("%", "");
  if (t === "full" || t === "plein") return 255;
  if (t === "out" || t === "off" || t === "zero") return 0;
  if (t === "half" || t === "moitie") return 128;

  const raw = /^(\d+(?:\.\d+)?)(d|dmx)$/.exec(t);
  if (raw) return Math.max(0, Math.min(255, Math.round(Number(raw[1]))));

  if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
  const pct = Math.max(0, Math.min(100, Number(t)));
  return Math.round((pct / 100) * 255);
};

// Lit une liste de numeros : "1", "1 thru 4", "1 + 3 thru 5".
// `tokens` est consomme a partir de `start` ; renvoie les numeros et l'index
// du premier jeton non consomme.
const parseNumberList = (tokens: string[], start: number): { numbers: number[]; next: number } => {
  const numbers: number[] = [];
  let i = start;
  let pending: number | null = null;

  while (i < tokens.length) {
    const token = norm(tokens[i]);

    if (/^\d+$/.test(token)) {
      pending = Number(token);
      numbers.push(pending);
      i += 1;
      continue;
    }

    // "thru" (ou "a"/"->") etend la plage depuis le dernier numero lu.
    if ((token === "thru" || token === "through" || token === "-" || token === "..") && pending !== null) {
      const endToken = tokens[i + 1] ? norm(tokens[i + 1]) : "";
      if (!/^\d+$/.test(endToken)) break;
      const end = Number(endToken);
      const from = Math.min(pending, end);
      const to = Math.max(pending, end);
      for (let n = from; n <= to; n++) numbers.push(n);
      pending = end;
      i += 2;
      continue;
    }

    // "+" enchaine simplement un autre numero, on l'ignore comme separateur.
    if (token === "+" || token === ",") {
      i += 1;
      continue;
    }

    break;
  }

  return { numbers: Array.from(new Set(numbers)), next: i };
};

/**
 * Transforme une ligne saisie en commande typee.
 * Toute entree non reconnue renvoie { kind: "error" } avec un message affichable
 * dans la ligne de retour : on ne leve jamais d'exception ici.
 */
export const parseCommand = (input: string): ParsedCommand => {
  // On isole "+", "@" et "," comme jetons a part entiere pour pouvoir ecrire
  // "1+2" ou "ch 5 @ 50" sans espaces.
  const tokens = input
    .replace(/([+@,])/g, " $1 ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!tokens.length) return { kind: "error", message: "Commande vide" };

  const head = norm(tokens[0]);

  if (head === "help" || head === "aide" || head === "?") return { kind: "help" };
  if (head === "clear" || head === "cl" || head === "c") return { kind: "clear" };
  if (head === "blackout" || head === "bo" || head === "noir") return { kind: "blackout" };
  if (head === "all" || head === "tous") return { kind: "selectAll" };

  // "goto live" / "view patch"
  if (head === "goto" || head === "view" || head === "vue" || head === "page") {
    const target = tokens[1] ? VIEW_WORDS[norm(tokens[1])] : undefined;
    if (!target) return { kind: "error", message: `Vue inconnue : ${tokens[1] ?? "?"}` };
    return { kind: "view", view: target };
  }

  // "store 3" / "store group 2 Salon" / "store preset 1 Bleu"
  // Sans mot de cible, STORE vise un executor : c'est le geste le plus courant.
  if (head === "store" || head === "memoriser" || head === "st") {
    let i = 1;
    let target: "exec" | "group" | "preset" = "exec";
    const maybeTarget = tokens[1] ? norm(tokens[1]) : "";
    if (STORE_TARGETS[maybeTarget]) {
      target = STORE_TARGETS[maybeTarget];
      i = 2;
    }
    const numberToken = tokens[i] ? norm(tokens[i]) : "";
    if (!/^\d+$/.test(numberToken)) {
      return { kind: "error", message: "Numéro attendu (ex. STORE 1, STORE GROUP 2)" };
    }
    // Tout ce qui suit le numero est le nom libre de la memoire.
    const name = tokens.slice(i + 1).join(" ").trim();
    return { kind: "store", target, number: Number(numberToken), name: name || undefined };
  }

  // "go 3" (le mot de cible est tolere : "go exec 3").
  if (head === "go") {
    const i = tokens[1] && STORE_TARGETS[norm(tokens[1])] ? 2 : 1;
    const numberToken = tokens[i] ? norm(tokens[i]) : "";
    if (!/^\d+$/.test(numberToken)) {
      return { kind: "error", message: "Numéro d'executor attendu (ex. GO 1)" };
    }
    return { kind: "go", number: Number(numberToken) };
  }

  // "off 3" eteint un executor. "off" tout court reste le raccourci dimmer a zero,
  // traite juste en dessous : c'est la presence du numero qui tranche.
  if ((head === "off" || head === "release") && tokens[1] && /^\d+$/.test(norm(tokens[1]))) {
    return { kind: "off", number: Number(norm(tokens[1])) };
  }

  // "group 2" rappelle un groupe de selection.
  if (head === "group" || head === "groupe" || head === "grp") {
    const numberToken = tokens[1] ? norm(tokens[1]) : "";
    if (!/^\d+$/.test(numberToken)) {
      return { kind: "error", message: "Numéro de groupe attendu (ex. GROUP 1)" };
    }
    return { kind: "group", number: Number(numberToken) };
  }

  // "preset 4" applique un preset du pool.
  if (head === "preset" || head === "pre") {
    const numberToken = tokens[1] ? norm(tokens[1]) : "";
    if (!/^\d+$/.test(numberToken)) {
      return { kind: "error", message: "Numéro de preset attendu (ex. PRESET 1)" };
    }
    return { kind: "preset", number: Number(numberToken) };
  }

  // Raccourcis pupitre : "full" / "out" appliques directement a la selection.
  if (head === "full" || head === "out" || head === "off") {
    return { kind: "attr", attr: "dimmer", value: head === "full" ? 255 : 0 };
  }

  // "at 50" : regle le dimmer de la selection courante.
  if (AT_WORDS.has(head)) {
    const value = tokens[1] ? parseValue(tokens[1]) : null;
    if (value === null) return { kind: "error", message: "Valeur attendue apres AT (ex. AT 50)" };
    return { kind: "attr", attr: "dimmer", value };
  }

  // "channel 12 thru 20 at 50"
  if (CHANNEL_WORDS.has(head)) {
    const { numbers, next } = parseNumberList(tokens, 1);
    if (!numbers.length) return { kind: "error", message: "Numero de canal attendu (ex. CH 12 AT 50)" };
    const atToken = tokens[next] ? norm(tokens[next]) : "";
    const valueToken = AT_WORDS.has(atToken) ? tokens[next + 1] : tokens[next];
    const value = valueToken ? parseValue(valueToken) : null;
    if (value === null) return { kind: "error", message: "Valeur attendue (ex. CH 12 AT 50)" };
    // On ne garde que les canaux valides de l'univers, dans l'ordre saisi.
    const channels = numbers.filter((n) => n >= 1 && n <= 512);
    if (!channels.length) return { kind: "error", message: "Canal hors univers (1-512)" };
    return { kind: "channel", channels, value };
  }

  // "fixture 1 thru 3" (+ "at 50" optionnel)
  if (FIXTURE_WORDS.has(head)) {
    const { numbers, next } = parseNumberList(tokens, 1);
    if (!numbers.length) return { kind: "error", message: "Numero de projecteur attendu (ex. FIX 1)" };
    const rest = tokens.slice(next);
    if (!rest.length) return { kind: "select", numbers };

    const restHead = norm(rest[0]);
    // Suite possible : "at <valeur>" ou directement un attribut ("red 100").
    if (AT_WORDS.has(restHead)) {
      const value = rest[1] ? parseValue(rest[1]) : null;
      if (value === null) return { kind: "error", message: "Valeur attendue apres AT" };
      return { kind: "select", numbers, then: { attr: "dimmer", value } };
    }
    const attr = ATTR_WORDS[restHead];
    if (attr) {
      const value = rest[1] ? parseValue(rest[1]) : null;
      if (value === null) return { kind: "error", message: `Valeur attendue apres ${restHead.toUpperCase()}` };
      return { kind: "select", numbers, then: { attr, value } };
    }
    return { kind: "error", message: `Mot-cle inattendu : ${rest[0]}` };
  }

  // "red 100", "pan 51d"... sur la selection courante.
  const attr = ATTR_WORDS[head];
  if (attr) {
    const valueToken = tokens[1] && AT_WORDS.has(norm(tokens[1])) ? tokens[2] : tokens[1];
    const value = valueToken ? parseValue(valueToken) : null;
    if (value === null) return { kind: "error", message: `Valeur attendue apres ${head.toUpperCase()}` };
    return { kind: "attr", attr, value };
  }

  // Saisie d'un simple numero : on considere que c'est une selection ("1 thru 3").
  if (/^\d+$/.test(head)) {
    const { numbers, next } = parseNumberList(tokens, 0);
    const rest = tokens.slice(next);
    if (!rest.length) return { kind: "select", numbers };
    if (AT_WORDS.has(norm(rest[0]))) {
      const value = rest[1] ? parseValue(rest[1]) : null;
      if (value === null) return { kind: "error", message: "Valeur attendue apres AT" };
      return { kind: "select", numbers, then: { attr: "dimmer", value } };
    }
    return { kind: "error", message: `Mot-cle inattendu : ${rest[0]}` };
  }

  return { kind: "error", message: `Commande inconnue : ${tokens[0]}` };
};

// Aide affichee par la commande "help", ligne par ligne.
export const COMMAND_HELP: string[] = [
  "FIX 1 THRU 3        sélectionne les projecteurs 1 à 3 (numéros de la sheet)",
  "FIX 1 + 4 AT 50     sélectionne puis met le dimmer à 50 %",
  "AT 50 / FULL / OUT  règle le dimmer de la sélection courante",
  "RED 100 / PAN 51D   règle un attribut (valeur en %, suffixe D = brut 0-255)",
  "CH 12 THRU 20 AT 75 écrit directement des canaux de l'univers",
  "ALL / CLEAR         sélectionne tout / vide la sélection",
  "STORE 1 Ambiance    mémorise le plateau dans l'executor 1",
  "GO 1 / OFF 1        rejoue / éteint un executor",
  "STORE GROUP 2 Salon mémorise la sélection · GROUP 2 la rappelle",
  "STORE PRESET 3 Bleu mémorise des valeurs · PRESET 3 les applique",
  "BLACKOUT            remet les 512 canaux à zéro",
  "GOTO PATCH          change de vue (live, patch, réseau, setup)"
];
