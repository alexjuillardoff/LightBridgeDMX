// Overlay « M A » : historique des commandes (la plus récente en haut). Un clic recopie la
// ligne dans la command line.
import { closeOverlay } from "../../state/workspace";
import { clearCommandHistory, focusCommandLine, setCommandText, useCommandHistory } from "../CommandLine";
import { OverlayFrame } from "./OverlayFrame";

export function CmdHistory() {
  const history = useCommandHistory();
  const pick = (line: string) => {
    setCommandText(line);
    closeOverlay();
    focusCommandLine();
  };
  return (
    <OverlayFrame
      title="Command History"
      onClose={closeOverlay}
      width={40}
      top
      footer={
        <>
          <button type="button" className="ma-btn ma-btn--small" disabled={history.length === 0} onClick={clearCommandHistory}>
            Vider l'historique
          </button>
          <button type="button" className="ma-btn ma-btn--small" onClick={closeOverlay}>
            Fermer
          </button>
        </>
      }
    >
      {history.length === 0 ? <div className="ma-empty">Aucune commande exécutée.</div> : null}
      <ul className="sh-history">
        {history
          .slice()
          .reverse()
          .map((line, i) => (
            <li key={`${line}-${i}`}>
              <button type="button" className="sh-history__item ma-mono" onClick={() => pick(line)}>
                <span className="sh-history__prompt">&gt;</span> {line}
              </button>
            </li>
          ))}
      </ul>
    </OverlayFrame>
  );
}
