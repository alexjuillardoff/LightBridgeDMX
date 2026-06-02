// Navigation entre les onglets de l'UI via le hash de l'URL (#dashboard, #live...).
// Le routing est base sur location.hash : changer le hash declenche l'affichage
// de l'onglet correspondant, sans rechargement de page.
import { TabId, isTabId } from "./tabs";

/**
 * Active un onglet en ecrivant son identifiant dans le hash de l'URL.
 * On valide d'abord l'id avec isTabId : si l'onglet est inconnu, on ne fait
 * rien plutot que de poser un hash invalide qui casserait la navigation.
 */
export const setActiveTabHash = (id: TabId) => {
  if (!isTabId(id)) return;
  window.location.hash = id;
};
