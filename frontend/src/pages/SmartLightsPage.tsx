// Page "Lampes connectees" (smart lights) de l'onglet dedie.
// Affiche une barre de filtres par backend (Nanoleaf, Hue, Matter...) puis
// delegue tout l'affichage et le pilotage au composant SmartLightsPanel.
import { useState } from "react";
import { SmartLightsPanel } from "../components/SmartLightsPanel";
import { SMART_LIGHT_BACKENDS, SmartLightBackendId } from "../components/smart-lights/backendRegistry";

// Valeur du filtre actif : un id de backend precis, ou "all" pour tout afficher.
type Filter = SmartLightBackendId | "all";

export const SmartLightsPage = () => {
  // Filtre courant ; "all" par defaut pour montrer toutes les lampes au depart.
  const [filter, setFilter] = useState<Filter>("all");

  return (
    <>
      <div className="section-title">
        <h2>Lampes connectées</h2>
        <span className="muted">
          Nanoleaf et autres lampes WiFi pilotées par LightBridge — extensible aux ampoules Hue / Matter
        </span>
      </div>

      {/* Barre de pastilles (pills) servant d'onglets de filtre. Un bouton "Tous"
          plus une pastille par backend declare dans le registre. */}
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
        {/* Une pastille par backend connu : icone + libelle, info-bulle = description. */}
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

      {/* Panneau qui liste et pilote les lampes ; on lui passe le filtre choisi.
          hideSectionTitle car le titre est deja affiche plus haut sur cette page. */}
      <SmartLightsPanel backendFilter={filter} hideSectionTitle />
    </>
  );
};
