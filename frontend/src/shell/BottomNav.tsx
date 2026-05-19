import { TABS, TabId } from "./tabs";

type BottomNavProps = {
  active: TabId;
  onSelect: (next: TabId) => void;
};

export const BottomNav = ({ active, onSelect }: BottomNavProps) => (
  <nav className="bottomnav" role="tablist" aria-label="Navigation mobile">
    {TABS.map((tab) => {
      const Icon = tab.icon;
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
          <Icon size={22} strokeWidth={2} aria-hidden="true" />
          <span>{tab.shortLabel}</span>
        </button>
      );
    })}
  </nav>
);
