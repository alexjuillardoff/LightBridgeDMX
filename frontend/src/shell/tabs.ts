// Definition des onglets de l'interface (shell de navigation).
// Source unique de verite pour la barre du haut et la navigation mobile :
// liste des onglets, libelles, icones et ancres de hash URL (#dashboard, ...).
// Sert aussi a valider l'onglet courant lu depuis le hash de l'URL.
import { LayoutDashboard, Lightbulb, Settings, Sliders, Sparkles, LucideIcon } from "lucide-react";

// Identifiants stables des 5 onglets. Servent de cle interne (pas de libelle affiche).
export type TabId = "dashboard" | "projecteurs" | "lampes" | "live" | "reglages";

// Forme d'un onglet : son id, son libelle long et court (mobile), son ancre de hash et son icone.
export type TabDef = {
  id: TabId;
  label: string;
  shortLabel: string;
  hash: string;
  icon: LucideIcon;
};

// Liste ordonnee des onglets, dans l'ordre d'affichage de la barre de navigation.
export const TABS: TabDef[] = [
  { id: "dashboard", label: "Tableau de bord", shortLabel: "Vue", hash: "#dashboard", icon: LayoutDashboard },
  { id: "projecteurs", label: "Projecteurs", shortLabel: "Fixtures", hash: "#projecteurs", icon: Sliders },
  { id: "lampes", label: "Lampes connectées", shortLabel: "Lampes", hash: "#lampes", icon: Lightbulb },
  { id: "live", label: "Live", shortLabel: "Live", hash: "#live", icon: Sparkles },
  { id: "reglages", label: "Réglages", shortLabel: "Réglages", hash: "#reglages", icon: Settings }
];

// Onglet affiche au premier chargement, quand le hash de l'URL est vide ou invalide.
export const DEFAULT_TAB: TabId = "dashboard";
// Ensemble des ids valides, utilise pour verifier rapidement un onglet (lookup O(1)).
export const VALID_TAB_IDS = new Set<TabId>(TABS.map((t) => t.id));

// Garde de type : confirme qu'une chaine quelconque (ex. issue du hash URL) est bien un TabId connu.
export const isTabId = (value: string): value is TabId =>
  (VALID_TAB_IDS as Set<string>).has(value);
