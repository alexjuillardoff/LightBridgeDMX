// Les « pools » du pupitre : groupes, executors, playbacks et presets.
//
// C'est la couche qui manquait. Le backend savait déjà enregistrer et rejouer
// une scène (`POST /api/scenes`, `POST /api/scenes/:id/activate`) et appliquer un
// preset, mais rien dans l'UI ne s'en servait : la rangée d'executors n'était
// qu'un décor. Ce contexte branche ces fonctions sur les gestes d'un pupitre :
//
//   STORE  — photographie le programmer dans une scène et l'affecte à un
//            emplacement d'executor numéroté ;
//   GO     — rejoue cet emplacement (côté backend, donc toutes les UI suivent) ;
//   OFF    — éteint uniquement ce que l'executor pilote ;
//   fader  — rejoue l'executor à un niveau intermédiaire (master d'intensité).
//
// Répartition de la persistance, volontaire :
//  - scènes et presets → backend (ils appartiennent au spectacle) ;
//  - numéro d'emplacement d'un executor, groupes → localStorage (ils appartiennent
//    au poste de travail). Voir lib/localStore.
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fixture, Preset, Scene } from "@lightbridgedmx/shared";
import { api } from "../lib/api";
import { ActionResult, fail, ok, warn } from "../lib/feedback";
import { isLockedFixture } from "../lib/fixtureGuard";
import { readLocal, writeLocal } from "../lib/localStore";
import { applySceneAtLevel, captureScene, fixtureSpan, sceneChannels } from "../lib/console/scenes";
import { useAppData } from "./AppDataContext";
import { useSelection } from "./SelectionContext";
import { useUniverseValuesRef } from "./UniverseStateContext";

// Un groupe de sélection, rappelable par son numéro (« Group 3 Please »).
export type ConsoleGroup = {
  id: string;
  number: number;
  name: string;
  fixtureIds: string[];
};

// Emplacements toujours dessinés dans le pool d'executors, occupés ou non.
export const EXEC_SLOTS = 12;
// Idem pour le pool de presets.
export const PRESET_SLOTS = 12;

type ConsoleValue = {
  // ─── Groupes ───────────────────────────────────────────────────────────
  groups: ConsoleGroup[];
  storeGroup: (number: number, name?: string) => ActionResult;
  recallGroup: (number: number) => ActionResult;
  renameGroup: (id: string, name: string) => void;
  deleteGroup: (id: string) => void;

  // ─── Executors ─────────────────────────────────────────────────────────
  // Scène occupant chaque emplacement, ou null. Longueur = EXEC_SLOTS au moins.
  executors: (Scene | null)[];
  // Niveau du fader master de chaque emplacement (0 → 1).
  levels: number[];
  storeExecutor: (slot: number, name?: string) => Promise<ActionResult>;
  goExecutor: (slot: number) => Promise<ActionResult>;
  offExecutor: (slot: number) => ActionResult;
  setLevel: (slot: number, level: number) => void;
  // Détache une scène de son emplacement (la scène reste enregistrée).
  releaseSlot: (slot: number) => void;
  // Supprime définitivement la scène occupant l'emplacement.
  deleteExecutor: (slot: number) => Promise<ActionResult>;
  // Affecte une scène existante à un emplacement.
  assignSlot: (slot: number, sceneId: string) => void;

  // ─── Presets ───────────────────────────────────────────────────────────
  presets: Preset[];
  storePreset: (slot: number, name?: string) => Promise<ActionResult>;
  applyPreset: (slot: number) => Promise<ActionResult>;

  // Vrai pendant un aller-retour réseau (STORE / GO), pour griser les tuiles.
  busy: boolean;
};

const ConsoleCtx = createContext<ConsoleValue | null>(null);

// Clés de persistance locale.
const GROUPS_KEY = "groups";
const SLOTS_KEY = "execSlots";

export const ConsoleProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const { fixtures, scenes, handleUpdateChannel } = useAppData();
  const { selectedIds, select } = useSelection();
  const valuesRef = useUniverseValuesRef();

  // ─── État persistant local ───────────────────────────────────────────────
  const [groups, setGroups] = useState<ConsoleGroup[]>(() => readLocal<ConsoleGroup[]>(GROUPS_KEY, []));
  // Affectation explicite emplacement → scène, écrite par STORE ou par un
  // glissement dans le pool.
  const [slotMap, setSlotMap] = useState<Record<string, string>>(() =>
    readLocal<Record<string, string>>(SLOTS_KEY, {})
  );
  const [levels, setLevels] = useState<number[]>(() => new Array(EXEC_SLOTS).fill(0));

  useEffect(() => writeLocal(GROUPS_KEY, groups), [groups]);
  useEffect(() => writeLocal(SLOTS_KEY, slotMap), [slotMap]);

  const presetsQuery = useQuery<Preset[]>(["presets"], api.presets.list);
  const presets = useMemo(() => presetsQuery.data ?? [], [presetsQuery.data]);

  // Index projecteur par id : utilisé par le rappel de scène (valeurs → canaux).
  const fixturesById = useMemo(() => new Map(fixtures.map((f) => [f.id, f])), [fixtures]);

  // Projecteurs actuellement dans le programmer, verrouillés exclus.
  const programmer = useMemo(
    () => fixtures.filter((f) => selectedIds.includes(f.id) && !isLockedFixture(f)),
    [fixtures, selectedIds]
  );

  // ─── Emplacements d'executors ────────────────────────────────────────────
  // On part des affectations explicites, puis on range les scènes orphelines
  // (créées ailleurs, ou stockées depuis un autre navigateur) dans les premiers
  // emplacements libres — pour qu'aucune scène ne reste invisible.
  const executors = useMemo(() => {
    const slots: (Scene | null)[] = new Array(EXEC_SLOTS).fill(null);
    const byId = new Map(scenes.map((s) => [s.id, s]));
    const placed = new Set<string>();

    Object.entries(slotMap).forEach(([slotStr, sceneId]) => {
      const slot = Number(slotStr);
      const scene = byId.get(sceneId);
      if (!scene || slot < 0) return;
      while (slots.length <= slot) slots.push(null);
      slots[slot] = scene;
      placed.add(sceneId);
    });

    scenes
      .filter((s) => !placed.has(s.id))
      .forEach((scene) => {
        const free = slots.findIndex((s) => s === null);
        if (free >= 0) slots[free] = scene;
        else slots.push(scene);
      });

    return slots;
  }, [scenes, slotMap]);

  // ─── Mutations réseau ────────────────────────────────────────────────────
  const createScene = useMutation(api.scenes.create, {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scenes"] })
  });
  const activateScene = useMutation((id: string) => api.scenes.activate(id));
  const removeScene = useMutation((id: string) => api.scenes.delete(id), {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scenes"] })
  });
  const createPreset = useMutation(api.presets.create, {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["presets"] })
  });
  const runPreset = useMutation((id: string) => api.presets.apply(id));

  const busy =
    createScene.isLoading ||
    activateScene.isLoading ||
    removeScene.isLoading ||
    createPreset.isLoading ||
    runPreset.isLoading;

  // ─── Groupes ─────────────────────────────────────────────────────────────

  const storeGroup = useCallback(
    (number: number, name?: string): ActionResult => {
      if (!programmer.length) {
        return warn("Sélection vide — sélectionnez des projecteurs avant STORE GROUP");
      }
      const label = name?.trim() || `Groupe ${number}`;
      const entry: ConsoleGroup = {
        id: `g${number}`,
        number,
        name: label,
        fixtureIds: programmer.map((f) => f.id)
      };
      setGroups((prev) => [...prev.filter((g) => g.number !== number), entry].sort((a, b) => a.number - b.number));
      return ok(`Groupe ${number} « ${label} » · ${entry.fixtureIds.length} projecteur(s)`);
    },
    [programmer]
  );

  const recallGroup = useCallback(
    (number: number): ActionResult => {
      const group = groups.find((g) => g.number === number);
      if (!group) return warn(`Groupe ${number} vide`);
      // Un projecteur supprimé du patch depuis l'enregistrement du groupe ne doit
      // pas faire échouer le rappel : on ne garde que ceux qui existent encore.
      const alive = group.fixtureIds.filter((id) => fixturesById.has(id));
      if (!alive.length) return warn(`Groupe ${number} : aucun projecteur encore patché`);
      select(alive);
      return ok(`Groupe ${number} « ${group.name} » · ${alive.length} projecteur(s)`);
    },
    [fixturesById, groups, select]
  );

  const renameGroup = useCallback((id: string, name: string) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
  }, []);

  const deleteGroup = useCallback((id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
  }, []);

  // ─── Executors ───────────────────────────────────────────────────────────

  const storeExecutor = useCallback(
    async (slot: number, name?: string): Promise<ActionResult> => {
      // Sélection vide = on mémorise l'état complet du plateau (hors verrouillés).
      // C'est le réflexe « STORE tout ce qu'on voit » quand on n'a rien isolé.
      const target = programmer.length ? programmer : fixtures.filter((f) => !isLockedFixture(f));
      if (!target.length) return warn("Aucun projecteur à mémoriser");

      const steps = captureScene(target, valuesRef.current);
      if (!steps.length) return warn("Aucun canal à mémoriser sur cette sélection");

      const label = name?.trim() || `Exec ${slot + 1}`;
      try {
        const scene = await createScene.mutateAsync({ name: label, steps });
        setSlotMap((prev) => ({ ...prev, [slot]: scene.id }));
        return ok(`Exec ${slot + 1} « ${label} » · ${steps.length} projecteur(s) mémorisé(s)`);
      } catch (err) {
        return fail(`STORE impossible : ${(err as Error).message}`);
      }
    },
    [createScene, fixtures, programmer, valuesRef]
  );

  const goExecutor = useCallback(
    async (slot: number): Promise<ActionResult> => {
      const scene = executors[slot];
      if (!scene) return warn(`Exec ${slot + 1} vide — STORE ${slot + 1} pour l'assigner`);
      try {
        // On rejoue côté backend : les autres écrans connectés suivent, et le
        // pupitre reste la source de vérité même si cette page est rechargée.
        await activateScene.mutateAsync(scene.id);
        setLevels((prev) => {
          const next = [...prev];
          next[slot] = 1;
          return next;
        });
        return ok(`Go Exec ${slot + 1} « ${scene.name} »`);
      } catch (err) {
        return fail(`GO impossible : ${(err as Error).message}`);
      }
    },
    [activateScene, executors]
  );

  const offExecutor = useCallback(
    (slot: number): ActionResult => {
      const scene = executors[slot];
      if (!scene) return warn(`Exec ${slot + 1} vide`);
      const channels = sceneChannels(scene, fixturesById);
      channels.forEach((channel) => handleUpdateChannel(channel, 0));
      setLevels((prev) => {
        const next = [...prev];
        next[slot] = 0;
        return next;
      });
      return ok(`Off Exec ${slot + 1} · ${channels.length} canaux à zéro`);
    },
    [executors, fixturesById, handleUpdateChannel]
  );

  // Fader master d'un emplacement : rejoue la scène en atténuant les seules
  // intensités (la position d'une lyre ne suit pas le fader — cf. lib/console/scenes).
  //
  // L'écriture est regroupée par frame d'affichage. Sans ça, glisser un fader
  // émettrait un POST /api/universe/:channel PAR CANAL et PAR événement pointeur :
  // sur une scène qui contient le strip Nanoleaf (150 canaux), un seul geste
  // noierait le backend sous plusieurs milliers de requêtes. On ne garde donc
  // que la dernière valeur demandée et on l'applique une fois par frame.
  const pendingLevel = useRef<{ slot: number; level: number } | null>(null);
  const frame = useRef<number | null>(null);

  const flushLevel = useCallback(() => {
    frame.current = null;
    const pending = pendingLevel.current;
    pendingLevel.current = null;
    if (!pending) return;
    const scene = executors[pending.slot];
    if (!scene) return;
    applySceneAtLevel(scene, fixturesById, pending.level, handleUpdateChannel);
  }, [executors, fixturesById, handleUpdateChannel]);

  const setLevel = useCallback(
    (slot: number, level: number) => {
      const clamped = Math.max(0, Math.min(1, level));
      setLevels((prev) => {
        const next = [...prev];
        next[slot] = clamped;
        return next;
      });
      pendingLevel.current = { slot, level: clamped };
      if (frame.current === null) {
        frame.current = window.requestAnimationFrame(flushLevel);
      }
    },
    [flushLevel]
  );

  // Une frame planifiée qui survivrait au démontage écrirait dans un composant
  // disparu : on l'annule.
  useEffect(
    () => () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    },
    []
  );

  const releaseSlot = useCallback((slot: number) => {
    setSlotMap((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }, []);

  // Suppression réelle : détacher l'emplacement ne suffit pas, car une scène
  // sans emplacement est aussitôt reposée sur le premier libre par le memo
  // `executors` — la tuile semblait alors « revenir ». On efface donc la scène
  // en base, puis l'affectation locale devenue caduque.
  const deleteExecutor = useCallback(
    async (slot: number): Promise<ActionResult> => {
      const scene = executors[slot];
      if (!scene) return warn(`Exec ${slot + 1} déjà vide`);
      try {
        await removeScene.mutateAsync(scene.id);
      } catch (err) {
        return fail(`Suppression impossible : ${(err as Error).message}`);
      }
      setSlotMap((prev) => {
        const next: Record<string, string> = {};
        Object.entries(prev).forEach(([k, v]) => {
          if (v !== scene.id) next[k] = v;
        });
        return next;
      });
      setLevels((prev) => {
        const next = [...prev];
        next[slot] = 0;
        return next;
      });
      return ok(`Exec ${slot + 1} « ${scene.name} » supprimé`);
    },
    [executors, removeScene]
  );

  const assignSlot = useCallback((slot: number, sceneId: string) => {
    setSlotMap((prev) => {
      // Une scène n'occupe qu'un emplacement : on la retire de l'ancien.
      const next: Record<string, string> = {};
      Object.entries(prev).forEach(([k, v]) => {
        if (v !== sceneId) next[k] = v;
      });
      next[slot] = sceneId;
      return next;
    });
  }, []);

  // ─── Presets ─────────────────────────────────────────────────────────────

  const storePreset = useCallback(
    async (slot: number, name?: string): Promise<ActionResult> => {
      if (!programmer.length) {
        return warn("Sélection vide — sélectionnez des projecteurs avant STORE PRESET");
      }
      // Un preset est une carte canal → valeur : on relève les canaux occupés par
      // les projecteurs du programmer, tels qu'ils sont en ce moment.
      const payload: Record<string, number> = {};
      programmer.forEach((fixture: Fixture) => {
        const span = fixtureSpan(fixture);
        for (let i = 0; i < span; i++) {
          const channel = fixture.address + i;
          if (channel >= 1 && channel <= 512) {
            payload[String(channel)] = valuesRef.current[channel - 1] ?? 0;
          }
        }
      });
      if (!Object.keys(payload).length) return warn("Aucun canal à mémoriser");

      const label = name?.trim() || `Preset ${slot + 1}`;
      try {
        await createPreset.mutateAsync({ name: label, payload });
        return ok(`Preset ${slot + 1} « ${label} » · ${Object.keys(payload).length} canaux`);
      } catch (err) {
        return fail(`STORE PRESET impossible : ${(err as Error).message}`);
      }
    },
    [createPreset, programmer, valuesRef]
  );

  const applyPreset = useCallback(
    async (slot: number): Promise<ActionResult> => {
      const preset = presets[slot];
      if (!preset) return warn(`Preset ${slot + 1} vide`);
      try {
        await runPreset.mutateAsync(preset.id);
        return ok(`Preset ${slot + 1} « ${preset.name} » appliqué`);
      } catch (err) {
        return fail(`Preset impossible : ${(err as Error).message}`);
      }
    },
    [presets, runPreset]
  );

  const value = useMemo<ConsoleValue>(
    () => ({
      groups,
      storeGroup,
      recallGroup,
      renameGroup,
      deleteGroup,
      executors,
      levels,
      storeExecutor,
      goExecutor,
      offExecutor,
      setLevel,
      releaseSlot,
      deleteExecutor,
      assignSlot,
      presets,
      storePreset,
      applyPreset,
      busy
    }),
    [
      applyPreset,
      assignSlot,
      busy,
      deleteExecutor,
      deleteGroup,
      executors,
      goExecutor,
      groups,
      levels,
      offExecutor,
      presets,
      recallGroup,
      releaseSlot,
      renameGroup,
      setLevel,
      storeExecutor,
      storeGroup,
      storePreset
    ]
  );

  return <ConsoleCtx.Provider value={value}>{children}</ConsoleCtx.Provider>;
};

export const useConsole = (): ConsoleValue => {
  const ctx = useContext(ConsoleCtx);
  if (!ctx) throw new Error("useConsole must be used within ConsoleProvider");
  return ctx;
};
