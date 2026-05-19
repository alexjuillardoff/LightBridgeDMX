import { useState } from "react";
import { SmartLightsPanel } from "../components/SmartLightsPanel";
import { SMART_LIGHT_BACKENDS, SmartLightBackendId } from "../components/smart-lights/backendRegistry";

type Filter = SmartLightBackendId | "all";

export const SmartLightsPage = () => {
  const [filter, setFilter] = useState<Filter>("all");

  return (
    <>
      <div className="section-title">
        <h2>Lampes connectées</h2>
        <span className="muted">
          Nanoleaf et autres lampes WiFi pilotées par LightBridge — extensible aux ampoules Hue / Matter
        </span>
      </div>

      <div className="filter-pills" role="tablist" aria-label="Filtre par backend">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          className={`pill ${filter === "all" ? "pill-active" : ""}`}
          onClick={() => setFilter("all")}
        >
          Tous
        </button>
        {SMART_LIGHT_BACKENDS.map((b) => {
          const Icon = b.icon;
          const isActive = filter === b.id;
          return (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={b.description}
              className={`pill pill-with-icon ${isActive ? "pill-active" : ""}`}
              onClick={() => setFilter(b.id)}
            >
              <Icon size={14} strokeWidth={2} aria-hidden="true" />
              <span>{b.label}</span>
            </button>
          );
        })}
      </div>

      <SmartLightsPanel backendFilter={filter} hideSectionTitle />
    </>
  );
};
