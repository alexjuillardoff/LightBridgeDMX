// Garde-fou : « l'effet tourne, mais on ne verra rien ».
//
// Un projecteur qui a un canal d'intensité ET des canaux R/G/B (le PAR 56 Lampe,
// la Lampe Salon) peut recevoir un effet de couleur ou de position parfaitement
// correct sans rien montrer, parce que son gradateur est resté à 0. L'effet écrit,
// le plateau reste noir, et rien ne le dit.
//
// Le moteur ne l'ouvre pas de lui-même, et c'est volontaire : l'intensité appartient
// à l'opérateur, comme sur un pupitre où le dimmer vient du programmer ou d'un
// executor. On le signale donc, avec le geste à un clic — plutôt que de décider à
// sa place, ou de le laisser chercher.
//
// Ce composant lit l'univers en direct (20 Hz) : il est isolé pour que ce flux ne
// re-rende pas toute la fenêtre Effets à chaque trame.
import { useMemo } from "react";
import { DmxEffect, EffectCell } from "@lightbridgedmx/shared";
import { useAppData } from "../../../../contexts/AppDataContext";
import { useUniverseState } from "../../../../contexts/UniverseStateContext";

type Props = { cells: EffectCell[]; effect: DmxEffect };

export const EffectDimmerGuard = ({ cells, effect }: Props) => {
  const { universeState } = useUniverseState();
  const { fixtures, handleUpdateChannel } = useAppData();

  // Une ligne « dimmer » pilote elle-même l'intensité : il n'y a rien à ouvrir.
  const drivesDimmer = effect.lines.some((l) => l.attribute === "dimmer");
  const values = universeState?.values;

  const dark = useMemo(() => {
    if (drivesDimmer) return [];
    const channels = new Map<number, string>();
    for (const cell of cells) {
      const ch = cell.channels.dimmer;
      if (ch !== undefined && (values?.[ch - 1] ?? 0) === 0) channels.set(ch, cell.fixtureId);
    }
    return [...channels].map(([channel, fixtureId]) => ({ channel, fixtureId }));
  }, [cells, values, drivesDimmer]);

  if (!dark.length) return null;

  const names = dark
    .map(({ fixtureId }) => fixtures.find((f) => f.id === fixtureId)?.name)
    .filter((n): n is string => !!n);

  return (
    <div className="fx-guard">
      <span>
        <strong>{dark.length}</strong>{" "}
        {dark.length > 1 ? "projecteurs ont leur gradateur à 0" : "projecteur a son gradateur à 0"}
        {names.length ? ` (${names.join(", ")})` : ""} : l'effet écrira la couleur sans qu'on voie
        rien.
      </span>
      <button
        type="button"
        className="fx-mini"
        title="Monter leur canal d'intensité à 100 % — l'effet ne le pilote pas, il restera à ta main"
        onClick={() => dark.forEach(({ channel }) => handleUpdateChannel(channel, 255))}
      >
        Ouvrir à 100 %
      </button>
    </div>
  );
};
