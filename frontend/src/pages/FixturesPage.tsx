import { FixtureForm } from "../components/FixtureForm";
import { FixturesTable } from "../components/FixturesTable";
import { QxfLibraryPanel } from "../components/QxfLibraryPanel";
import { useAppData } from "../contexts/AppDataContext";

export const FixturesPage = () => {
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
        <div className="card">
          <h2>Ajouter un projecteur</h2>
          <FixtureForm
            onSubmit={handleCreateFixture}
            isLoading={createFixture.isLoading}
            error={createFixture.error as Error | null | undefined}
          />
        </div>

        <QxfLibraryPanel
          libraryItems={library}
          isLoading={libraryLoading}
          error={libraryError ?? undefined}
          onRefresh={handleRefreshLibrary}
          refreshing={refreshLibrary.isLoading}
          onImport={handleImportFixture}
          importLoading={importFromLibrary.isLoading}
        />

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
