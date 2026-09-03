// Couche "programmer" du frontend, au sens pupitre du terme : elle traduit une
// intention exprimee en attributs (Dimmer, Red, Pan...) en ecritures de canaux
// DMX absolus, pour un ou plusieurs projecteurs selectionnes.
//
// C'est la brique commune de la fixture sheet, de la barre d'encodeurs et de la
// ligne de commande : ces trois UI parlent d'attributs, jamais de numeros de
// canaux, et c'est ici que la traduction se fait.
import { Capability, Fixture } from "@lightbridgedmx/shared";

// Attributs pilotables depuis l'UI. Ce sont les "encoders" du pupitre.
export type AttrKey =
  | "dimmer"
  | "red"
  | "green"
  | "blue"
  | "white"
  | "strobe"
  | "color"
  | "ctemp"
  | "gobo"
  | "pan"
  | "tilt"
  | "focus"
  | "beam";

// Groupes d'attributs, comme les touches de groupe d'un pupitre MA.
// L'ordre du tableau est celui d'affichage des encodeurs dans chaque groupe.
export type AttrGroupId = "dimmer" | "color" | "position" | "beam";

export type AttrGroup = {
  id: AttrGroupId;
  label: string;
  attrs: AttrKey[];
};

export const ATTR_GROUPS: AttrGroup[] = [
  { id: "dimmer", label: "Dimmer", attrs: ["dimmer", "strobe"] },
  { id: "color", label: "Color", attrs: ["red", "green", "blue", "white", "color", "ctemp"] },
  { id: "position", label: "Position", attrs: ["pan", "tilt"] },
  { id: "beam", label: "Beam", attrs: ["gobo", "focus", "beam"] }
];

// Libelle court affiche au-dessus de chaque encodeur.
export const ATTR_LABELS: Record<AttrKey, string> = {
  dimmer: "Dim",
  red: "Red",
  green: "Green",
  blue: "Blue",
  white: "White",
  strobe: "Strobe",
  color: "Color",
  // Blanc variable : 0 % = le plus chaud, 100 % = le plus froid.
  ctemp: "CTemp",
  gobo: "Gobo",
  pan: "Pan",
  tilt: "Tilt",
  focus: "Focus",
  beam: "Beam"
};

// Couleur d'accent de chaque attribut, reprise du code couleur des groupes MA
// (dimmer blanc, couleur magenta, position bleue, beam jaune).
export const ATTR_COLORS: Record<AttrKey, string> = {
  dimmer: "var(--attr-dimmer)",
  strobe: "var(--attr-dimmer)",
  red: "#e05a5a",
  green: "#5ac878",
  blue: "#5a95e0",
  white: "var(--attr-dimmer)",
  color: "var(--attr-color)",
  ctemp: "var(--attr-color)",
  gobo: "var(--attr-gobo)",
  pan: "var(--attr-position)",
  tilt: "var(--attr-position)",
  focus: "var(--attr-beam)",
  beam: "var(--attr-beam)"
};

// Couleur de groupe d'attributs d'un canal, a partir de sa capability.
// Sur un MA, on repere une tranche a sa teinte avant de lire son nom : dimmer
// blanc, couleur magenta (rouge/vert/bleu gardent leur propre teinte), position
// bleue, gobo vert, beam jaune. Les canaux de service (maintenance, other) et
// les canaux libres restent gris : ils ne portent pas de lumiere.
const CAPABILITY_COLORS: Record<Capability, string> = {
  intensity: "var(--attr-dimmer)",
  strobe: "var(--attr-dimmer)",
  r: "#e05a5a",
  g: "#5ac878",
  b: "#5a95e0",
  w: "var(--attr-dimmer)",
  uv: "#8f6ae0",
  colorTemp: "var(--attr-color)",
  color: "var(--attr-color)",
  pan: "var(--attr-position)",
  tilt: "var(--attr-position)",
  gobo: "var(--attr-gobo)",
  prism: "var(--attr-gobo)",
  beam: "var(--attr-beam)",
  focus: "var(--attr-beam)",
  effect: "var(--attr-beam)",
  speed: "var(--attr-beam)",
  maintenance: "var(--edge-grey)",
  other: "var(--edge-grey)"
};

// Teinte d'un canal DMX ; gris neutre si le canal n'appartient a aucun projecteur.
export const capabilityColor = (capability?: Capability): string =>
  capability ? CAPABILITY_COLORS[capability] : "var(--edge-grey)";

// Capability (role du canal cote schema partage) correspondant a chaque attribut.
const ATTR_CAPABILITY: Record<AttrKey, Capability> = {
  dimmer: "intensity",
  red: "r",
  green: "g",
  blue: "b",
  white: "w",
  strobe: "strobe",
  color: "color",
  ctemp: "colorTemp",
  gobo: "gobo",
  pan: "pan",
  tilt: "tilt",
  focus: "focus",
  beam: "beam"
};

// Conversions valeur DMX (0-255) <-> pourcentage affiche (0-100), comme sur un
// pupitre ou l'operateur raisonne en % et le protocole en octets.
export const toPct = (value: number): number => Math.round((value / 255) * 100);
export const fromPct = (pct: number): number => Math.round((pct / 100) * 255);

// Canal absolu dans l'univers (1-512) d'un canal relatif d'un projecteur.
// Les canaux d'un projecteur sont numerotes a partir de 1 depuis son adresse.
export const absoluteChannel = (fixture: Fixture, relative: number): number =>
  fixture.address + relative - 1;

// Canaux absolus d'un projecteur portant une capability donnee.
// Un projecteur peut en avoir plusieurs (ex. deux canaux "intensity").
export const channelsForCapability = (fixture: Fixture, capability: Capability): number[] =>
  fixture.channels
    .filter((ch) => ch.capability === capability)
    .map((ch) => absoluteChannel(fixture, ch.channel))
    .filter((ch) => ch >= 1 && ch <= 512);

// Canaux absolus a ecrire pour un attribut donne.
// Cas particulier du dimmer : beaucoup de PAR RGB n'ont pas de canal d'intensite
// dedie. Dans ce cas on retombe sur les canaux r/g/b, ce qui donne le meme
// resultat percu (monter le "dimmer" monte la couleur affichee).
export const channelsForAttr = (fixture: Fixture, attr: AttrKey): number[] => {
  const direct = channelsForCapability(fixture, ATTR_CAPABILITY[attr]);
  if (direct.length || attr !== "dimmer") return direct;
  return [
    ...channelsForCapability(fixture, "r"),
    ...channelsForCapability(fixture, "g"),
    ...channelsForCapability(fixture, "b")
  ];
};

// Vrai si le projecteur expose cet attribut (canal dedie, ou repli dimmer/RGB).
export const hasAttr = (fixture: Fixture, attr: AttrKey): boolean =>
  channelsForAttr(fixture, attr).length > 0;

// Attributs reellement disponibles sur au moins un projecteur de la selection,
// dans l'ordre du groupe demande. Sert a peupler la barre d'encodeurs.
export const attrsForSelection = (fixtures: Fixture[], group: AttrGroup): AttrKey[] =>
  group.attrs.filter((attr) => fixtures.some((f) => hasAttr(f, attr)));

// Valeur DMX courante d'un attribut pour un projecteur : on prend la valeur la
// plus haute de ses canaux (cas du repli RGB ou les trois peuvent differer).
export const readAttr = (fixture: Fixture, attr: AttrKey, values: number[]): number => {
  const channels = channelsForAttr(fixture, attr);
  if (!channels.length) return 0;
  return channels.reduce((max, ch) => Math.max(max, values[ch - 1] ?? 0), 0);
};

// Valeur affichee pour une selection multiple : la plus haute des valeurs,
// convention habituelle des pupitres (HTP) pour un affichage unique.
export const readAttrForSelection = (fixtures: Fixture[], attr: AttrKey, values: number[]): number =>
  fixtures.reduce((max, f) => Math.max(max, readAttr(f, attr, values)), 0);

// Couleur RGB courante d'un projecteur, pour la pastille de la fixture sheet.
// Renvoie null si le projecteur n'a pas de canaux de couleur, ou si la couleur
// est noire : une pastille noire sur fond noir n'apprend rien et ressemble a
// une case a cocher vide.
export const readRgb = (fixture: Fixture, values: number[]): string | null => {
  const r = channelsForCapability(fixture, "r");
  const g = channelsForCapability(fixture, "g");
  const b = channelsForCapability(fixture, "b");
  if (!r.length && !g.length && !b.length) return null;
  const read = (channels: number[]) => (channels.length ? values[channels[0] - 1] ?? 0 : 0);
  const [red, green, blue] = [read(r), read(g), read(b)];
  if (!red && !green && !blue) return null;
  return `rgb(${red}, ${green}, ${blue})`;
};

// Applique une valeur DMX a un attribut sur toute une liste de projecteurs.
// `write` est la fonction d'ecriture d'un canal (celle du contexte applicatif) ;
// on renvoie le nombre de canaux effectivement ecrits pour le retour de commande.
export const applyAttr = (
  fixtures: Fixture[],
  attr: AttrKey,
  value: number,
  write: (channel: number, value: number) => void
): number => {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  let written = 0;
  fixtures.forEach((fixture) => {
    channelsForAttr(fixture, attr).forEach((channel) => {
      write(channel, clamped);
      written += 1;
    });
  });
  return written;
};
