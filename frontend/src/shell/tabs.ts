// Definition des vues de l'interface (shell de navigation).
// Source unique de verite pour la barre du haut et la navigation mobile :
// liste des vues, libelles, icones et ancres de hash URL (#live, #patch, ...).
// Sert aussi a valider la vue courante lue depuis le hash de l'URL.
//
// Le decoupage suit celui d'un pupitre, pas celui du code :
//   LIVE   — on joue (fixture sheet, encodeurs, executors, playbacks) ;
//   PATCH  — on definit le plateau (adressage DMX, bibliotheque QXF) ;
//   RESEAU — on decouvre et on appaire ce qui vit sur le LAN ;
//   SETUP  — on configure le pont (HomeKit, prise, systeme, maintenance).
//
// Les anciens onglets "Tableau de bord" et "Appareils" ont disparu : le premier
// ne faisait que repeter la barre d'etat, le second etait la moitie d'une vue
// reseau coupee en deux.
import { Boxes, Settings, Sliders, Sparkles, LucideIcon } from "lucide-react";

// Identifiants stables des 4 vues. Servent de cle interne (pas de libelle affiche).
export type TabId = "live" | "patch" | "reseau" | "setup";

// Forme d'une vue : son id, son libelle long et court (mobile), son ancre de hash et son icone.
export type TabDef = {
  id: TabId;
  label: string;
  shortLabel: string;
  hash: string;
  icon: LucideIcon;
};

// Liste ordonnee des vues, dans l'ordre d'affichage de la barre de navigation.
export const TABS: TabDef[] = [
  { id: "live", label: "Live", shortLabel: "Live", hash: "#live", icon: Sparkles },
  { id: "patch", label: "Patch", shortLabel: "Patch", hash: "#patch", icon: Sliders },
  { id: "reseau", label: "Réseau", shortLabel: "Réseau", hash: "#reseau", icon: Boxes },
  { id: "setup", label: "Setup", shortLabel: "Setup", hash: "#setup", icon: Settings }
];

// Vue affichee au premier chargement : le pupitre s'ouvre sur la console.
export const DEFAULT_TAB: TabId = "live";
// Ensemble des ids valides, utilise pour verifier rapidement une vue (lookup O(1)).
export const VALID_TAB_IDS = new Set<TabId>(TABS.map((t) => t.id));

// Anciens hashs, gardes pour ne pas casser les liens et raccourcis existants
// (l'ecran d'accueil du telephone, un onglet epingle, un signet).
const LEGACY_HASHES: Record<string, TabId> = {
  dashboard: "live",
  projecteurs: "patch",
  lampes: "reseau",
  appareils: "reseau",
  reglages: "setup"
};

// Garde de type : confirme qu'une chaine quelconque est bien un TabId connu.
export const isTabId = (value: string): value is TabId =>
  (VALID_TAB_IDS as Set<string>).has(value);

/**
 * Resout un fragment d'URL vers une vue : id courant, ancien id, ou null si
 * la chaine ne correspond a rien de connu.
 */
export const resolveTabId = (value: string): TabId | null => {
  if (isTabId(value)) return value;
  return LEGACY_HASHES[value] ?? null;
};
