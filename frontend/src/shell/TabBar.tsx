// Barre d'onglets du haut, utilisee sur grand ecran (desktop).
// Meme liste partagee d'onglets (TABS) que la version mobile BottomNav.tsx,
// mais ici on affiche le libelle complet et on relie chaque onglet a son
// panneau via aria-controls pour l'accessibilite.
import { TABS, TabId } from "./tabs";

// active : onglet actuellement selectionne.
// onSelect : callback declenche au clic pour changer d'onglet.
type TabBarProps = {
  active: TabId;
  onSelect: (next: TabId) => void;
};

export const TabBar = ({ active, onSelect }: TabBarProps) => (
  <nav className="tabbar" role="tablist" aria-label="Navigation principale">
    {TABS.map((tab) => {
      // Composant icone lucide-react associe a l'onglet.
      const Icon = tab.icon;
      // Vrai si cet onglet est celui en cours d'affichage.
      const isActive = tab.id === active;
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          // aria-controls relie l'onglet au panneau qu'il pilote (id "panel-<onglet>").
          aria-controls={`panel-${tab.id}`}
          className={`tabbar-item ${isActive ? "tabbar-item-active" : ""}`}
          onClick={() => onSelect(tab.id)}
        >
          {/* Sur desktop on a la place pour le libelle complet (label). */}
          <Icon size={16} strokeWidth={2} aria-hidden="true" />
          <span>{tab.label}</span>
        </button>
      );
    })}
  </nav>
);
