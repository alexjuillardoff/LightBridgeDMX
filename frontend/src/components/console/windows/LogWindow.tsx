// Journal des événements : ce que le backend a dit récemment.
//
// C'est le pendant écran de la ligne de retour de la command line, qui n'affiche
// que le dernier message. Utile pendant une manip pour voir passer les erreurs
// DMX ou les scènes activées depuis un autre poste.
import { useAppData } from "../../../contexts/AppDataContext";

export const LogWindow = () => {
  const { logHistory, logMessage } = useAppData();

  if (!logHistory.length) {
    return <p className="muted">{logMessage || "Backend prêt — aucun événement pour l'instant."}</p>;
  }

  return (
    <ul className="activity-list">
      {logHistory.map((entry, idx) => (
        <li key={`${entry.timestamp}-${idx}`} className={`activity-item activity-${entry.level}`}>
          <span className="activity-time">{new Date(entry.timestamp).toLocaleTimeString("fr-FR")}</span>
          <span className="activity-msg">{entry.message}</span>
        </li>
      ))}
    </ul>
  );
};
