// Barre de navigation du bas, affichee uniquement sur mobile.
// Elle reprend la liste partagee d'onglets (TABS) et affiche pour chacun
// une icone + un libelle court. Le pendant desktop est TabBar.tsx.
import { TABS, TabId } from "./tabs";

// active : onglet actuellement selectionne.
// onSelect : callback declenche au clic pour changer d'onglet.
type BottomNavProps = {
  active: TabId;
  onSelect: (next: TabId) => void;
};

export const BottomNav = ({ active, onSelect }: BottomNavProps) => (
  <nav className="bottomnav" role="tablist" aria-label="Navigation mobile">
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
          aria-label={tab.label}
          className={`bottomnav-item ${isActive ? "bottomnav-item-active" : ""}`}
          onClick={() => onSelect(tab.id)}
        >
          {/* On affiche le libelle court (shortLabel) car la place est limitee en bas d'ecran. */}
          <Icon size={22} strokeWidth={2} aria-hidden="true" />
          <span>{tab.shortLabel}</span>
        </button>
      );
    })}
  </nav>
);
