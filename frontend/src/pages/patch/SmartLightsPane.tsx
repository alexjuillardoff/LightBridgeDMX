// Volet « Lampes connectées » de la vue Patch.
//
// Il n'existe que pour garder son etat local — le filtre par marque — hors de
// PatchPage : changer de marque ne doit pas re-rendre la table du patch DMX,
// et PatchPage n'a pas a connaitre le registre des backends.
import { useState } from "react";
import { SmartLightsPanel } from "../../components/SmartLightsPanel";
import { SMART_LIGHT_BACKENDS, SmartLightBackendId } from "../../components/smart-lights/backendRegistry";

// Filtre de marque applique aux lampes affichees ("all" = aucune restriction).
type BackendFilter = SmartLightBackendId | "all";

export const SmartLightsPane = () => {
  const [backend, setBackend] = useState<BackendFilter>("all");

  return (
    <>
      {/* Filtre par marque : une pastille par backend declare au registre. */}
      <div className="filter-pills" role="tablist" aria-label="Filtre par backend">
        <button
          type="button"
          role="tab"
          aria-selected={backend === "all"}
          className={`pill ${backend === "all" ? "pill-active" : ""}`}
          onClick={() => setBackend("all")}
        >
          Tous
        </button>
        {SMART_LIGHT_BACKENDS.map((b) => {
          const Icon = b.icon;
          const isActive = backend === b.id;
          return (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={b.description}
              className={`pill pill-with-icon ${isActive ? "pill-active" : ""}`}
              onClick={() => setBackend(b.id)}
            >
              <Icon size={14} strokeWidth={2} aria-hidden="true" />
              <span>{b.label}</span>
            </button>
          );
        })}
      </div>

      <SmartLightsPanel backendFilter={backend} hideSectionTitle />
    </>
  );
};
