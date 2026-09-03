// Vue "Patch" : tout ce qui definit le plateau avant de jouer.
// Regroupe la gestion des projecteurs (fixtures) DMX :
//  - formulaire d'ajout manuel,
//  - import depuis la bibliotheque QLC+ (fichiers QXF),
//  - tableau des projecteurs enregistres.
// Toutes les donnees et actions viennent du contexte global useAppData.
import { FixtureForm } from "../components/FixtureForm";
import { FixturesTable } from "../components/FixturesTable";
import { QxfLibraryPanel } from "../components/QxfLibraryPanel";
import { useAppData } from "../contexts/AppDataContext";

export const PatchPage = () => {
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

  return (
    <>
      <div className="section-title">
        <h2>Patch</h2>
        <span className="muted">
          {fixtures.length} projecteur(s) patché(s) · adressage DMX et import depuis la bibliothèque QLC+
        </span>
      </div>
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
    </>
  );
};
