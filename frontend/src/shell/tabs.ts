// Definition des vues de l'interface (shell de navigation).
// Source unique de verite pour la barre du haut, la navigation mobile et les
// volets de la vue Patch : liste des vues, libelles, icones et ancres de hash
// URL (#live, #patch, #patch/inventaire, ...).
// Sert aussi a valider la vue courante lue depuis le hash de l'URL.
//
// Le decoupage suit celui d'un pupitre, pas celui du code :
//   LIVE   — on joue (fixture sheet, encodeurs, executors, playbacks) ;
//   PATCH  — on definit le plateau : les projecteurs DMX *et* ce qui vit sur le
//            LAN, parce que "de quoi est fait le plateau" est une seule question ;
//   SETUP  — on configure le pont (HomeKit, prise, systeme, maintenance).
//
// L'ancienne vue "Réseau" a fusionne avec "Patch" : decouvrir une Nanoleaf,
// l'appairer puis lui donner une adresse DMX etait un seul geste coupe en deux
// onglets. Elle survit comme volet (#patch/inventaire, #patch/lampes).
// Avant elle, les onglets "Tableau de bord" et "Appareils" avaient disparu pour
// les memes raisons : le premier repetait la barre d'etat, le second etait la
// moitie d'une vue reseau coupee en deux.
import { Boxes, Lightbulb, Settings, Sliders, Sparkles, LucideIcon } from "lucide-react";

// Identifiants stables des 3 vues. Servent de cle interne (pas de libelle affiche).
export type TabId = "live" | "patch" | "setup";

// Volets de la vue Patch. Seule cette vue en a : Live et Setup sont d'un bloc.
export type PatchPaneId = "projecteurs" | "inventaire" | "lampes";

// Une vue (onglet) : son id, son libelle long et court (mobile), son ancre de
// hash et son icone.
export type TabDef = {
  id: TabId;
  label: string;
  shortLabel: string;
  hash: string;
  icon: LucideIcon;
};

// Un volet de la vue Patch : meme forme, plus un sous-titre affiche en tete de vue.
export type PatchPaneDef = {
  id: PatchPaneId;
  label: string;
  hash: string;
  icon: LucideIcon;
  subtitle: string;
};

// Liste ordonnee des vues, dans l'ordre d'affichage de la barre de navigation.
export const TABS: TabDef[] = [
  { id: "live", label: "Live", shortLabel: "Live", hash: "#live", icon: Sparkles },
  { id: "patch", label: "Patch", shortLabel: "Patch", hash: "#patch", icon: Sliders },
  { id: "setup", label: "Setup", shortLabel: "Setup", hash: "#setup", icon: Settings }
];

// Volets de Patch, dans l'ordre d'affichage des pastilles.
// L'ordre va du plus concret au plus lointain : ce qui est deja adresse, puis
// ce que le reseau expose, puis le pilotage fin de ce qui a ete appaire.
export const PATCH_PANES: PatchPaneDef[] = [
  {
    id: "projecteurs",
    label: "Projecteurs",
    hash: "#patch",
    icon: Sliders,
    subtitle: "adressage DMX et import depuis la bibliothèque QLC+"
  },
  {
    id: "inventaire",
    label: "Inventaire réseau",
    hash: "#patch/inventaire",
    icon: Boxes,
    subtitle: "ce que le LAN expose, pilotable ou non, avec la raison"
  },
  {
    id: "lampes",
    label: "Lampes connectées",
    hash: "#patch/lampes",
    icon: Lightbulb,
    subtitle: "couleurs, zones, effets et miroir DMX des lampes appairées"
  }
];

// Vue affichee au premier chargement : le pupitre s'ouvre sur la console.
export const DEFAULT_TAB: TabId = "live";
// Volet affiche quand on ouvre Patch sans en preciser un.
export const DEFAULT_PATCH_PANE: PatchPaneId = "projecteurs";

// Ensembles des ids valides, utilises pour verifier rapidement une vue ou un
// volet (lookup O(1)).
export const VALID_TAB_IDS = new Set<TabId>(TABS.map((t) => t.id));
const VALID_PANE_IDS = new Set<PatchPaneId>(PATCH_PANES.map((p) => p.id));

/**
 * Une destination de navigation : une vue, et pour Patch le volet ouvert.
 * `pane` est absent pour les vues qui n'ont pas de volets.
 */
export type Route = { tab: TabId; pane?: PatchPaneId };

// Anciens hashs, gardes pour ne pas casser les liens et raccourcis existants
// (l'ecran d'accueil du telephone, un onglet epingle, un signet). Les vues
// disparues pointent vers le volet qui a repris leur contenu.
const LEGACY_HASHES: Record<string, Route> = {
  dashboard: { tab: "live" },
  projecteurs: { tab: "patch", pane: "projecteurs" },
  fixtures: { tab: "patch", pane: "projecteurs" },
  reseau: { tab: "patch", pane: "inventaire" },
  network: { tab: "patch", pane: "inventaire" },
  appareils: { tab: "patch", pane: "inventaire" },
  devices: { tab: "patch", pane: "inventaire" },
  lampes: { tab: "patch", pane: "lampes" },
  lights: { tab: "patch", pane: "lampes" },
  reglages: { tab: "setup" }
};

// Garde de type : confirme qu'une chaine quelconque est bien un TabId connu.
export const isTabId = (value: string): value is TabId =>
  (VALID_TAB_IDS as Set<string>).has(value);

// Garde de type : confirme qu'une chaine quelconque est bien un volet de Patch.
export const isPatchPaneId = (value: string): value is PatchPaneId =>
  (VALID_PANE_IDS as Set<string>).has(value);

/**
 * Resout un fragment d'URL vers une destination : "patch", "patch/lampes",
 * un ancien id ("reseau", "appareils"...), ou null si la chaine ne correspond
 * a rien de connu. Le "#" de tete et un "/" final sont tolerés.
 */
export const resolveRoute = (value: string): Route | null => {
  const clean = value.replace(/^#/, "").replace(/\/+$/, "");
  if (!clean) return null;

  // Decoupe en tete/queue sans perdre le reste : "patch/lampes/x" doit garder
  // "lampes/x" en queue pour etre rejete, pas se faire tronquer en "lampes".
  const slash = clean.indexOf("/");
  const head = slash === -1 ? clean : clean.slice(0, slash);
  const tail = slash === -1 ? "" : clean.slice(slash + 1);
  if (isTabId(head)) {
    // Un volet ne veut dire quelque chose que sur Patch ; ailleurs on ignore la
    // queue plutot que de rejeter un lien par ailleurs valide.
    if (head !== "patch") return { tab: head };
    if (!tail) return { tab: "patch", pane: DEFAULT_PATCH_PANE };
    return isPatchPaneId(tail) ? { tab: "patch", pane: tail } : null;
  }

  // Ancien hash : on ne resout que la forme simple (pas de "reseau/xxx").
  if (tail) return null;
  return LEGACY_HASHES[head] ?? null;
};

/**
 * Ecrit une destination sous forme de hash, sans le "#".
 * Le volet par defaut de Patch est omis pour garder l'URL courte : "#patch"
 * plutot que "#patch/projecteurs".
 */
export const routeToHash = (route: Route): string => {
  if (route.tab !== "patch") return route.tab;
  const pane = route.pane ?? DEFAULT_PATCH_PANE;
  return pane === DEFAULT_PATCH_PANE ? "patch" : `patch/${pane}`;
};

/** Libelle lisible d'une destination, pour les retours de la ligne de commande. */
export const routeLabel = (route: Route): string => {
  const tab = TABS.find((t) => t.id === route.tab);
  const pane = route.tab === "patch" ? PATCH_PANES.find((p) => p.id === route.pane) : undefined;
  const base = tab?.label ?? route.tab;
  return pane && pane.id !== DEFAULT_PATCH_PANE ? `${base} · ${pane.label}` : base;
};
