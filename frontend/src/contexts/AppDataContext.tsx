// Contexte React central de l'application (frontend).
// Regroupe et expose en un seul endroit : la liste des projecteurs (fixtures), des scenes,
// la bibliotheque QXF, le statut HomeKit, l'etat du WebSocket DMX et les actions courantes
// (creer/supprimer un projecteur, regler un canal, blackout...).
// Les composants consomment tout cela via le hook useAppData().
import {
  Dispatch,
  ReactNode,
  SetStateAction,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef
} from "react";
import { UseMutationResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fixture, QxfLibraryFixture, Scene, SmartLight } from "@lightbridgedmx/shared";
import { HomeKitStatus, api } from "../lib/api";
import { buildFixtureColors } from "../lib/fixtures";
import { withoutHiddenFixtures } from "../lib/hiddenFixtures";
import { clamp } from "../lib/math";
import { LogEntry, useDmxWebsocket } from "../hooks/useDmxWebsocket";
import { UniverseStateProvider } from "./UniverseStateContext";

// Cadence de vidage du tampon de canaux DMX, en millisecondes. 40 ms = 25 envois
// par seconde : bien au-dela de ce que l'oeil distingue sur un fondu, et tres en
// dessous du debit qui saturait les connexions du navigateur.
const CHANNEL_FLUSH_MS = 40;

// Entree d'une mutation "regler un canal" : numero de canal DMX + valeur 0-255.
type SetChannelInput = { channel: number; value: number };

// Regroupe les mutations React Query exposees aux composants (creation, import, etc.).
type Mutations = {
  createFixture: UseMutationResult<Fixture, Error, unknown>;
  importFromLibrary: UseMutationResult<Fixture, Error, unknown>;
  deleteFixture: UseMutationResult<unknown, Error, Fixture>;
  refreshLibrary: UseMutationResult<unknown, Error, void>;
  setChannel: UseMutationResult<unknown, Error, SetChannelInput>;
};

// Forme complete des donnees et actions partagees par le contexte.
// C'est le "contrat" que useAppData() renvoie aux composants.
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

// Fournisseur (provider) du contexte : a placer haut dans l'arbre React.
// Il met en place les requetes React Query, le WebSocket DMX et les mutations,
// puis distribue le tout via AppDataCtx + UniverseStateProvider.
export const AppDataProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();

  // Insere ou met a jour (upsert) un projecteur dans le cache React Query.
  // Utilise pour appliquer en local les mises a jour recues par WebSocket sans recharger.
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

  // Meme principe que upsertFixture, mais pour une lampe connectee (smart light).
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

  // Gestionnaires (handlers) branches sur le WebSocket : quand le backend pousse une
  // mise a jour, on rafraichit directement le cache local au lieu de recharger via HTTP.
  const wsHandlers = useMemo(
    () => ({ onFixtureUpdated: upsertFixture, onSmartLightUpdated: upsertSmartLight }),
    [upsertFixture, upsertSmartLight]
  );

  // Requetes de chargement initial : projecteurs, scenes, bibliotheque QXF, statut HomeKit.
  const fixturesQuery = useQuery<Fixture[]>(["fixtures"], api.fixtures.list);
  const scenesQuery = useQuery<Scene[]>(["scenes"], api.scenes.list);
  const libraryQuery = useQuery<QxfLibraryFixture[]>(["qxf", "library"], api.qxf.library);
  const homekitStatusQuery = useQuery<HomeKitStatus>(["homekit", "status"], api.homekit.status);

  // Connexion WebSocket DMX : fournit l'etat live de l'univers (les 512 canaux),
  // le statut de connexion et le journal de messages.
  const { universeState, setUniverseState, wsStatus, logMessage, setLogMessage, logHistory } =
    useDmxWebsocket(wsHandlers);

  // Creation d'un projecteur. En cas de succes, on l'ajoute au cache et on invalide
  // le statut HomeKit (un nouveau projecteur peut apparaitre comme accessoire HomeKit).
  const createFixture = useMutation<Fixture, Error, unknown>(
    (body: unknown) => api.fixtures.create(body),
    {
      onSuccess: (fixture) => {
        upsertFixture(fixture);
        void queryClient.invalidateQueries({ queryKey: ["homekit", "status"] });
      }
    }
  );

  // Import d'un projecteur depuis la bibliotheque QXF (modeles QLC+). Meme suivi que createFixture.
  const importFromLibrary = useMutation<Fixture, Error, unknown>(
    (body: unknown) => api.fixtures.importQxfLibrary(body),
    {
      onSuccess: (fixture) => {
        upsertFixture(fixture);
        void queryClient.invalidateQueries({ queryKey: ["homekit", "status"] });
      }
    }
  );

  // Mutation bas niveau : pousse une valeur de canal vers le backend (univers DMX).
  const setChannel = useMutation<unknown, Error, SetChannelInput>(({ channel, value }) =>
    api.universe.setChannel(channel, value)
  );

  // Suppression d'un projecteur. Au succes, on nettoie tout : cache, etat local de l'univers
  // et canaux physiques (remis a 0) pour ne pas laisser le projecteur supprime allume.
  const deleteFixture = useMutation<unknown, Error, Fixture>(
    (fixture: Fixture) => api.fixtures.delete(fixture.id),
    {
      onSuccess: (_, fixture) => {
        queryClient.setQueryData<Fixture[]>(["fixtures"], (prev = []) =>
          prev.filter((f) => f.id !== fixture.id)
        );
        // Met d'abord a 0 les canaux du projecteur dans l'etat local (affichage immediat).
        // Canal absolu = adresse de depart du projecteur + canal relatif - 1.
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
        // Puis pousse reellement ces 0 vers le backend pour eteindre le projecteur cote materiel.
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

  // Rafraichit la bibliotheque QXF (re-telecharge/relit les modeles) puis invalide le cache.
  const refreshLibrary = useMutation<unknown, Error, void>(() => api.qxf.refresh(), {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["qxf", "library"] });
    }
  });

  // ----- Valeurs derivees (recalculees a partir des requetes) -----
  // Les projecteurs masques (lib/hiddenFixtures) sont retires ici : tout ce qui
  // consomme useAppData() ne les voit donc jamais.
  const fixtures = useMemo(
    () => withoutHiddenFixtures(fixturesQuery.data ?? []),
    [fixturesQuery.data]
  );
  // Couleurs d'affichage de chaque projecteur, derivees de ses capabilities r/g/b.
  const fixtureColors = useMemo(() => buildFixtureColors(fixtures), [fixtures]);
  // Ensemble des IDs de projecteurs exposes comme accessoires HomeKit (pour pastiller l'UI).
  const homekitFixtureIds = useMemo(
    () => new Set(homekitStatusQuery.data?.fixtures.map((f) => f.fixtureId) ?? []),
    [homekitStatusQuery.data]
  );
  // Libelle court de l'etat WebSocket affiche dans la barre du haut.
  const wsBadge =
    wsStatus === "open" ? "Connected" : wsStatus === "connecting" ? "Connecting" : "Disconnected";

  // ----- Actions de haut niveau exposees a l'UI (wrappers autour des mutations) -----

  // Cree un projecteur a partir du contenu (payload) du formulaire.
  const handleCreateFixture = useCallback(
    async (payload: unknown) => {
      await createFixture.mutateAsync(payload);
    },
    [createFixture]
  );

  // Importe un projecteur depuis la bibliotheque QXF.
  const handleImportFixture = useCallback(
    (payload: unknown) => importFromLibrary.mutateAsync(payload),
    [importFromLibrary]
  );

  // Supprime un projecteur apres confirmation de l'utilisateur.
  // En cas d'erreur, on l'affiche dans le journal plutot que de la laisser remonter.
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

  // Relance le rafraichissement de la bibliotheque QXF (action rapide du tableau de bord).
  const handleRefreshLibrary = useCallback(async () => {
    await refreshLibrary.mutateAsync();
    void queryClient.invalidateQueries({ queryKey: ["qxf", "library"] });
  }, [queryClient, refreshLibrary]);

  // Regle un canal depuis un curseur (slider) de la console.
  // On borne (clamp) la valeur a 0-255, on met a jour l'affichage tout de suite,
  // puis on pousse la valeur au backend (mise a jour optimiste pour un retour instantane).
  // ── Regroupement des ecritures de canaux ────────────────────────────────
  // Un glissement de fader emet ~60 evenements par seconde. Envoyer un POST par
  // evenement saturait les ~6 connexions HTTP que le navigateur accorde par
  // origine : la position FINALE du curseur partait en dernier, coincee derriere
  // des dizaines de requetes deja perimees. D'ou une console qui repond mal,
  // surtout en bougeant plusieurs curseurs a la fois.
  //
  // On accumule donc les changements dans une table { canal -> derniere valeur } et
  // on la vide a cadence fixe en UNE requete groupee. L'etat local, lui, est mis a
  // jour immediatement : le curseur reste parfaitement fluide a l'ecran.
  const pendingChannels = useRef<Map<number, number>>(new Map());
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const flushChannels = useCallback(() => {
    if (pendingChannels.current.size === 0) {
      // Plus rien a envoyer : on arrete le minuteur plutot que de tourner a vide.
      if (flushTimer.current) {
        clearInterval(flushTimer.current);
        flushTimer.current = null;
      }
      return;
    }
    const batch = Object.fromEntries(pendingChannels.current);
    pendingChannels.current.clear();
    void api.universe.setMany(batch).catch((err) => {
      setLogMessage(`Écriture DMX échouée : ${(err as Error).message}`);
    });
  }, [setLogMessage]);

  const handleUpdateChannel = useCallback(
    (channel: number, value: number) => {
      const clamped = clamp(value, 0, 255);
      setUniverseState((prev) => {
        if (!prev) return prev;
        const nextValues = [...prev.values];
        nextValues[channel - 1] = clamped;
        return { ...prev, values: clamped === prev.values[channel - 1] ? prev.values : nextValues };
      });
      // Seule la derniere valeur d'un canal survit dans le lot : les positions
      // intermediaires d'un glissement n'ont aucun interet une fois depassees.
      pendingChannels.current.set(channel, clamped);
      if (flushTimer.current === null) {
        flushChannels(); // premiere valeur envoyee tout de suite : pas de latence percue
        flushTimer.current = setInterval(flushChannels, CHANNEL_FLUSH_MS);
      }
    },
    [flushChannels, setUniverseState]
  );

  // Arret du minuteur au demontage, pour ne pas laisser d'intervalle orphelin.
  useEffect(() => () => {
    if (flushTimer.current) clearInterval(flushTimer.current);
  }, []);

  // Blackout (extinction totale) : remet a 0 les 512 canaux de l'univers DMX.
  // On vide d'abord l'etat local, puis on pousse 512 mises a 0 en parallele.
  // Promise.allSettled : on attend tout sans qu'un canal en echec bloque les autres.
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

  // Assemble l'objet final partage par le contexte. Memorise (useMemo) pour eviter
  // de recreer la reference a chaque rendu et de declencher des re-rendus inutiles chez les consommateurs.
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

// Hook d'acces au contexte. Garantit qu'on l'utilise bien sous un AppDataProvider :
// sinon ctx est null et on leve une erreur explicite (aide au debogage).
export const useAppData = (): AppData => {
  const ctx = useContext(AppDataCtx);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
};
