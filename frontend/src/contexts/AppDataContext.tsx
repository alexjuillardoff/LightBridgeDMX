import {
  Dispatch,
  ReactNode,
  SetStateAction,
  createContext,
  useCallback,
  useContext,
  useMemo
} from "react";
import { UseMutationResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fixture, QxfLibraryFixture, Scene, SmartLight } from "@lightbridgedmx/shared";
import { HomeKitStatus, api } from "../lib/api";
import { buildFixtureColors } from "../lib/fixtures";
import { clamp } from "../lib/math";
import { LogEntry, useDmxWebsocket } from "../hooks/useDmxWebsocket";
import { UniverseStateProvider } from "./UniverseStateContext";

type SetChannelInput = { channel: number; value: number };

type Mutations = {
  createFixture: UseMutationResult<Fixture, Error, unknown>;
  importFromLibrary: UseMutationResult<Fixture, Error, unknown>;
  deleteFixture: UseMutationResult<unknown, Error, Fixture>;
  refreshLibrary: UseMutationResult<unknown, Error, void>;
  setChannel: UseMutationResult<unknown, Error, SetChannelInput>;
};

type AppData = {
  fixtures: Fixture[];
  fixturesLoading: boolean;
  fixtureColors: ReturnType<typeof buildFixtureColors>;
  scenes: Scene[];
  scenesLoading: boolean;
  library: QxfLibraryFixture[];
  libraryLoading: boolean;
  libraryError?: Error | null;
  homekitStatus?: HomeKitStatus;
  homekitStatusLoading: boolean;
  homekitStatusError?: Error | null;
  homekitFixtureIds: Set<string>;
  wsStatus: "connecting" | "open" | "closed";
  wsBadge: string;
  logMessage: string;
  logHistory: LogEntry[];
  setLogMessage: Dispatch<SetStateAction<string>>;
  mutations: Mutations;
  handleCreateFixture: (payload: unknown) => Promise<void>;
  handleImportFixture: (payload: unknown) => Promise<Fixture>;
  handleDeleteFixture: (fixture: Fixture) => Promise<void>;
  handleRefreshLibrary: () => Promise<void>;
  handleUpdateChannel: (channel: number, value: number) => void;
  handleBlackout: () => Promise<void>;
};

const AppDataCtx = createContext<AppData | null>(null);

export const AppDataProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();

  const upsertFixture = useCallback(
    (fixture: Fixture) => {
      queryClient.setQueryData<Fixture[]>(["fixtures"], (prev = []) => {
        const idx = prev.findIndex((f) => f.id === fixture.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = fixture;
          return next;
        }
        return [...prev, fixture];
      });
    },
    [queryClient]
  );

  const upsertSmartLight = useCallback(
    (light: SmartLight) => {
      queryClient.setQueryData<SmartLight[]>(["smart-lights"], (prev = []) => {
        const idx = prev.findIndex((l) => l.id === light.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = light;
          return next;
        }
        return [...prev, light];
      });
    },
    [queryClient]
  );

  const wsHandlers = useMemo(
    () => ({ onFixtureUpdated: upsertFixture, onSmartLightUpdated: upsertSmartLight }),
    [upsertFixture, upsertSmartLight]
  );

  const fixturesQuery = useQuery<Fixture[]>(["fixtures"], api.fixtures.list);
  const scenesQuery = useQuery<Scene[]>(["scenes"], api.scenes.list);
  const libraryQuery = useQuery<QxfLibraryFixture[]>(["qxf", "library"], api.qxf.library);
  const homekitStatusQuery = useQuery<HomeKitStatus>(["homekit", "status"], api.homekit.status);

  const { universeState, setUniverseState, wsStatus, logMessage, setLogMessage, logHistory } =
    useDmxWebsocket(wsHandlers);

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

  const setChannel = useMutation<unknown, Error, SetChannelInput>(({ channel, value }) =>
    api.universe.setChannel(channel, value)
  );

  const deleteFixture = useMutation<unknown, Error, Fixture>(
    (fixture: Fixture) => api.fixtures.delete(fixture.id),
    {
      onSuccess: (_, fixture) => {
        queryClient.setQueryData<Fixture[]>(["fixtures"], (prev = []) =>
          prev.filter((f) => f.id !== fixture.id)
        );
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

  const refreshLibrary = useMutation<unknown, Error, void>(() => api.qxf.refresh(), {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["qxf", "library"] });
    }
  });

  const fixtures = fixturesQuery.data ?? [];
  const fixtureColors = useMemo(() => buildFixtureColors(fixtures), [fixtures]);
  const homekitFixtureIds = useMemo(
    () => new Set(homekitStatusQuery.data?.fixtures.map((f) => f.fixtureId) ?? []),
    [homekitStatusQuery.data]
  );
  const wsBadge =
    wsStatus === "open" ? "Connected" : wsStatus === "connecting" ? "Connecting" : "Disconnected";

  const handleCreateFixture = useCallback(
    async (payload: unknown) => {
      await createFixture.mutateAsync(payload);
    },
    [createFixture]
  );

  const handleImportFixture = useCallback(
    (payload: unknown) => importFromLibrary.mutateAsync(payload),
    [importFromLibrary]
  );

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

  const handleRefreshLibrary = useCallback(async () => {
    await refreshLibrary.mutateAsync();
    void queryClient.invalidateQueries({ queryKey: ["qxf", "library"] });
  }, [queryClient, refreshLibrary]);

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

  const handleBlackout = useCallback(async () => {
    setUniverseState((prev) => {
      if (!prev) return prev;
      return { ...prev, values: new Array(prev.values.length).fill(0) };
    });
    const tasks: Promise<unknown>[] = [];
    for (let ch = 1; ch <= 512; ch++) {
      tasks.push(setChannel.mutateAsync({ channel: ch, value: 0 }));
    }
    await Promise.allSettled(tasks);
    setLogMessage("Blackout : tous les canaux remis à 0");
  }, [setChannel, setLogMessage, setUniverseState]);

  const value = useMemo<AppData>(
    () => ({
      fixtures,
      fixturesLoading: fixturesQuery.isLoading,
      fixtureColors,
      scenes: scenesQuery.data ?? [],
      scenesLoading: scenesQuery.isLoading,
      library: libraryQuery.data ?? [],
      libraryLoading: libraryQuery.isLoading,
      libraryError: (libraryQuery.error as Error | null | undefined) ?? null,
      homekitStatus: homekitStatusQuery.data,
      homekitStatusLoading: homekitStatusQuery.isLoading,
      homekitStatusError: (homekitStatusQuery.error as Error | null | undefined) ?? null,
      homekitFixtureIds,
      wsStatus,
      wsBadge,
      logMessage,
      logHistory,
      setLogMessage,
      mutations: { createFixture, importFromLibrary, deleteFixture, refreshLibrary, setChannel },
      handleCreateFixture,
      handleImportFixture,
      handleDeleteFixture,
      handleRefreshLibrary,
      handleUpdateChannel,
      handleBlackout
    }),
    [
      fixtures,
      fixturesQuery.isLoading,
      fixtureColors,
      scenesQuery.data,
      scenesQuery.isLoading,
      libraryQuery.data,
      libraryQuery.isLoading,
      libraryQuery.error,
      homekitStatusQuery.data,
      homekitStatusQuery.isLoading,
      homekitStatusQuery.error,
      homekitFixtureIds,
      wsStatus,
      wsBadge,
      logMessage,
      logHistory,
      setLogMessage,
      createFixture,
      importFromLibrary,
      deleteFixture,
      refreshLibrary,
      setChannel,
      handleCreateFixture,
      handleImportFixture,
      handleDeleteFixture,
      handleRefreshLibrary,
      handleUpdateChannel,
      handleBlackout
    ]
  );

  return (
    <AppDataCtx.Provider value={value}>
      <UniverseStateProvider universeState={universeState} setUniverseState={setUniverseState}>
        {children}
      </UniverseStateProvider>
    </AppDataCtx.Provider>
  );
};

export const useAppData = (): AppData => {
  const ctx = useContext(AppDataCtx);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
};
