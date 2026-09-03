// Rangée de faders de playback : un master par executor.
//
// Sur un pupitre, un playback n'est pas un interrupteur — c'est un fader qu'on
// monte. Ici chaque fader rejoue sa scène à un niveau intermédiaire, en
// n'atténuant QUE les intensités et les couleurs : la position d'une lyre, sa
// roue de gobos ou sa roue de couleurs restent là où la scène les a mises (voir
// lib/console/scenes). Baisser un playback baisse la lumière, il ne fait pas
// dériver le projecteur vers le milieu de sa course.
import { Play, Square } from "lucide-react";
import { EXEC_SLOTS, useConsole } from "../../../contexts/ConsoleContext";
import { useCommand } from "../../../contexts/CommandContext";
import { MaFader } from "../../ma/MaFader";

export const PlaybacksWindow = () => {
  const { executors, levels, setLevel, goExecutor, offExecutor, busy } = useConsole();
  const { report } = useCommand();

  return (
    <div className="playbacks">
      {Array.from({ length: EXEC_SLOTS }, (_, slot) => {
        const scene = executors[slot];
        const level = levels[slot] ?? 0;
        return (
          <div key={slot} className={`playback ${scene ? "" : "playback-empty"}`}>
            <span className="playback-num">{slot + 1}</span>
            <span className="playback-pct">{Math.round(level * 100)}</span>

            <MaFader
              label={`Playback ${slot + 1}${scene ? ` — ${scene.name}` : ""}`}
              // Le fader travaille en 0-255 : on convertit depuis/vers le ratio.
              value={Math.round(level * 255)}
              onChange={(next) => setLevel(slot, next / 255)}
              height={110}
            />

            <span className="playback-name" title={scene?.name ?? "Emplacement libre"}>
              {scene?.name ?? "—"}
            </span>

            <div className="playback-keys">
              <button
                type="button"
                aria-label={`Go playback ${slot + 1}`}
                disabled={!scene || busy}
                onClick={() => void goExecutor(slot).then(report)}
              >
                <Play size={11} strokeWidth={3} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Off playback ${slot + 1}`}
                disabled={!scene}
                onClick={() => report(offExecutor(slot))}
              >
                <Square size={11} strokeWidth={2.6} aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
