// Capture et rappel de scènes — la mécanique derrière STORE / GO / OFF.
//
// Une scène du backend est une liste d'étapes `{ fixtureId, values }` où `values`
// est un bloc CONTIGU de canaux lu à partir de l'adresse du projecteur (c'est
// ainsi que `DmxService.applyWrite` le rejoue). On respecte donc ce format ici,
// plutôt que d'indexer par les canaux déclarés du projecteur.
import { Fixture, Scene, SceneStep } from "@lightbridgedmx/shared";
import { isLockedFixture } from "../fixtureGuard";

// Capabilities qu'un fader master a le droit d'atténuer.
//
// Un master de pupitre agit sur l'INTENSITÉ, jamais sur la mise en place : mettre
// un playback à 50 % doit baisser la lumière, pas faire pivoter la lyre à
// mi-course ni tourner sa roue de couleurs. Les canaux hors de cette liste sont
// donc rejoués à leur valeur mémorisée, quel que soit le niveau du fader.
const DIMMABLE = new Set(["intensity", "r", "g", "b", "w", "uv"]);

/** Nombre de canaux occupés par un projecteur depuis son adresse (bloc contigu). */
export const fixtureSpan = (fixture: Fixture): number =>
  fixture.channels.reduce((max, ch) => Math.max(max, ch.channel), 0);

/**
 * Photographie l'état courant des projecteurs donnés : c'est le contenu que
 * STORE écrit dans une scène. Les projecteurs verrouillés sont écartés — une
 * scène ne doit jamais pouvoir rallumer la chambre au rappel.
 */
export const captureScene = (fixtures: Fixture[], values: number[]): SceneStep[] =>
  fixtures
    .filter((fixture) => !isLockedFixture(fixture))
    .map((fixture) => {
      const span = fixtureSpan(fixture);
      const slice: number[] = [];
      for (let i = 0; i < span; i++) {
        const channel = fixture.address + i;
        slice.push(channel >= 1 && channel <= 512 ? values[channel - 1] ?? 0 : 0);
      }
      return { fixtureId: fixture.id, values: slice };
    })
    // Un projecteur hors univers donnerait une étape vide, que le schéma Zod du
    // backend refuse (`min(1)`) : on les retire ici plutôt que d'échouer au POST.
    .filter((step) => step.values.length > 0);

/**
 * Canaux absolus touchés par une scène. Sert au OFF d'un executor : on ne remet
 * à zéro que ce que la scène pilote, pas tout l'univers.
 */
export const sceneChannels = (scene: Scene, fixturesById: Map<string, Fixture>): number[] => {
  const channels: number[] = [];
  scene.steps.forEach((step) => {
    const fixture = fixturesById.get(step.fixtureId);
    if (!fixture || isLockedFixture(fixture)) return;
    step.values.forEach((_, idx) => {
      const channel = fixture.address + idx;
      if (channel >= 1 && channel <= 512) channels.push(channel);
    });
  });
  return channels;
};

/**
 * Rejoue une scène à un niveau donné (0 → 1), comme un fader de playback.
 * Les canaux d'intensité et de couleur sont mis à l'échelle, les autres sont
 * posés à leur valeur mémorisée : la lyre garde sa position quand on baisse.
 *
 * @returns le nombre de canaux effectivement écrits.
 */
export const applySceneAtLevel = (
  scene: Scene,
  fixturesById: Map<string, Fixture>,
  level: number,
  write: (channel: number, value: number) => void
): number => {
  const ratio = Math.max(0, Math.min(1, level));
  let written = 0;

  scene.steps.forEach((step) => {
    const fixture = fixturesById.get(step.fixtureId);
    if (!fixture || isLockedFixture(fixture)) return;

    // Rôle de chaque canal du bloc, repéré par sa position relative (1-indexée).
    const capabilityByOffset = new Map<number, string>();
    fixture.channels.forEach((ch) => capabilityByOffset.set(ch.channel, ch.capability));

    step.values.forEach((stored, idx) => {
      const channel = fixture.address + idx;
      if (channel < 1 || channel > 512) return;
      const capability = capabilityByOffset.get(idx + 1);
      const dimmable = capability !== undefined && DIMMABLE.has(capability);
      write(channel, dimmable ? Math.round(stored * ratio) : stored);
      written += 1;
    });
  });

  return written;
};
