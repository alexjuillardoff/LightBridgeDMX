// Retour d'action affiché dans la ligne de commande du pupitre.
//
// Type partagé plutôt que dupliqué : les actions des pools (STORE, GO, groupes,
// presets) et l'analyseur de la ligne de commande renvoient tous cette même
// forme, et la barre du bas se contente de l'afficher avec la bonne couleur.

export type FeedbackLevel = "info" | "ok" | "warn" | "error";

/** Une phrase de retour, sans horodatage (ajouté au moment de l'affichage). */
export type ActionResult = { level: FeedbackLevel; text: string };

export const ok = (text: string): ActionResult => ({ level: "ok", text });
export const warn = (text: string): ActionResult => ({ level: "warn", text });
export const fail = (text: string): ActionResult => ({ level: "error", text });
export const info = (text: string): ActionResult => ({ level: "info", text });
