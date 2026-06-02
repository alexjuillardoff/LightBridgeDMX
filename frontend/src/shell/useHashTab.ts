// Hook React qui synchronise l'onglet actif de l'UI avec le hash de l'URL (ex. #live).
// Avantage : l'onglet est dans l'URL, donc rafraichir la page ou partager le lien
// conserve l'onglet ouvert, et les boutons precedent/suivant du navigateur fonctionnent.
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_TAB, TabId, isTabId } from "./tabs";

// Lit l'onglet depuis le hash courant de l'URL.
// Si le hash est absent, inconnu, ou si on est cote serveur (pas de window), on retombe sur l'onglet par defaut.
const fromHash = (): TabId => {
  if (typeof window === "undefined") return DEFAULT_TAB;
  const h = window.location.hash.replace(/^#/, "");
  return isTabId(h) ? h : DEFAULT_TAB;
};

// Renvoie [onglet actif, fonction pour changer d'onglet].
export const useHashTab = (): [TabId, (next: TabId) => void] => {
  const [tab, setTab] = useState<TabId>(fromHash);

  // Suit les changements de hash de l'URL (clic sur un lien, bouton precedent/suivant)
  // et met l'etat React a jour en consequence.
  useEffect(() => {
    const onChange = () => {
      const next = fromHash();
      // Avertit dans la console si le hash existe mais ne correspond a aucun onglet connu : on retombe alors sur l'onglet par defaut.
      if (!isTabId(window.location.hash.replace(/^#/, "")) && window.location.hash) {
        console.warn(`Unknown tab hash "${window.location.hash}", falling back to #${DEFAULT_TAB}`);
      }
      setTab(next);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // Change d'onglet de maniere programmatique.
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
