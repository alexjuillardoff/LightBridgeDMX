import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fixture, QxfLibraryFixture, Scene, SmartLight } from "@lightbridgedmx/shared";
import { ChannelGrid } from "./components/ChannelGrid";
import { DancePanel } from "./components/DancePanel";
import { FixtureForm } from "./components/FixtureForm";
import { FixturesTable } from "./components/FixturesTable";
import { HomeKitCard } from "./components/HomeKitCard";
import { Header } from "./components/Header";
import { QxfLibraryPanel } from "./components/QxfLibraryPanel";
import { ScenesSection } from "./components/ScenesSection";
import { SmartLightsPanel } from "./components/SmartLightsPanel";
import { StatusCards } from "./components/StatusCards";
import { useDmxWebsocket } from "./hooks/useDmxWebsocket";
import { HomeKitStatus, api } from "./lib/api";
import { buildFixtureColors, countActiveChannels } from "./lib/fixtures";
import { clamp } from "./lib/math";

function App() {
  const queryClient = useQueryClient();
  const upsertFixture = useCallback((fixture: Fixture) => {
    queryClient.setQueryData<Fixture[]>(["fixtures"], (prev = []) => {
      const idx = prev.findIndex((f) => f.id === fixture.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = fixture;
        return next;
      }
      return [...prev, fixture];
    });
  }, [queryClient]);

  const upsertSmartLight = useCallback((light: SmartLight) => {
    queryClient.setQueryData<SmartLight[]>(["smart-lights"], (prev = []) => {
      const idx = prev.findIndex((l) => l.id === light.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = light;
        return next;
      }
      return [...prev, light];
    });
  }, [queryClient]);

  const wsHandlers = useMemo(
    () => ({ onFixtureUpdated: upsertFixture, onSmartLightUpdated: upsertSmartLight }),
    [upsertFixture, upsertSmartLight]
  );

  const fixturesQuery = useQuery<Fixture[]>(["fixtures"], api.fixtures.list);
  const scenesQuery = useQuery<Scene[]>(["scenes"], api.scenes.list);
  const libraryQuery = useQuery<QxfLibraryFixture[]>(["qxf", "library"], api.qxf.library);
  const homekitStatusQuery = useQuery<HomeKitStatus>(["homekit", "status"], api.homekit.status);

  const { universeState, setUniverseState, wsStatus, logMessage, setLogMessage } = useDmxWebsocket(wsHandlers);

  const createFixture = useMutation<Fixture, Error, unknown>(
    (body: unknown) => api.fixtures.create(body),
    {
      onSuccess: (fixture) => {
        upsertFixture(fixture);
        void queryClient.invalidateQueries({ queryKey: ["homekit", "status"] });
      }
    }
  );

  const importFromLibrary = useMutation<Fixture, Error, unknown>(
    (body: unknown) => api.fixtures.importQxfLibrary(body),
    {
      onSuccess: (fixture) => {
        upsertFixture(fixture);
        void queryClient.invalidateQueries({ queryKey: ["homekit", "status"] });
      }
    }
  );

  const deleteFixture = useMutation<unknown, Error, Fixture>(
    (fixture: Fixture) => api.fixtures.delete(fixture.id),
    {
      onSuccess: (_, fixture) => {
        queryClient.setQueryData<Fixture[]>(["fixtures"], (prev = []) => prev.filter((f) => f.id !== fixture.id));
        setUniverseState((prev) => {
          if (!prev) return prev;
          const nextValues = [...prev.values];
          fixture.channels.forEach((ch) => {
            const absolute = fixture.address + ch.channel - 1;
            if (absolute >= 1 && absolute <= nextValues.length) {
              nextValues[absolute - 1] = 0;
            }
          });
          return { ...prev, values: nextValues };
        });
        fixture.channels.forEach((ch) => {
          const absolute = fixture.address + ch.channel - 1;
          if (absolute >= 1 && absolute <= 512) {
            setChannel.mutate({ channel: absolute, value: 0 });
          }
        });
        void queryClient.invalidateQueries({ queryKey: ["homekit", "status"] });
      }
    }
  );

  const refreshLibrary = useMutation<unknown, Error, void>(
    () => api.qxf.refresh(),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["qxf", "library"] });
      }
    }
  );

  const setChannel = useMutation<unknown, Error, { channel: number; value: number }>(
    ({ channel, value }: { channel: number; value: number }) => api.universe.setChannel(channel, value)
  );

  const fixtures = fixturesQuery.data ?? [];
  const fixtureColors = useMemo(() => buildFixtureColors(fixturesQuery.data ?? []), [fixturesQuery.data]);
  const activeChannels = useMemo(() => countActiveChannels(universeState), [universeState]);
  const homekitFixtureIds = useMemo(
    () => new Set(homekitStatusQuery.data?.fixtures.map((f) => f.fixtureId) ?? []),
    [homekitStatusQuery.data]
  );
  const wsBadge = wsStatus === "open" ? "Connected" : wsStatus === "connecting" ? "Connecting" : "Disconnected";

  const handleDeleteFixture = useCallback(
    async (fixture: Fixture) => {
      const confirmed = window.confirm(`Supprimer ${fixture.name} ?`);
      if (!confirmed) return;
      try {
        await deleteFixture.mutateAsync(fixture);
      } catch (err) {
        setLogMessage((err as Error).message);
      }
    },
    [deleteFixture, setLogMessage]
  );

  const handleUpdateChannel = useCallback(
    (channel: number, value: number) => {
      const clamped = clamp(value, 0, 255);
      setUniverseState((prev) => {
        if (!prev) return prev;
        const nextValues = [...prev.values];
        nextValues[channel - 1] = clamped;
        return { ...prev, values: nextValues };
      });
      setChannel.mutate({ channel, value: clamped });
    },
    [setChannel, setUniverseState]
  );

  const handleCreateFixture = useCallback(
    async (payload: unknown) => {
      await createFixture.mutateAsync(payload);
    },
    [createFixture]
  );

  const handleImportFixture = useCallback(
    async (payload: unknown) => importFromLibrary.mutateAsync(payload),
    [importFromLibrary]
  );

  const handleRefreshLibrary = useCallback(async () => {
    await refreshLibrary.mutateAsync();
    void queryClient.invalidateQueries({ queryKey: ["qxf", "library"] });
  }, [refreshLibrary, queryClient]);

  return (
    <main>
      <Header wsBadge={wsBadge} />

      <StatusCards
        universeState={universeState}
        activeChannels={activeChannels}
        fixturesCount={fixturesQuery.data?.length ?? 0}
        scenesCount={scenesQuery.data?.length ?? 0}
        log={logMessage}
      />

      <div className="section-title">
        <h2>Fixtures</h2>
        <span className="muted">DMX device registry</span>
      </div>
      <div className="grid">
        <div className="card">
          <h2>Add fixture</h2>
          <FixtureForm onSubmit={handleCreateFixture} isLoading={createFixture.isLoading} error={createFixture.error as Error | null | undefined} />
        </div>

        <QxfLibraryPanel
          libraryItems={libraryQuery.data ?? []}
          isLoading={libraryQuery.isLoading}
          error={libraryQuery.error as Error | null | undefined}
          onRefresh={handleRefreshLibrary}
          refreshing={refreshLibrary.isLoading}
          onImport={handleImportFixture}
          importLoading={importFromLibrary.isLoading}
        />

        <HomeKitCard
          status={homekitStatusQuery.data}
          isLoading={homekitStatusQuery.isLoading}
          error={homekitStatusQuery.error as Error | null | undefined}
        />

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Registered fixtures</h2>
          <FixturesTable
            fixtures={fixtures}
            onDelete={handleDeleteFixture}
            isDeleting={deleteFixture.isLoading}
            deletingId={deleteFixture.variables?.id}
            error={deleteFixture.error as Error | null | undefined}
            homekitFixtureIds={homekitFixtureIds}
            homekitEnabled={homekitStatusQuery.data?.enabled ?? false}
          />
        </div>
      </div>

      <SmartLightsPanel />

      <div className="section-title">
        <h2>Mode Dance</h2>
        <span className="muted">Strobe coordonné par pièce avec patterns spatiaux</span>
      </div>
      <div className="grid">
        <DancePanel />
      </div>

      <ChannelGrid
        universeState={universeState}
        fixtures={fixtures}
        fixtureColors={fixtureColors}
        onUpdate={handleUpdateChannel}
        error={setChannel.error as Error | null | undefined}
      />

      <div className="section-title">
        <h2>Scenes</h2>
        <span className="muted">Planned: capture and recall show cues</span>
      </div>
      <ScenesSection scenes={scenesQuery.data} />
    </main>
  );
}

export default App;
