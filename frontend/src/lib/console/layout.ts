// Modèle de disposition du pupitre : les fenêtres de la vue Live.
//
// Sur un grandMA, l'écran Live n'est pas une page qui défile : c'est un plan de
// travail sur lequel on pose des fenêtres (Fixture Sheet, Encoder Bar, Executor
// Pool…), qu'on déplace et redimensionne, et dont on mémorise l'agencement dans
// une « View » rappelable. C'est ce modèle qu'on reproduit ici.
//
// Le repère est une grille (pas des pixels) : `x`/`w` en colonnes sur 24, `y`/`h`
// en rangées de hauteur fixe. Conséquence : la disposition suit la largeur de
// l'écran au lieu de se décaler, et les fenêtres s'alignent toutes seules —
// exactement le comportement d'accrochage d'un vrai pupitre.

// Largeur du plan de travail, en colonnes.
export const GRID_COLS = 24;
// Hauteur d'une rangée, en pixels. Une fenêtre utile fait au moins 4 rangées.
export const ROW_PX = 30;

// Les fenêtres disponibles. Chaque valeur correspond à un composant de contenu
// (voir components/console/windows/registry.tsx).
export type WindowKind =
  | "fixtures"
  | "encoders"
  | "executors"
  | "playbacks"
  | "groups"
  | "presets"
  | "faders"
  | "dmx"
  | "effects"
  | "log";

// Une fenêtre posée sur le plan de travail.
export type ConsoleWindow = {
  // Identifiant d'instance : deux fenêtres du même type peuvent coexister.
  id: string;
  kind: WindowKind;
  // Coin haut-gauche, en colonnes / rangées.
  x: number;
  y: number;
  // Taille, en colonnes / rangées.
  w: number;
  h: number;
};

// Une « View » du pupitre : un agencement complet, rappelable par son numéro.
export type ConsoleView = {
  id: string;
  name: string;
  windows: ConsoleWindow[];
};

// Bornes de taille, pour qu'une fenêtre reste manipulable après un glissement.
export const MIN_W = 4;
export const MIN_H = 4;

// Contraint une fenêtre à rester dans le plan de travail et au-dessus des
// tailles minimales. Appliqué après chaque déplacement / redimensionnement, et
// aussi à la lecture d'une disposition persistée (elle peut venir d'une version
// antérieure aux bornes actuelles).
export const clampWindow = (win: ConsoleWindow): ConsoleWindow => {
  const w = Math.max(MIN_W, Math.min(GRID_COLS, Math.round(win.w)));
  const h = Math.max(MIN_H, Math.round(win.h));
  const x = Math.max(0, Math.min(GRID_COLS - w, Math.round(win.x)));
  const y = Math.max(0, Math.round(win.y));
  return { ...win, x, y, w, h };
};

// Fabrique courte, pour que les dispositions par défaut restent lisibles.
const win = (kind: WindowKind, x: number, y: number, w: number, h: number): ConsoleWindow => ({
  id: `${kind}-${x}-${y}`,
  kind,
  x,
  y,
  w,
  h
});

// Les vues livrées d'origine. Elles couvrent les trois façons de se servir du
// pupitre : programmer, envoyer, et travailler au canal.
export const DEFAULT_VIEWS: ConsoleView[] = [
  {
    id: "programmer",
    name: "Programmer",
    windows: [
      win("fixtures", 0, 0, 13, 10),
      win("encoders", 13, 0, 11, 10),
      // Les trois pools tiennent chacun 12 emplacements : il leur faut de quoi
      // afficher trois rangées de tuiles sans avoir à faire défiler.
      win("groups", 0, 10, 8, 10),
      win("presets", 8, 10, 8, 10),
      win("executors", 16, 10, 8, 10),
      win("playbacks", 0, 20, 24, 9)
    ]
  },
  {
    id: "playback",
    name: "Playback",
    windows: [
      win("executors", 0, 0, 13, 8),
      win("log", 13, 0, 11, 8),
      // Les 12 playbacks tiennent sur une seule rangée pleine largeur : dans une
      // view dédiée à l'envoi, on ne veut pas faire défiler les faders.
      win("playbacks", 0, 8, 24, 8),
      win("fixtures", 0, 16, 24, 9)
    ]
  },
  {
    id: "dmx",
    name: "DMX",
    windows: [
      // La Fader View aligne ses 32 canaux sur UNE rangée qui défile : sa
      // hauteur ne sert qu'à la course des faders, et 17 rangées donnent des
      // faders assez longs pour se poser au point près.
      win("faders", 0, 0, 24, 17),
      win("dmx", 0, 17, 14, 8),
      win("fixtures", 14, 17, 10, 8)
    ]
  },
  {
    id: "effets",
    name: "Effets",
    windows: [win("effects", 0, 0, 15, 22), win("fixtures", 15, 0, 9, 11), win("executors", 15, 11, 9, 11)]
  }
];

/** Copie profonde des vues d'origine (le retour est librement modifiable). */
export const freshDefaultViews = (): ConsoleView[] =>
  DEFAULT_VIEWS.map((view) => ({ ...view, windows: view.windows.map((w) => ({ ...w })) }));

// Libellés et descriptions des fenêtres, pour le menu « Ajouter une fenêtre ».
export const WINDOW_LABELS: Record<WindowKind, { title: string; hint: string }> = {
  fixtures: { title: "Fixture Sheet", hint: "Sélection des projecteurs" },
  encoders: { title: "Encoders", hint: "Attributs de la sélection" },
  executors: { title: "Executors", hint: "Scènes rappelables (Go)" },
  playbacks: { title: "Playbacks", hint: "Faders master des executors" },
  groups: { title: "Groups", hint: "Groupes de sélection" },
  presets: { title: "Presets", hint: "Valeurs de canaux mémorisées" },
  faders: { title: "Fader View", hint: "Canaux DMX un par un" },
  dmx: { title: "DMX Sheet", hint: "Les 512 canaux en un coup d'œil" },
  effects: { title: "Effets", hint: "Pool d'effets des bandeaux LED" },
  log: { title: "Command Feedback", hint: "Journal des événements" }
};

/**
 * Cherche une place libre pour une nouvelle fenêtre : on la pose sous la
 * dernière rangée occupée, pleine largeur des colonnes restantes. Simple, mais
 * suffisant — l'opérateur la redimensionne ensuite comme il veut.
 */
export const placeNewWindow = (windows: ConsoleWindow[], kind: WindowKind): ConsoleWindow => {
  const bottom = windows.reduce((max, w) => Math.max(max, w.y + w.h), 0);
  return {
    id: `${kind}-${Date.now().toString(36)}`,
    kind,
    x: 0,
    y: bottom,
    w: 12,
    h: 9
  };
};
