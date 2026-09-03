// Pool d'executors : les scènes enregistrées, posées sur des emplacements
// numérotés et rappelables d'un clic.
//
// C'est la fenêtre qui rend le pupitre utile : jusqu'ici la rangée d'executors
// était dessinée mais inerte, alors que le backend savait déjà enregistrer
// (`POST /api/scenes`) et rejouer (`/activate`) une scène. Un clic sur une tuile
// occupée = Go. Une tuile libre propose Store, qui photographie le plateau.
//
// Les emplacements vides restent visibles, comme sur un vrai pupitre : on tape
// « Store 7 » en sachant où le 7 se trouve.
import { Play, Save, Square, Trash2 } from "lucide-react";
import { EXEC_SLOTS, useConsole } from "../../../contexts/ConsoleContext";
import { useCommand } from "../../../contexts/CommandContext";
import { useSelection } from "../../../contexts/SelectionContext";

export const ExecutorsWindow = () => {
  const { executors, storeExecutor, goExecutor, offExecutor, deleteExecutor, busy } = useConsole();
  const { report } = useCommand();
  const { selectedIds } = useSelection();

  // Store demande un nom : c'est ce qui distingue « Ambiance salon » de
  // « Exec 3 » six mois plus tard. Annuler la boîte annule l'enregistrement.
  const onStore = (slot: number) => {
    const suggested = `Exec ${slot + 1}`;
    const name = window.prompt(
      selectedIds.length
        ? `Mémoriser ${selectedIds.length} projecteur(s) sélectionné(s) dans l'executor ${slot + 1}.\nNom de la scène :`
        : `Sélection vide : le plateau complet sera mémorisé dans l'executor ${slot + 1}.\nNom de la scène :`,
      suggested
    );
    if (name === null) return;
    void storeExecutor(slot, name).then(report);
  };

  // Supprimer efface la scène en base : c'est irréversible, on demande donc
  // confirmation avant, comme pour la suppression d'un projecteur.
  const onDelete = (slot: number, name: string) => {
    if (!window.confirm(`Supprimer définitivement l'executor ${slot + 1} « ${name} » ?`)) return;
    void deleteExecutor(slot).then(report);
  };

  const slots = Math.max(EXEC_SLOTS, executors.length);

  return (
    <div className="pool">
      <p className="pool-hint">
        Clic = Go · <strong>Store</strong> mémorise
        {selectedIds.length ? ` les ${selectedIds.length} projecteur(s) sélectionné(s)` : " tout le plateau"}.
      </p>

      <div className="pool-grid">
        {Array.from({ length: slots }, (_, slot) => {
          const scene = executors[slot];
          if (!scene) {
            return (
              <button
                key={`empty-${slot}`}
                type="button"
                className="pool-tile pool-tile-empty"
                disabled={busy}
                onClick={() => onStore(slot)}
                title={`Emplacement ${slot + 1} libre — mémoriser ici`}
              >
                <span className="pool-num">{slot + 1}</span>
                <span className="pool-name">libre</span>
                <span className="pool-store">
                  <Save size={12} strokeWidth={2.4} aria-hidden="true" /> Store
                </span>
              </button>
            );
          }

          return (
            <div key={scene.id} className="pool-tile pool-tile-exec">
              <span className="pool-num">{slot + 1}</span>
              <span className="pool-name" title={scene.name}>
                {scene.name}
              </span>
              <span className="pool-meta">{scene.steps.length} projecteur(s)</span>

              {/* Bandeau Go, plein largeur : la cible principale de la tuile. */}
              <button
                type="button"
                className="pool-go"
                disabled={busy}
                onClick={() => void goExecutor(slot).then(report)}
              >
                <Play size={12} strokeWidth={3} aria-hidden="true" /> Go
              </button>

              <div className="pool-actions">
                <button
                  type="button"
                  title="Éteindre uniquement ce que cet executor pilote"
                  onClick={() => report(offExecutor(slot))}
                >
                  <Square size={11} strokeWidth={2.6} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="Réenregistrer l'état courant dans cet emplacement"
                  disabled={busy}
                  onClick={() => onStore(slot)}
                >
                  <Save size={11} strokeWidth={2.6} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="Supprimer définitivement cet executor"
                  disabled={busy}
                  onClick={() => onDelete(slot, scene.name)}
                >
                  <Trash2 size={11} strokeWidth={2.6} aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
