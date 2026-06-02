// Page "Projecteurs" (onglet projecteurs).
// Regroupe la gestion des projecteurs (fixtures) DMX :
//  - formulaire d'ajout manuel,
//  - import depuis la bibliotheque QLC+ (fichiers QXF),
//  - tableau des projecteurs enregistres.
// Toutes les donnees et actions viennent du contexte global useAppData.
import { FixtureForm } from "../components/FixtureForm";
import { FixturesTable } from "../components/FixturesTable";
import { QxfLibraryPanel } from "../components/QxfLibraryPanel";
import { useAppData } from "../contexts/AppDataContext";

export const FixturesPage = () => {
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
        <h2>Projecteurs DMX</h2>
        <span className="muted">Gestion des projecteurs DMX et import depuis la bibliothèque QLC+</span>
      </div>
      <div className="grid">
        {/* Carte 1 : ajout manuel d'un projecteur (adresse, mode, canaux...) */}
        <div className="card">
          <h2>Ajouter un projecteur</h2>
          <FixtureForm
            onSubmit={handleCreateFixture}
            isLoading={createFixture.isLoading}
            error={createFixture.error as Error | null | undefined}
          />
        </div>

        {/* Carte 2 : bibliotheque QLC+ (QXF) — parcourir et importer un modele,
            avec bouton pour rafraichir la bibliotheque depuis GitHub. */}
        <QxfLibraryPanel
          libraryItems={library}
          isLoading={libraryLoading}
          error={libraryError ?? undefined}
          onRefresh={handleRefreshLibrary}
          refreshing={refreshLibrary.isLoading}
          onImport={handleImportFixture}
          importLoading={importFromLibrary.isLoading}
        />

        {/* Carte 3 (pleine largeur) : liste des projecteurs deja enregistres,
            avec etat HomeKit et suppression. */}
        <div className="card grid-span-full">
          <h2>Projecteurs enregistrés</h2>
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
      </div>
    </>
  );
};
