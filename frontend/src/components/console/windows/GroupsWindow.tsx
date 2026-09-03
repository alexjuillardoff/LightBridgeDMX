// Pool de groupes : des sélections de projecteurs mémorisées.
//
// Sur un pupitre, on ne re-sélectionne pas « les trois PAR du salon » à la main
// vingt fois par soirée — on les range dans un groupe et on le rappelle. C'est
// exactement ce que fait cette fenêtre : Store fige la sélection courante, un
// clic la restitue au programmer.
//
// Les groupes sont propres au poste de travail (localStorage) : ils décrivent une
// habitude de travail, pas le spectacle, qui vit lui côté backend.
import { Save, Trash2 } from "lucide-react";
import { useConsole } from "../../../contexts/ConsoleContext";
import { useCommand } from "../../../contexts/CommandContext";
import { useSelection } from "../../../contexts/SelectionContext";

// Emplacements toujours dessinés, occupés ou non.
const GROUP_SLOTS = 12;

export const GroupsWindow = () => {
  const { groups, storeGroup, recallGroup, deleteGroup } = useConsole();
  const { report } = useCommand();
  const { selectedIds } = useSelection();

  const onStore = (number: number) => {
    if (!selectedIds.length) {
      report({ level: "warn", text: "Sélection vide — sélectionnez des projecteurs avant Store" });
      return;
    }
    const name = window.prompt(
      `Mémoriser les ${selectedIds.length} projecteur(s) sélectionné(s) dans le groupe ${number}.\nNom du groupe :`,
      `Groupe ${number}`
    );
    if (name === null) return;
    report(storeGroup(number, name));
  };

  return (
    <div className="pool">
      <p className="pool-hint">
        Clic = rappel · <strong>Store</strong>{" "}
        {selectedIds.length
          ? `fige la sélection courante (${selectedIds.length} projecteur${selectedIds.length > 1 ? "s" : ""})`
          : "fige la sélection courante — vide pour l'instant"}
        .
      </p>

      <div className="pool-grid">
        {Array.from({ length: GROUP_SLOTS }, (_, index) => {
          const number = index + 1;
          const group = groups.find((g) => g.number === number);

          if (!group) {
            return (
              <button
                key={`empty-${number}`}
                type="button"
                className="pool-tile pool-tile-empty"
                onClick={() => onStore(number)}
                title={`Groupe ${number} libre — mémoriser la sélection ici`}
              >
                <span className="pool-num">{number}</span>
                <span className="pool-name">libre</span>
                <span className="pool-store">
                  <Save size={12} strokeWidth={2.4} aria-hidden="true" /> Store
                </span>
              </button>
            );
          }

          return (
            <div key={group.id} className="pool-tile pool-tile-group">
              <span className="pool-num">{number}</span>
              <span className="pool-name" title={group.name}>
                {group.name}
              </span>
              <span className="pool-meta">{group.fixtureIds.length} projecteur(s)</span>

              <button type="button" className="pool-go" onClick={() => report(recallGroup(number))}>
                Sélectionner
              </button>

              <div className="pool-actions">
                <button type="button" title="Remplacer par la sélection courante" onClick={() => onStore(number)}>
                  <Save size={11} strokeWidth={2.6} aria-hidden="true" />
                </button>
                <button type="button" title="Supprimer le groupe" onClick={() => deleteGroup(group.id)}>
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
