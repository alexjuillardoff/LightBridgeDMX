// Barre de vues (haut d'ecran), equivalent des boutons de vue d'un pupitre.
// Chaque vue est numerotee, comme les "Views" d'un grandMA que l'on rappelle
// par leur numero. Meme liste partagee (TABS) que la navigation mobile.
import { TABS, TabId } from "./tabs";

type TabBarProps = {
  active: TabId;
  onSelect: (next: TabId) => void;
};

export const TabBar = ({ active, onSelect }: TabBarProps) => (
  <nav className="ma-viewbar" role="tablist" aria-label="Vues">
    {TABS.map((tab, index) => {
      const Icon = tab.icon;
      const isActive = tab.id === active;
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          // aria-controls relie le bouton de vue au panneau qu'il affiche.
          aria-controls={`panel-${tab.id}`}
          className={`ma-viewbtn ${isActive ? "ma-viewbtn-active" : ""}`}
          onClick={() => onSelect(tab.id)}
        >
          {/* Numero de vue, a gauche : reflexe de pupitre pour s'y retrouver. */}
          <span className="ma-viewbtn-num">{index + 1}</span>
          <Icon size={14} strokeWidth={2} aria-hidden="true" />
          <span>{tab.label}</span>
        </button>
      );
    })}
  </nav>
);
