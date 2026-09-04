// Fenêtre Effets du pupitre, dans la grammaire d'un grandMA2.
//
// Le geste, de haut en bas : on SÉLECTIONNE des projecteurs dans la fixture sheet,
// on prend un point de départ dans le POOL, on le regarde tourner dans l'APERÇU,
// on le RÈGLE ligne par ligne, puis on le lance avec GO. La phase se répartit sur
// la sélection dans l'ordre où elle a été faite — sélectionner les PAR de gauche à
// droite ou l'inverse donne deux balayages opposés, et c'est voulu.
//
// Un bandeau LED compte pour autant de cellules qu'il a de zones : le même effet
// « chaser » court sur trois PAR ou sur les 50 zones du ruban, sans rien changer à
// ses réglages.
//
// Une fois lancé, l'effet SUIT l'éditeur : bouger la vitesse retouche l'effet en
// cours au lieu de le relancer, donc sans remettre la phase à zéro. C'est le
// comportement d'un encodeur de pupitre, et c'est ce qui permet de régler en
// regardant le plateau plutôt qu'en devinant.
//
// Rien n'est persisté : un effet vit tant qu'il tourne. Le pool de départs, lui,
// est dans le package partagé — backend et frontend parlent des mêmes presets.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, Radio, Square } from "lucide-react";
import {
  DmxEffect,
  DmxEffectPreset,
  EffectCell,
  EffectLine,
  RunningEffect,
  SmartLight,
  DMX_EFFECT_PRESETS,
  resolveCells
} from "@lightbridgedmx/shared";
import { api } from "../../../../lib/api";
import { useAppData } from "../../../../contexts/AppDataContext";
import { useSelection } from "../../../../contexts/SelectionContext";
import { useCommand } from "../../../../contexts/CommandContext";
import { EffectDimmerGuard } from "./EffectDimmerGuard";
import { EffectLines } from "./EffectLines";
import { EffectMasters } from "./EffectMasters";
import { EffectPool } from "./EffectPool";
import { EffectPreview } from "./EffectPreview";
import { ATTRIBUTE_SHORT, describeEffect, elapsedSince } from "./labels";

// Sélection vide : l'aperçu tourne quand même, sur une rangée fictive. Explorer le
// pool sans avoir encore sélectionné quoi que ce soit est un usage légitime — et
// une fenêtre morte tant qu'on n'a rien sélectionné n'apprend rien à personne.
const VIRTUAL_CELLS: EffectCell[] = Array.from({ length: 12 }, (_, i) => ({
  fixtureId: "preview",
  cellIndex: i,
  channels: { dimmer: 1, red: 2, green: 3, blue: 4, pan: 5, tilt: 6 }
}));

// Délai avant d'envoyer une retouche à l'effet en cours. Assez court pour que le
// réglage suive la main, assez long pour qu'une saisie au clavier ne fasse pas une
// requête par caractère.
const LIVE_DEBOUNCE_MS = 150;

export const EffectsWindow = () => {
  const queryClient = useQueryClient();
  const { fixtures } = useAppData();
  const { selectedIds } = useSelection();
  const { report } = useCommand();

  const [group, setGroup] = useState<DmxEffectPreset["group"]>("pupitre");
  const [presetId, setPresetId] = useState<string | null>(DMX_EFFECT_PRESETS[0].id);
  const [draft, setDraft] = useState<DmxEffect>(DMX_EFFECT_PRESETS[0].effect);
  const [lineIndex, setLineIndex] = useState(0);
  // Effet en cours piloté par cet éditeur : tant qu'il est là, les réglages le
  // suivent au lieu d'attendre un nouveau GO.
  const [liveId, setLiveId] = useState<string | null>(null);
  // Rafraîchi à la seconde, uniquement pour les durées « tourne depuis ».
  const [now, setNow] = useState(() => Date.now());

  const runningQuery = useQuery(["effects"], api.effects.list, { refetchInterval: 2000 });
  const running = useMemo(() => runningQuery.data?.running ?? [], [runningQuery.data]);
  // Les cellules d'un bandeau ne se devinent pas depuis le patch : c'est la lampe
  // connectée qui porte son nombre de zones et leur géométrie.
  const lightsQuery = useQuery<SmartLight[]>(["smart-lights"], api.smartLights.list, {
    staleTime: 60_000
  });

  const invalidate = () => queryClient.invalidateQueries(["effects"]);

  const runMutation = useMutation(
    (effect: DmxEffect) => api.effects.run(effect, selectedIds),
    {
      onSuccess: (r) => {
        invalidate();
        setLiveId(r.id);
        report({
          level: "info",
          text: `Effet lancé sur ${r.fixtureIds.length} projecteur(s) — ${r.cellCount} cellule(s)`
        });
      },
      onError: (err: unknown) =>
        report({ level: "warn", text: err instanceof Error ? err.message : "Effet refusé" })
    }
  );

  const updateMutation = useMutation(
    ({ id, effect }: { id: string; effect: DmxEffect }) => api.effects.update(id, effect),
    { onSuccess: invalidate }
  );
  const stopMutation = useMutation((id: string) => api.effects.stop(id), { onSuccess: invalidate });
  const stopAllMutation = useMutation(() => api.effects.stopAll(), {
    onSuccess: () => {
      invalidate();
      setLiveId(null);
    }
  });

  // Cellules de la sélection, développées EXACTEMENT comme le fera le moteur —
  // même fonction, dans le package partagé. L'aperçu montre donc 50 zones là où le
  // bandeau en jouera 50, et non « un projecteur ».
  const cells = useMemo(
    () => resolveCells(selectedIds, fixtures, lightsQuery.data ?? []),
    [selectedIds, fixtures, lightsQuery.data]
  );
  const hasGeometry = cells.some((c) => c.position);
  const canRun = cells.length > 0;

  const selectedNames = useMemo(
    () =>
      selectedIds
        .map((id) => fixtures.find((f) => f.id === id)?.name)
        .filter((n): n is string => !!n),
    [selectedIds, fixtures]
  );

  const preset = presetId ? DMX_EFFECT_PRESETS.find((p) => p.id === presetId) : undefined;
  const dirty = preset ? JSON.stringify(preset.effect) !== JSON.stringify(draft) : true;

  // ── Retouche à chaud ──────────────────────────────────────────────────────
  // Le premier passage suit un GO et renvoie l'effet inchangé : sans conséquence,
  // et ça évite d'avoir à distinguer « je viens de lancer » de « je règle ».
  const updateRef = useRef(updateMutation);
  updateRef.current = updateMutation;
  useEffect(() => {
    if (!liveId) return undefined;
    const timer = window.setTimeout(
      () => updateRef.current.mutate({ id: liveId, effect: draft }),
      LIVE_DEBOUNCE_MS
    );
    return () => window.clearTimeout(timer);
  }, [draft, liveId]);

  // L'effet suivi peut disparaître sans nous : arrêté depuis la liste, écrasé par
  // un autre effet sur la même sélection, ou perdu au redémarrage du backend.
  useEffect(() => {
    if (liveId && !running.some((r) => r.id === liveId)) setLiveId(null);
  }, [running, liveId]);

  useEffect(() => {
    if (!running.length) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running.length]);

  // ── Édition ───────────────────────────────────────────────────────────────

  const loadPreset = (p: DmxEffectPreset) => {
    setPresetId(p.id);
    setDraft(p.effect);
    setLineIndex(0);
  };

  const patchEffect = (patch: Partial<DmxEffect>) => setDraft((d) => ({ ...d, ...patch }));
  const patchMatricks = (patch: Partial<NonNullable<DmxEffect["matricks"]>>) =>
    setDraft((d) => ({ ...d, matricks: { ...(d.matricks ?? {}), ...patch } }));
  const patchLine = (index: number, patch: Partial<EffectLine>) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l))
    }));
  const addLine = (line: EffectLine) =>
    setDraft((d) => {
      setLineIndex(d.lines.length);
      return { ...d, lines: [...d.lines, line] };
    });
  const removeLine = (index: number) =>
    setDraft((d) => {
      setLineIndex((i) => Math.max(0, Math.min(i, d.lines.length - 2)));
      return { ...d, lines: d.lines.filter((_, i) => i !== index) };
    });

  const editRunning = (run: RunningEffect) => {
    setDraft(run.effect);
    setPresetId(null);
    setLineIndex(0);
    setLiveId(run.id);
  };

  return (
    <div className="fx">
      {/* ── Cible : ce sur quoi le prochain GO va tomber ──────────────────── */}
      <div className={`fx-target ${canRun ? "" : "fx-target-empty"}`}>
        {canRun ? (
          <>
            <strong>{selectedIds.length}</strong> projecteur{selectedIds.length > 1 ? "s" : ""} ·{" "}
            <strong>{cells.length}</strong> cellule{cells.length > 1 ? "s" : ""}
            <span className="fx-target-names" title={selectedNames.join(", ")}>
              {selectedNames.join(", ")}
            </span>
          </>
        ) : (
          <>
            Sélection vide — sélectionne des projecteurs dans la fixture sheet. La phase se
            répartit sur eux, dans l'ordre de sélection.
          </>
        )}
      </div>

      {canRun ? <EffectDimmerGuard cells={cells} effect={draft} /> : null}

      <EffectPool
        group={group}
        onGroup={setGroup}
        activeId={presetId}
        hasGeometry={hasGeometry}
        canRun={canRun}
        onLoad={loadPreset}
        onGo={(p) => {
          loadPreset(p);
          runMutation.mutate(p.effect);
        }}
      />

      {/* ── Éditeur ───────────────────────────────────────────────────────── */}
      <div className="fx-editor-head">
        <input
          className="fx-name"
          value={draft.name ?? ""}
          placeholder="Effet sans nom"
          title="Nom de l'effet, repris dans la liste des effets en cours"
          onChange={(e) => patchEffect({ name: e.target.value || undefined })}
        />
        <span className="fx-editor-note">{provenance(preset?.label, draft.name, dirty)}</span>
        {liveId ? (
          <span className="fx-live" title="Les réglages sont appliqués à l'effet en cours, sans le relancer">
            <Radio size={11} aria-hidden="true" /> Suivi
          </span>
        ) : null}
      </div>

      <EffectPreview
        effect={draft}
        cells={canRun ? cells : VIRTUAL_CELLS}
        virtual={!canRun}
        lineIndex={lineIndex}
      />

      <EffectLines
        lines={draft.lines}
        selected={Math.min(lineIndex, draft.lines.length - 1)}
        onSelect={setLineIndex}
        onPatch={patchLine}
        onAdd={addLine}
        onRemove={removeLine}
      />

      <EffectMasters effect={draft} onPatch={patchEffect} onMatricks={patchMatricks} />

      {/* ── Barre d'action, collée au bas de la fenêtre ────────────────────── */}
      <div className="fx-actions">
        <button
          type="button"
          className="ma-key fx-go"
          disabled={!canRun || runMutation.isLoading}
          title={canRun ? "Lancer sur la sélection" : "Sélection vide"}
          onClick={() => runMutation.mutate(draft)}
        >
          <Play size={13} strokeWidth={3} aria-hidden="true" />
          {liveId ? "Relancer" : "Go"}
        </button>
        {liveId ? (
          <button
            type="button"
            className="ma-key"
            title="Arrêter l'effet suivi ; ses canaux reprennent leur valeur d'avant"
            onClick={() => stopMutation.mutate(liveId)}
          >
            <Square size={12} strokeWidth={3} aria-hidden="true" /> Arrêter
          </button>
        ) : null}
        <button
          type="button"
          className="ma-key ma-key-red"
          disabled={!running.length}
          title="Arrêter tous les effets"
          onClick={() => stopAllMutation.mutate()}
        >
          <Square size={12} strokeWidth={3} aria-hidden="true" /> Tout arrêter
        </button>
      </div>

      {/* ── Effets en cours ───────────────────────────────────────────────── */}
      <section className="fx-block">
        <div className="fx-block-head">
          <span>En cours</span>
          <span className="fx-block-note">
            {running.length ? `${running.length} effet(s)` : "rien ne tourne"}
          </span>
        </div>
        {running.map((run) => (
          <div key={run.id} className={`fx-run ${run.id === liveId ? "fx-run-live" : ""}`}>
            <span className="fx-run-name">
              {run.effect.name ?? run.effect.lines.map((l) => ATTRIBUTE_SHORT[l.attribute]).join(" + ")}
            </span>
            <span className="fx-run-meta">
              {describeEffect(run.effect)} · {run.cellCount} cellule
              {run.cellCount > 1 ? "s" : ""} · {elapsedSince(run.startedAt, now)}
            </span>
            <button
              type="button"
              className="fx-mini"
              title="Charger cet effet dans l'éditeur et le suivre"
              onClick={() => editRunning(run)}
            >
              <Pencil size={11} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="fx-mini fx-mini-danger"
              title="Arrêter cet effet"
              onClick={() => stopMutation.mutate(run.id)}
            >
              <Square size={11} aria-hidden="true" />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
};

/** D'où viennent les réglages affichés. On ne répète pas le nom du preset quand le
 *  champ « nom » le dit déjà juste à côté — deux fois « Dimmer soft » sur la même
 *  ligne n'apprend rien ; ce qu'on veut savoir, c'est si on a quitté le preset. */
const provenance = (
  presetLabel: string | undefined,
  name: string | undefined,
  dirty: boolean
): string => {
  if (!presetLabel) return "réglages libres";
  const renamed = name !== presetLabel;
  if (dirty) return renamed ? `${presetLabel} · modifié` : "modifié";
  return renamed ? presetLabel : "";
};
