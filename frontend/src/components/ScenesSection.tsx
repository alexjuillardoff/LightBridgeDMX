// Rangée d'executors : les scènes enregistrées présentées comme les executors
// d'un grandMA (tuile numérotée, nom, bandeau "Go" en pied).
//
// Les emplacements vides sont affichés en creux, comme sur un pupitre où toute
// la rangée reste visible même si peu d'executors sont assignés.
import { Scene } from "@lightbridgedmx/shared";

type ScenesSectionProps = {
  scenes?: Scene[];
};

// Nombre d'emplacements toujours dessinés, scènes ou non.
const EXEC_SLOTS = 10;

export const ScenesSection = ({ scenes = [] }: ScenesSectionProps) => (
  <div className="card">
    <h2>
      Executors
      <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 400 }}>
        {scenes.length} scène(s) enregistrée(s)
      </span>
    </h2>

    <div className="ma-execs">
      {Array.from({ length: Math.max(EXEC_SLOTS, scenes.length) }, (_, index) => {
        const scene = scenes[index];
        return (
          <div key={scene?.id ?? `empty-${index}`} className={`ma-exec ${scene ? "" : "ma-exec-empty"}`}>
            <span className="ma-exec-num">{index + 1}</span>
            <span className="ma-exec-name">{scene?.name ?? "—"}</span>
            <span className="ma-exec-meta">
              {scene ? `${scene.steps.length} fixture(s)` : "libre"}
            </span>
          </div>
        );
      })}
    </div>

    {!scenes.length ? (
      <p className="muted" style={{ marginTop: 6 }}>
        Aucune scène enregistrée pour l'instant — le rappel de cues arrive plus tard.
      </p>
    ) : null}
  </div>
);
