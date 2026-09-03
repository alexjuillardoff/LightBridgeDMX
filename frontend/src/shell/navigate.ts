// Navigation entre les vues de l'UI via le hash de l'URL (#live, #patch, ...).
// Le routing est base sur location.hash : changer le hash declenche l'affichage
// de la vue correspondante, sans rechargement de page.
import { Route, resolveRoute, routeToHash } from "./tabs";

/**
 * Active une vue (et son volet) en ecrivant sa destination dans le hash de l'URL.
 * On accepte soit une Route deja resolue, soit le mot brut tape par
 * l'utilisateur ("patch", "reseau", "patch/lampes") que l'on resout ici.
 * Une destination inconnue ne fait rien plutot que de poser un hash invalide
 * qui casserait la navigation ; la fonction renvoie la Route reellement
 * atteinte, ou null si rien n'a bouge.
 */
export const setActiveTabHash = (target: Route | string): Route | null => {
  const route = typeof target === "string" ? resolveRoute(target) : target;
  if (!route) return null;
  window.location.hash = routeToHash(route);
  return route;
};
