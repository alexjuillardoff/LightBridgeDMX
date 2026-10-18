// Capture et rappel de scènes — la mécanique derrière STORE / GO / OFF des executors.
//
// Une scène du backend est une liste d'étapes `{ fixtureId, values }` où `values`
// est le bloc CONTIGU de canaux lu à partir de l'adresse du projecteur (c'est
// ainsi que le backend la rejoue). On respecte ce format ici.
//
// Tout est pur : ces fonctions renvoient des listes d'écritures `[canal, valeur]`
// que l'appelant confie au dmx-writer en UN lot (jamais un POST par canal).
import type { Capability, Fixture, Scene, SceneStep } from "@lightbridgedmx/shared";
import { isLocked } from "./guard";
import { DIMMABLE_CAPABILITIES, fixtureSpan } from "./patch";

/**
 * Photographie l'état courant des projecteurs donnés : c'est le contenu que
 * STORE écrit dans une scène. Les projecteurs verrouillés sont écartés — une
 * scène ne doit jamais pouvoir rallumer la chambre au rappel.
 */
export const captureScene = (fixtures: Fixture[], values: number[]): SceneStep[] =>
  fixtures
    .filter((fixture) => !isLocked(fixture))
    .map((fixture) => {
      const span = fixtureSpan(fixture);
      const slice: number[] = [];
      for (let i = 0; i < span; i += 1) {
        const channel = fixture.address + i;
        if (channel < 1 || channel > 512) break;
        slice.push(values[channel - 1] ?? 0);
      }
      return { fixtureId: fixture.id, values: slice };
    })
    // Un projecteur hors univers donnerait une étape vide, que le schéma Zod du
    // backend refuse (`min(1)`) : on la retire plutôt que d'échouer au POST.
    .filter((step) => step.values.length > 0);

// Rôle de chaque canal du bloc d'un projecteur, par position relative 1-indexée.
const capabilityByOffset = (fixture: Fixture): Map<number, Capability> => {
  const map = new Map<number, Capability>();
  fixture.channels.forEach((ch) => map.set(ch.channel, ch.capability));
  return map;
};

/** Canaux absolus touchés par une scène (projecteurs verrouillés ou disparus exclus). */
export const sceneChannels = (scene: Scene, fixturesById: Map<string, Fixture>): number[] => {
  const channels: number[] = [];
  scene.steps.forEach((step) => {
    const fixture = fixturesById.get(step.fixtureId);
    if (!fixture || isLocked(fixture)) return;
    step.values.forEach((_, idx) => {
      const channel = fixture.address + idx;
      if (channel >= 1 && channel <= 512) channels.push(channel);
    });
  });
  return channels;
};

/** Canaux DIMMABLE d'une scène : ce que OFF remet à zéro (la lyre garde sa position). */
export const sceneDimmableChannels = (scene: Scene, fixturesById: Map<string, Fixture>): number[] => {
  const channels: number[] = [];
  scene.steps.forEach((step) => {
    const fixture = fixturesById.get(step.fixtureId);
    if (!fixture || isLocked(fixture)) return;
    const roles = capabilityByOffset(fixture);
    step.values.forEach((_, idx) => {
      const channel = fixture.address + idx;
      const capability = roles.get(idx + 1);
      if (channel < 1 || channel > 512 || !capability) return;
      if (DIMMABLE_CAPABILITIES.has(capability)) channels.push(channel);
    });
  });
  return channels;
};

/**
 * Écritures pour rejouer une scène à un niveau donné (0 → 1), comme un fader de
 * playback : les canaux d'intensité/couleur sont mis à l'échelle, les autres sont
 * posés à leur valeur mémorisée (pan, tilt, gobo, roue de couleurs…).
 * Le Grand Master n'est PAS appliqué ici : c'est le writer qui l'applique, une fois.
 */
export const applySceneAtLevel = (
  scene: Scene,
  fixturesById: Map<string, Fixture>,
  level: number
): Array<[number, number]> => {
  const ratio = Math.max(0, Math.min(1, level));
  const entries: Array<[number, number]> = [];

  scene.steps.forEach((step) => {
    const fixture = fixturesById.get(step.fixtureId);
    if (!fixture || isLocked(fixture)) return;
    const roles = capabilityByOffset(fixture);
    step.values.forEach((stored, idx) => {
      const channel = fixture.address + idx;
      if (channel < 1 || channel > 512) return;
      const capability = roles.get(idx + 1);
      const dimmable = capability !== undefined && DIMMABLE_CAPABILITIES.has(capability);
      entries.push([channel, dimmable ? Math.round(stored * ratio) : stored]);
    });
  });

  return entries;
};

/** Nombre de projecteurs d'une scène encore présents dans le patch. */
export const sceneFixtureCount = (scene: Scene, fixturesById: Map<string, Fixture>): number =>
  scene.steps.filter((step) => fixturesById.has(step.fixtureId)).length;
