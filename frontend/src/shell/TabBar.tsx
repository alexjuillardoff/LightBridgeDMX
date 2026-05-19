import { TABS, TabId } from "./tabs";

type TabBarProps = {
  active: TabId;
  onSelect: (next: TabId) => void;
};

export const TabBar = ({ active, onSelect }: TabBarProps) => (
  <nav className="tabbar" role="tablist" aria-label="Navigation principale">
    {TABS.map((tab) => {
      const Icon = tab.icon;
      const isActive = tab.id === active;
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          aria-controls={`panel-${tab.id}`}
          className={`tabbar-item ${isActive ? "tabbar-item-active" : ""}`}
          onClick={() => onSelect(tab.id)}
        >
          <Icon size={16} strokeWidth={2} aria-hidden="true" />
          <span>{tab.label}</span>
        </button>
      );
    })}
  </nav>
);
