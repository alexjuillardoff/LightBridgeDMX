// Modeles de projecteurs (fixtures) predefinis pour l'UI.
// Quand l'utilisateur ajoute un projecteur, il choisit un de ces modeles pour
// remplir d'un coup la liste des canaux et leur capability (fonction du canal).
// Les numeros de canal sont relatifs (1, 2, 3...) : ils s'ajoutent ensuite a l'adresse de depart du projecteur.
import { FixtureChannel } from "@lightbridgedmx/shared";

// Catalogue des modeles, indexe par cle (dimmer, rgb, rgbw).
// label = texte affiche dans l'UI ; channels = canaux et leur role.
export const fixtureTemplates: Record<
  string,
  { label: string; channels: FixtureChannel[] }
> = {
  // 1 canal : variateur (dimmer) seul, intensite globale.
  dimmer: {
    label: "Dimmer (1ch)",
    channels: [{ channel: 1, capability: "intensity" }]
  },
  // 3 canaux : rouge, vert, bleu.
  rgb: {
    label: "RGB (3ch)",
    channels: [
      { channel: 1, capability: "r" },
      { channel: 2, capability: "g" },
      { channel: 3, capability: "b" }
    ]
  },
  // 4 canaux : RGB + blanc dedie (w) pour un blanc plus pur.
  rgbw: {
    label: "RGBW (4ch)",
    channels: [
      { channel: 1, capability: "r" },
      { channel: 2, capability: "g" },
      { channel: 3, capability: "b" },
      { channel: 4, capability: "w" }
    ]
  }
};

// Type des cles valides du catalogue (ex. "dimmer" | "rgb" | "rgbw").
export type FixtureTemplateKey = keyof typeof fixtureTemplates;
