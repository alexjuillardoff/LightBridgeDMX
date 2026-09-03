// Vue "Patch" : tout ce qui definit le plateau avant de jouer.
//
// Elle repond a une seule question — « de quoi est fait le plateau ? » — pour
// les deux familles d'appareils, cablees et sans fil, en trois volets :
//
//   Projecteurs — le patch DMX : ajout manuel, import QXF, table des adresses ;
//   Inventaire  — ce que le LAN expose, pilotable ou non, avec la raison ;
//   Lampes      — le pilotage fin de ce qui a ete appaire (couleurs, zones,
//                 effets, layout 3D, miroir DMX).
//
// Les volets « Inventaire » et « Lampes » venaient d'un onglet « Réseau »
// separe : on decouvrait une Nanoleaf ici, on l'appairait la, et il fallait
// encore changer d'onglet pour lui donner une adresse DMX. Un meme geste,
// trois allers-retours. Leurs anciens liens (#reseau, #appareils, #lampes)
// arrivent maintenant directement sur le bon volet.
//
// Le volet actif vient du hash de l'URL (#patch, #patch/inventaire,
// #patch/lampes) et non d'un etat local : un lien partage rouvre le bon volet.
import { DeviceInventory } from "../components/DeviceInventory";
import { FixtureForm } from "../components/FixtureForm";
import { FixturesTable } from "../components/FixturesTable";
import { QxfLibraryPanel } from "../components/QxfLibraryPanel";
import { useAppData } from "../contexts/AppDataContext";
import { DEFAULT_PATCH_PANE, PATCH_PANES, PatchPaneId } from "../shell/tabs";
import { SmartLightsPane } from "./patch/SmartLightsPane";

type PatchPageProps = {
  // Volet affiche, resolu depuis le hash de l'URL par le shell.
  pane?: PatchPaneId;
  // Demande l'ouverture d'un autre volet (le shell reecrit le hash).
  onPaneChange: (next: PatchPaneId) => void;
};

export const PatchPage = ({ pane = DEFAULT_PATCH_PANE, onPaneChange }: PatchPageProps) => {
  // On recupere du contexte les donnees a afficher (projecteurs, bibliotheque,
  // etat HomeKit) ainsi que les handlers branches sur les mutations (create,
  // import, delete, refresh) qui gerent leur etat de chargement/erreur.
  const {
    fixtures,
    library,
    libraryLoading,
    libraryError,
    homekitFixtureIds,
    homekitStatus,
    mutations: { createFixture, importFromLibrary, deleteFixture, refreshLibrary },
    handleCreateFixture,
    handleImportFixture,
    handleDeleteFixture,
    handleRefreshLibrary
  } = useAppData();

  // Sous-titre : le compte des projecteurs patches reste utile depuis n'importe
  // quel volet (c'est lui qu'on vient verifier), suivi de ce que fait le volet.
  const paneDef = PATCH_PANES.find((p) => p.id === pane);

  return (
    <>
      <div className="section-title">
        <h2>Patch</h2>
        <span className="muted">
          {fixtures.length} projecteur(s) patché(s) · {paneDef?.subtitle}
        </span>
      </div>

      <div className="filter-pills" role="tablist" aria-label="Volet de la vue Patch">
        {PATCH_PANES.map((p) => {
          const Icon = p.icon;
          const isActive = p.id === pane;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`pill pill-with-icon ${isActive ? "pill-active" : ""}`}
              onClick={() => onPaneChange(p.id)}
            >
              <Icon size={14} strokeWidth={2} aria-hidden="true" />
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      {pane === "inventaire" && <DeviceInventory />}

      {pane === "lampes" && <SmartLightsPane />}

      {pane === "projecteurs" && (
        <div className="grid">
          {/* Le patch existant vient EN PREMIER : neuf fois sur dix on ouvre cette
              vue pour vérifier une adresse, pas pour ajouter un projecteur. */}
          <div className="card grid-span-full">
            <h2>Projecteurs patchés</h2>
            <FixturesTable
              fixtures={fixtures}
              onDelete={handleDeleteFixture}
              isDeleting={deleteFixture.isLoading}
              deletingId={deleteFixture.variables?.id}
              error={deleteFixture.error as Error | null | undefined}
              homekitFixtureIds={homekitFixtureIds}
              homekitEnabled={homekitStatus?.enabled ?? false}
            />
          </div>

          {/* Ajout manuel d'un projecteur (adresse, mode, canaux...). */}
          <div className="card">
            <h2>Ajouter un projecteur</h2>
            <FixtureForm
              onSubmit={handleCreateFixture}
              isLoading={createFixture.isLoading}
              error={createFixture.error as Error | null | undefined}
            />
          </div>

          {/* Bibliotheque QLC+ (QXF) — parcourir et importer un modele, avec
              bouton pour rafraichir la bibliotheque depuis GitHub. */}
          <QxfLibraryPanel
            libraryItems={library}
            isLoading={libraryLoading}
            error={libraryError ?? undefined}
            onRefresh={handleRefreshLibrary}
            refreshing={refreshLibrary.isLoading}
            onImport={handleImportFixture}
            importLoading={importFromLibrary.isLoading}
          />
        </div>
      )}
    </>
  );
};
