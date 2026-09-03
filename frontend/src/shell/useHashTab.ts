// Hook React qui synchronise la vue active de l'UI avec le hash de l'URL (ex. #live).
// Avantage : la vue est dans l'URL, donc rafraichir la page ou partager le lien
// conserve la vue ouverte, et les boutons precedent/suivant du navigateur fonctionnent.
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_TAB, TabId, isTabId, resolveTabId } from "./tabs";

// Lit la vue depuis le hash courant de l'URL.
// Si le hash est absent, inconnu, ou si on est cote serveur (pas de window), on
// retombe sur la vue par defaut. Les anciens hashs (#dashboard, #reglages...)
// sont traduits vers leur equivalent actuel par resolveTabId.
const fromHash = (): TabId => {
  if (typeof window === "undefined") return DEFAULT_TAB;
  const h = window.location.hash.replace(/^#/, "");
  return resolveTabId(h) ?? DEFAULT_TAB;
};

// Renvoie [vue active, fonction pour changer de vue].
export const useHashTab = (): [TabId, (next: TabId) => void] => {
  const [tab, setTab] = useState<TabId>(fromHash);

  // Suit les changements de hash de l'URL (clic sur un lien, bouton precedent/suivant)
  // et met l'etat React a jour en consequence.
  useEffect(() => {
    const onChange = () => {
      const raw = window.location.hash.replace(/^#/, "");
      const next = fromHash();
      // Avertit dans la console si le hash existe mais ne correspond a rien de
      // connu : on retombe alors sur la vue par defaut.
      if (raw && resolveTabId(raw) === null) {
        console.warn(`Unknown tab hash "#${raw}", falling back to #${DEFAULT_TAB}`);
      }
      setTab(next);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // Change de vue de maniere programmatique.
  const setActive = useCallback((next: TabId) => {
    if (!isTabId(next)) return;
    // On modifie le hash de l'URL : l'evenement "hashchange" ci-dessus fera alors le setTab.
    // Si le hash est deja le bon (aucun changement), l'evenement ne se declenche pas,
    // donc on met l'etat a jour nous-memes pour rester synchrone.
    if (window.location.hash !== `#${next}`) {
      window.location.hash = next;
    } else {
      setTab(next);
    }
  }, []);

  return [tab, setActive];
};
