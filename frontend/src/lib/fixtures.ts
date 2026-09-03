// Outils cote frontend pour la console DMX.
// Donne une couleur stable a chaque projecteur (fixture), construit la liste des
// canaux visibles d'une page de la grille (avec leur etiquette projecteur), et
// compte les canaux actifs. Calcul pur, sans appel reseau.
import { Fixture, UniverseState } from "@lightbridgedmx/shared";
import { addAlpha } from "./math";

// Couleur attribuee a un projecteur : "solid" pour le trait/point fort,
// "tint" est la meme couleur en version translucide (fond leger).
export type FixtureColor = {
  solid: string;
  tint: string;
};

// Un canal affiche dans la grille de la console DMX.
// Si le canal appartient a un projecteur connu on garde son identite separee de
// son role : la Fader View affiche le nom une seule fois, en entete du bloc de
// canaux du projecteur, et ne laisse dans la tranche que le role ("rouge",
// "pan"...). "color" = couleur du projecteur pour le reperage visuel.
export type VisibleChannel = {
  channel: number;
  value: number;
  fixtureId?: string;
  fixtureName?: string;
  channelLabel?: string;
  color?: FixtureColor;
};

type VisibleChannelsInput = {
  channelStart: number;
  channelPageSize: number;
  universeState: UniverseState | null;
  fixtures: Fixture[];
  fixtureColors: Record<string, FixtureColor>;
};

// Attribue une couleur a chaque projecteur, indexee par son id.
// On parcourt une palette fixe et on revient au debut quand elle est epuisee
// (modulo). Resultat stable tant que l'ordre des projecteurs ne change pas.
export const buildFixtureColors = (fixtures: Fixture[]): Record<string, FixtureColor> => {
  const palette = ["#1dd3b0", "#f39c12", "#9b59b6", "#e74c3c", "#3498db", "#2ecc71", "#e67e22", "#16a085"];
  return fixtures.reduce((acc, fixture, idx) => {
    const base = palette[idx % palette.length];
    // tint = meme teinte a 20 % d'opacite, pour un fond discret derriere le canal.
    acc[fixture.id] = { solid: base, tint: addAlpha(base, 0.2) };
    return acc;
  }, {} as Record<string, FixtureColor>);
};

// Construit la liste des canaux a afficher pour une page de la console DMX.
// On part du canal "channelStart", on prend "channelPageSize" canaux, et pour
// chacun on joint sa valeur live et, s'il appartient a un projecteur, son etiquette.
export const computeVisibleChannels = ({
  channelStart,
  channelPageSize,
  universeState,
  fixtures,
  fixtureColors
}: VisibleChannelsInput): VisibleChannel[] => {
  // On borne (clamp) la plage dans l'univers DMX valide : canaux 1 a 512.
  const start = Math.max(1, Math.min(channelStart, 512));
  const end = Math.min(start + channelPageSize - 1, 512);
  // Valeurs live des 512 canaux ; tableau de zeros tant que rien n'est recu.
  const values = universeState?.values ?? Array(512).fill(0);
  // Table d'aide : numero de canal absolu -> projecteur proprietaire + role.
  const owners: Record<number, Omit<VisibleChannel, "channel" | "value">> = {};

  // On pre-calcule le proprietaire de chaque canal occupe par un projecteur.
  fixtures.forEach((fixture) => {
    fixture.channels.forEach((ch) => {
      // Adresse absolue dans l'univers = adresse de depart + offset du canal - 1
      // (les canaux du projecteur sont numerotes a partir de 1).
      const abs = fixture.address + ch.channel - 1;
      if (abs >= 1 && abs <= 512) {
        owners[abs] = {
          fixtureId: fixture.id,
          fixtureName: fixture.name,
          // On prefere le nom du canal s'il existe, sinon sa capability (r, g, pan...).
          channelLabel: ch.name ?? ch.capability,
          color: fixtureColors[fixture.id]
        };
      }
    });
  });

  // On assemble la page : pour chaque canal, sa valeur live et son proprietaire.
  // Note : values est indexe a partir de 0, d'ou le "channel - 1".
  return Array.from({ length: end - start + 1 }, (_, idx) => {
    const channel = start + idx;
    return { channel, value: values[channel - 1] ?? 0, ...owners[channel] };
  });
};

// Compte combien de canaux sont allumes (valeur > 0) dans l'univers DMX.
// Sert d'indicateur rapide d'activite. Retourne 0 si aucun etat n'est encore recu.
export const countActiveChannels = (universeState: UniverseState | null) => {
  if (!universeState) return 0;
  return universeState.values.filter((v) => v > 0).length;
};
