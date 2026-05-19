import { LayoutDashboard, Lightbulb, Settings, Sliders, Sparkles, LucideIcon } from "lucide-react";

export type TabId = "dashboard" | "projecteurs" | "lampes" | "live" | "reglages";

export type TabDef = {
  id: TabId;
  label: string;
  shortLabel: string;
  hash: string;
  icon: LucideIcon;
};

export const TABS: TabDef[] = [
  { id: "dashboard", label: "Tableau de bord", shortLabel: "Vue", hash: "#dashboard", icon: LayoutDashboard },
  { id: "projecteurs", label: "Projecteurs", shortLabel: "Fixtures", hash: "#projecteurs", icon: Sliders },
  { id: "lampes", label: "Lampes connectées", shortLabel: "Lampes", hash: "#lampes", icon: Lightbulb },
  { id: "live", label: "Live", shortLabel: "Live", hash: "#live", icon: Sparkles },
  { id: "reglages", label: "Réglages", shortLabel: "Réglages", hash: "#reglages", icon: Settings }
];

export const DEFAULT_TAB: TabId = "dashboard";
export const VALID_TAB_IDS = new Set<TabId>(TABS.map((t) => t.id));

export const isTabId = (value: string): value is TabId =>
  (VALID_TAB_IDS as Set<string>).has(value);
