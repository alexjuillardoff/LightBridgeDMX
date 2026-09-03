// Vue "Réseau" : tout ce qui vit sur le LAN, découverte et pilotage réunis.
//
// Auparavant, « Appareils » et « Lampes connectées » étaient deux onglets
// distincts, ce qui obligeait à faire des allers-retours pour un même geste :
// on découvre une Nanoleaf dans l'inventaire, on l'appaire… et il faut changer
// d'onglet pour la piloter. Les deux sont maintenant deux volets d'une même vue :
//
//   Inventaire — ce que le réseau expose, pilotable ou non, avec la raison ;
//   Lampes     — le pilotage fin de ce qui a été appairé (couleurs, zones,
//                effets, layout 3D, miroir DMX).
import { useState } from "react";
import { Boxes, Lightbulb } from "lucide-react";
import { DeviceInventory } from "../components/DeviceInventory";
import { SmartLightsPanel } from "../components/SmartLightsPanel";
import { SMART_LIGHT_BACKENDS, SmartLightBackendId } from "../components/smart-lights/backendRegistry";

// Volet affiché.
type Pane = "inventory" | "lights";
// Filtre de marque appliqué au volet « Lampes ».
type BackendFilter = SmartLightBackendId | "all";

export const NetworkPage = () => {
  const [pane, setPane] = useState<Pane>("inventory");
  const [backend, setBackend] = useState<BackendFilter>("all");

  return (
    <>
      <div className="section-title">
        <h2>Réseau</h2>
        <span className="muted">Découverte, appairage et pilotage des appareils du LAN</span>
      </div>

      <div className="filter-pills" role="tablist" aria-label="Volet de la vue Réseau">
        <button
          type="button"
          role="tab"
          aria-selected={pane === "inventory"}
          className={`pill pill-with-icon ${pane === "inventory" ? "pill-active" : ""}`}
          onClick={() => setPane("inventory")}
        >
          <Boxes size={14} strokeWidth={2} aria-hidden="true" />
          <span>Inventaire</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "lights"}
          className={`pill pill-with-icon ${pane === "lights" ? "pill-active" : ""}`}
          onClick={() => setPane("lights")}
        >
          <Lightbulb size={14} strokeWidth={2} aria-hidden="true" />
          <span>Lampes connectées</span>
        </button>
      </div>

      {pane === "inventory" ? (
        <DeviceInventory />
      ) : (
        <>
          {/* Filtre par marque : une pastille par backend déclaré au registre. */}
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
      )}
    </>
  );
};
