// Contrat d'un module de fenêtre (cahier des charges §6.0). Chaque dossier windows/<kind>/
// exporte par défaut un WindowModule ; le chrome (WindowFrame) fournit `win` et `setSettings`.
import type { ComponentType } from "react";
import type { WindowInstance, WindowKind } from "../state/workspace";

export type WindowProps = {
  /** Instance de la fenêtre (position, taille, réglages persistés avec la vue). */
  win: WindowInstance;
  /** Fusionne des réglages dans `win.settings`. */
  setSettings: (patch: Record<string, unknown>) => void;
};

export type WindowCategory = "Common" | "Presets" | "Pools" | "Playback" | "Tools" | "Data" | "More";

export type WindowModule = {
  kind: WindowKind;
  title: string;
  category: WindowCategory;
  /** Taille par défaut en cellules de la grille 24×16. */
  defaultSize: { w: number; h: number };
  Component: ComponentType<WindowProps>;
  /** Boutons affichés à droite de la barre de titre. */
  TitleExtras?: ComponentType<WindowProps>;
  minSize?: { w: number; h: number };
};
