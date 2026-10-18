// Racine de l'application : démarre le flux temps réel (WebSocket + refreshAll au
// `open`), monte le shell grandMA3 et affiche un bandeau discret quand le dernier
// chargement a échoué (appStore.error). Tout l'état vit dans les stores externes
// (state/*) : aucun contexte React n'est nécessaire ici.
import { useEffect } from "react";
import { Shell } from "./shell/Shell";
import { clearAppError, refreshAll, useAppError } from "./state/app";
import { startRealtime } from "./state/realtime";

/** Bandeau d'erreur discret (chargement incomplet, backend injoignable…). */
function ErrorBanner() {
  const error = useAppError();
  if (!error) return null;
  return (
    <div className="sh-apperror" role="alert">
      <span className="sh-apperror__text" title={error}>
        {error}
      </span>
      <button type="button" className="sh-apperror__btn" onClick={() => void refreshAll()}>
        Réessayer
      </button>
      <button type="button" className="sh-apperror__close" onClick={clearAppError} aria-label="Masquer le message d'erreur">
        ✕
      </button>
    </div>
  );
}

export default function App() {
  // Une seule connexion WebSocket pour toute la page, fermée au démontage. En dev,
  // StrictMode monte/démonte une fois de plus : la fonction d'arrêt le tolère
  // (socket fermée sans reconnexion, puis une nouvelle ouverte).
  useEffect(() => startRealtime(), []);

  return (
    <>
      <Shell />
      <ErrorBanner />
    </>
  );
}
