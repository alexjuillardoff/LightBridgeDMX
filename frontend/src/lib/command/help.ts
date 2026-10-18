// Aide de la ligne de commande (fenêtre Help, overlay ?), en français.
// Le vocabulaire du pupitre reste en anglais, comme sur un vrai grandMA3.

export type HelpEntry = { syntax: string; description: string };

/** Commandes, dans l'ordre d'apprentissage : sélection, valeurs, pools, playback, divers. */
export const COMMAND_HELP: HelpEntry[] = [
  { syntax: "Fixture 1 Thru 3 + 5 - 2", description: "Sélectionne par numéro (FID) ; Thru, + et - combinent ; « 1 Thru 3 » seul = Fixture" },
  { syntax: "Fixture Thru", description: "Sélectionne tous les projecteurs pilotables" },
  { syntax: "Fixture 2 At 75", description: "Sélectionne puis pose le dimmer à 75 %" },
  { syntax: "At 50 · Full · Out · Half", description: "Dimmer de la sélection (valeurs en %, suffixe d = brut 0-255)" },
  { syntax: "At 50 Thru 100", description: "Fan : du premier au dernier projecteur sélectionné" },
  { syntax: "Pan At 50 · Red 100 · Tilt 128d", description: "Pose un attribut : Dimmer, Pan, Tilt, Red, Green, Blue, White, UV, CTemp, Gobo, Color, Shutter, Prism, Focus, Speed, Effect, Control" },
  { syntax: "Attribute \"Pan\" At 50", description: "Forme longue de la commande précédente" },
  { syntax: "Dmx 12 Thru 20 At 50", description: "Écrit directement des canaux de l'univers (garde chambre appliquée)" },
  { syntax: "Clear · ClearAll", description: "Clear : 1er appui vide la sélection, 2e oublie les valeurs actives ; ClearAll fait les deux" },
  { syntax: "Group 2 · Store Group 2 \"Salon\"", description: "Rappelle / mémorise un groupe de sélection ; Delete Group 2, Label Group 2 \"Nom\"" },
  { syntax: "Preset 4.1 · Store Preset 4.1 \"Bleu\"", description: "Pool = n° de groupe de fonctions (1 Dimmer, 2 Position, 3 Gobo, 4 Color, 5 Beam, 6 Focus, 7 Control) ; « Preset 1 » = pool All" },
  { syntax: "Store 1 \"Look\" · Store Sequence 1", description: "Mémorise le programmer (sinon tout le plateau) dans l'executor 1" },
  { syntax: "Go 1 · Go+ 1 · Off 1", description: "Rejoue / éteint un executor (Off ne touche que les intensités)" },
  { syntax: "Executor 3 At 50", description: "Niveau du fader de l'executor 3" },
  { syntax: "Delete Sequence 1 · Label Sequence 1 \"Nom\"", description: "Supprime / renomme la scène d'un executor" },
  { syntax: "Phaser Off", description: "Arrête tous les phasers (effets) en cours" },
  { syntax: "Blackout · Blackout Off", description: "Coupe / rend les intensités (Grand Master à 0)" },
  { syntax: "View 2 · Store View 3 \"Nom\"", description: "Affiche / mémorise une vue de la view bar" },
  { syntax: "Highlight", description: "Bascule le highlight de la sélection" },
  { syntax: "Help", description: "Ouvre cette fenêtre" },
  { syntax: "… Please", description: "Équivaut à Entrée (ignoré en fin de ligne)" }
];

/** Raccourcis clavier (actifs quand « ShCuts » est allumé dans la ligne de commande). */
export const SHORTCUT_HELP: HelpEntry[] = [
  { syntax: "F1 … F8", description: "Groupes de fonctions : 1 Dimmer … 8 Shapers" },
  { syntax: "Esc", description: "Clear (cycle MA3)" },
  { syntax: "Ctrl + Entrée", description: "Store (arme le mode Store)" },
  { syntax: "↑ / ↓", description: "Historique de la ligne de commande" },
  { syntax: "Entrée", description: "Exécute la ligne (= Please)" }
];

/** Gestes propres au pupitre MA3, rappelés dans la fenêtre Help. */
export const GESTURE_HELP: HelpEntry[] = [
  { syntax: "Store armé", description: "Le bouton Store d'un pool passe en jaune ; le prochain clic sur une tuile enregistre" },
  { syntax: "Clear × 3", description: "Sélection vidée, puis valeurs actives oubliées (elles restent sur scène), puis rien" },
  { syntax: "Appui long / clic droit", description: "Menu d'une tuile ou d'un bouton de vue (Label, Delete, Store View…)" },
  { syntax: "Clic sur l'écran vide", description: "Ouvre le dialogue Add Window à cet endroit" },
  { syntax: "Cadenas", description: "Projecteur verrouillé (chambre) : visible mais jamais sélectionnable ni écrit" }
];

/** Lignes d'aide à plat (« syntaxe — description »), pour un affichage texte. */
export const COMMAND_HELP_LINES: string[] = COMMAND_HELP.map((e) => `${e.syntax} — ${e.description}`);
