// Ligne de commande du pupitre, fixée en bas de l'écran.
// Barre turquoise, prompt entre crochets et bouton "+" jaune : c'est la
// transposition directe de la command line d'un grandMA2.
//
// Toute la logique (analyse, exécution, historique) vit dans CommandContext ;
// ce composant n'est que l'habillage de la saisie et de la ligne de retour.
import { FormEvent, KeyboardEvent } from "react";
import { useAppData } from "../contexts/AppDataContext";
import { useCommand } from "../contexts/CommandContext";
import { useSelection } from "../contexts/SelectionContext";

export const CommandLine = () => {
  const { logHistory, logMessage } = useAppData();
  const { input, setInput, submit, runLine, recall, feedback } = useCommand();
  const { selectedIds } = useSelection();

  const onSubmit = (evt: FormEvent) => {
    evt.preventDefault();
    submit();
  };

  // Flèches haut/bas : navigation dans l'historique des commandes.
  const onKeyDown = (evt: KeyboardEvent<HTMLInputElement>) => {
    if (evt.key !== "ArrowUp" && evt.key !== "ArrowDown") return;
    evt.preventDefault();
    recall(evt.key === "ArrowUp" ? -1 : 1);
  };

  // Ligne de retour : priorité au retour de commande, sinon dernier log backend.
  const lastLog = logHistory[0];
  const level = feedback?.level ?? (lastLog?.level === "error" ? "error" : lastLog?.level === "warn" ? "warn" : "info");
  const text = feedback?.text ?? lastLog?.message ?? logMessage ?? "Pupitre prêt";
  const at = feedback?.at ?? lastLog?.timestamp;
  const time = at ? new Date(at).toLocaleTimeString("fr-FR") : "--:--:--";

  return (
    <div className="ma-cmdline">
      <div className="ma-cmd-feedback" role="status" aria-live="polite">
        <span className="ma-cmd-feedback-time">{time}</span>
        <span
          className={
            level === "ok"
              ? "ma-cmd-feedback-ok"
              : level === "warn"
              ? "ma-cmd-feedback-warn"
              : level === "error"
              ? "ma-cmd-feedback-error"
              : ""
          }
        >
          {text}
        </span>
      </div>

      <form className="ma-cmd-row" onSubmit={onSubmit}>
        {/* Le prompt indique la cible courante, comme "[Channel]>" sur MA2. */}
        <span className="ma-cmd-prompt">
          [{selectedIds.length ? `Fixture ${selectedIds.length}` : "Channel"}]&gt;
        </span>
        <input
          className="ma-cmd-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="fixture 1 thru 3 at 50 · ch 12 at full · help"
          aria-label="Ligne de commande"
          spellCheck={false}
          autoComplete="off"
        />
        <div className="ma-cmd-keys">
          <button type="button" className="button-small" onClick={() => runLine("clear")}>
            Clear
          </button>
          <button type="button" className="button-small" onClick={() => runLine("full")}>
            Full
          </button>
          <button type="button" className="button-small" onClick={() => runLine("out")}>
            Out
          </button>
          <button type="button" className="button-small" onClick={() => runLine("help")}>
            ?
          </button>
        </div>
        {/* Bouton "+" jaune du bout de ligne : valide la commande. */}
        <button type="submit" className="ma-cmd-go" aria-label="Exécuter la commande">
          +
        </button>
      </form>
    </div>
  );
};
