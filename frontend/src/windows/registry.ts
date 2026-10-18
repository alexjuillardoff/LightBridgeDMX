// Registre des fenêtres : kind → module (imports statiques). Figé après la phase 1 :
// les agents des fenêtres remplacent uniquement leur dossier windows/<kind>/.
import { addWindow } from "../state/workspace";
import type { WindowKind } from "../state/workspace";
import type { WindowModule } from "./types";
import colorPicker from "./color-picker";
import devices from "./devices";
import dmxSheet from "./dmx-sheet";
import executors from "./executors";
import fixtureSheet from "./fixture-sheet";
import groups from "./groups";
import help from "./help";
import layout from "./layout";
import patch from "./patch";
import phaser from "./phaser";
import presets from "./presets";
import setup from "./setup";

export const WINDOWS: Record<WindowKind, WindowModule> = {
  fixtureSheet,
  layout,
  groups,
  presets,
  executors,
  phaser,
  dmxSheet,
  patch,
  devices,
  setup,
  help,
  colorPicker
};

export const WINDOW_KINDS = Object.keys(WINDOWS) as WindowKind[];

/**
 * Ajoute une fenêtre à la vue courante avec la taille par défaut de SON module
 * (cahier des charges §4.9 : « taille par défaut du module ») ; le chrome passe
 * toujours par ici plutôt que par addWindow() directement. Renvoie l'id créé.
 */
export function openWindow(kind: WindowKind, at?: { x: number; y: number }): string {
  return addWindow(kind, at, WINDOWS[kind].defaultSize);
}
