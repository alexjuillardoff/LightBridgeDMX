// Hook React qui synchronise la destination affichee avec le hash de l'URL
// (ex. #live, #patch, #patch/lampes).
// Avantage : la vue est dans l'URL, donc rafraichir la page ou partager le lien
// conserve la vue — et le volet — ouverts, et les boutons precedent/suivant du
// navigateur fonctionnent.
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_TAB, Route, resolveRoute, routeToHash } from "./tabs";

// Destination de repli quand le hash est absent ou incomprehensible.
const FALLBACK: Route = { tab: DEFAULT_TAB };

// Lit la destination depuis le hash courant de l'URL.
// Si le hash est absent, inconnu, ou si on est cote serveur (pas de window), on
// retombe sur la vue par defaut. Les anciens hashs (#dashboard, #reseau...)
// sont traduits vers leur equivalent actuel par resolveRoute.
const fromHash = (): Route => {
  if (typeof window === "undefined") return FALLBACK;
  return resolveRoute(window.location.hash) ?? FALLBACK;
};

// Renvoie [destination active, fonction pour naviguer].
export const useHashTab = (): [Route, (next: Route) => void] => {
  const [route, setRoute] = useState<Route>(fromHash);

  // Suit les changements de hash de l'URL (clic sur un lien, bouton precedent/suivant)
  // et met l'etat React a jour en consequence.
  useEffect(() => {
    const onChange = () => {
      const raw = window.location.hash.replace(/^#/, "");
      const next = resolveRoute(raw);
      // Avertit dans la console si le hash existe mais ne correspond a rien de
      // connu : on retombe alors sur la vue par defaut.
      if (raw && !next) {
        console.warn(`Unknown tab hash "#${raw}", falling back to #${DEFAULT_TAB}`);
      }
      setRoute(next ?? FALLBACK);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // Navigue de maniere programmatique.
  const navigate = useCallback((next: Route) => {
    const hash = routeToHash(next);
    // On modifie le hash de l'URL : l'evenement "hashchange" ci-dessus fera alors le setRoute.
    // Si le hash est deja le bon (aucun changement), l'evenement ne se declenche pas,
    // donc on met l'etat a jour nous-memes pour rester synchrone.
    if (window.location.hash !== `#${hash}`) {
      window.location.hash = hash;
    } else {
      setRoute(next);
    }
  }, []);

  return [route, navigate];
};
