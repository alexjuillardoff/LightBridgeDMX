// Fenêtre Effets du pupitre.
//
// Un effet se joue sur la SÉLECTION courante, comme sur un grandMA2 : on
// sélectionne des projecteurs dans la fixture sheet, on clique un effet du pool,
// il tourne. La phase se répartit sur la sélection dans l'ordre où elle a été
// faite — sélectionner les PAR de gauche à droite ou l'inverse donne deux
// balayages opposés, et c'est voulu.
//
// Un bandeau LED compte pour autant de cellules qu'il a de zones : le même effet
// « chaser » court sur trois PAR ou sur les 50 zones du ruban, sans rien changer
// à ses réglages.
//
// Rien n'est persisté : un effet vit tant qu'il tourne. Le pool de départs, lui,
// est dans le package partagé — backend et frontend parlent des mêmes presets.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Square } from "lucide-react";
import {
  DMX_EFFECT_PRESETS,
  DmxEffect,
  DmxEffectPreset,
  EffectAttribute,
  EffectForm,
  RunningEffect
} from "@lightbridgedmx/shared";
import { api } from "../../../lib/api";
import { useAppData } from "../../../contexts/AppDataContext";
import { useSelection } from "../../../contexts/SelectionContext";
import { useCommand } from "../../../contexts/CommandContext";

const GROUP_LABELS: Record<DmxEffectPreset["group"], string> = {
  pupitre: "Pupitre",
  "3d": "Espace",
  meuble: "Meuble TV"
};

const ATTRIBUTE_LABELS: Record<EffectAttribute, string> = {
  dimmer: "Dimmer",
  red: "Rouge",
  green: "Vert",
  blue: "Bleu",
  pan: "Pan",
  tilt: "Tilt",
  color: "Couleur",
  hue: "Teinte"
};

const FORM_LABELS: Record<EffectForm, string> = {
  sin: "Sinus",
  cos: "Cosinus",
  rampUp: "Rampe ↑",
  rampDown: "Rampe ↓",
  triangle: "Triangle",
  pwm: "Créneau",
  random: "Aléatoire"
};

export const EffectsWindow = () => {
  const queryClient = useQueryClient();
  const { fixtures } = useAppData();
  const { selectedIds } = useSelection();
  const { report } = useCommand();

  // Effet en cours d'édition : on part d'un preset, puis on le retouche. C'est le
  // geste du pupitre — un preset est un point de départ, pas un réglage figé.
  const [draft, setDraft] = useState<DmxEffect>(DMX_EFFECT_PRESETS[0].effect);
  const [presetId, setPresetId] = useState<string>(DMX_EFFECT_PRESETS[0].id);

  const runningQuery = useQuery(["effects"], api.effects.list, { refetchInterval: 2000 });
  const running = runningQuery.data?.running ?? [];

  const invalidate = () => queryClient.invalidateQueries(["effects"]);

  const runMutation = useMutation(
    (effect: DmxEffect) => api.effects.run(effect, selectedIds),
    {
      onSuccess: (r) => {
        invalidate();
        report({
          level: "info",
          text: `Effet lancé sur ${r.fixtureIds.length} projecteur(s) — ${r.cellCount} cellule(s)`
        });
      },
      onError: (err: unknown) =>
        report({ level: "warn", text: err instanceof Error ? err.message : "Effet refusé" })
    }
  );

  const stopMutation = useMutation((id: string) => api.effects.stop(id), { onSuccess: invalidate });
  const stopAllMutation = useMutation(() => api.effects.stopAll(), { onSuccess: invalidate });

  const selectedNames = useMemo(
    () =>
      selectedIds
        .map((id) => fixtures.find((f) => f.id === id)?.name)
        .filter((n): n is string => !!n),
    [selectedIds, fixtures]
  );

  const applyPreset = (preset: DmxEffectPreset) => {
    setPresetId(preset.id);
    setDraft(preset.effect);
  };

  // Les réglages n'agissent que sur la première ligne : c'est celle que 22 des 23
  // presets utilisent seuls. Un effet multi-lignes (un cercle de lyre) se règle
  // ligne par ligne, ce que cette fenêtre ne propose pas encore — elle affiche
  // alors le nombre de lignes pour qu'on sache qu'on n'en voit qu'une partie.
  const line = draft.lines[0];
  const patchLine = (patch: Partial<typeof line>) =>
    setDraft((d) => ({ ...d, lines: [{ ...d.lines[0], ...patch }, ...d.lines.slice(1)] }));
  const patchEffect = (patch: Partial<DmxEffect>) => setDraft((d) => ({ ...d, ...patch }));
  const patchMatricks = (patch: Partial<NonNullable<DmxEffect["matricks"]>>) =>
    setDraft((d) => ({ ...d, matricks: { ...(d.matricks ?? {}), ...patch } }));

  const canRun = selectedIds.length > 0;

  return (
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* ── Cible ─────────────────────────────────────────────────────────── */}
      <div style={panelStyle}>
        <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
          Cible
        </div>
        {canRun ? (
          <div style={{ fontSize: 13 }}>
            <strong>{selectedIds.length}</strong> projecteur{selectedIds.length > 1 ? "s" : ""} —{" "}
            <span className="muted">{selectedNames.join(", ")}</span>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--warn, #d0a02b)" }}>
            Sélection vide. Sélectionne des projecteurs dans la fixture sheet — l'effet se
            répartit sur eux, dans l'ordre de sélection.
          </div>
        )}
      </div>

      {/* ── Pool de départs ──────────────────────────────────────────────── */}
      <div style={panelStyle}>
        {(["pupitre", "3d", "meuble"] as const).map((group) => {
          const presets = DMX_EFFECT_PRESETS.filter((p) => p.group === group);
          if (!presets.length) return null;
          return (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
                {GROUP_LABELS[group]}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    title={p.hint}
                    onClick={() => applyPreset(p)}
                    style={p.id === presetId ? chipActive : chip}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          {DMX_EFFECT_PRESETS.find((p) => p.id === presetId)?.hint}
        </p>
      </div>

      {/* ── Réglages ─────────────────────────────────────────────────────── */}
      <div style={panelStyle}>
        <Row>
          <Field label="Attribut">
            <select
              value={line.attribute}
              onChange={(e) => patchLine({ attribute: e.target.value as EffectAttribute })}
              style={inputStyle}
            >
              {Object.entries(ATTRIBUTE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Forme">
            <select
              value={line.form}
              onChange={(e) => patchLine({ form: e.target.value as EffectForm })}
              style={inputStyle}
            >
              {Object.entries(FORM_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Mode" hint="Relatif = la forme s'ajoute à la position actuelle (pan/tilt)">
            <select
              value={line.mode}
              onChange={(e) => patchLine({ mode: e.target.value as "absolute" | "relative" })}
              style={inputStyle}
            >
              <option value="absolute">Absolu</option>
              <option value="relative">Relatif</option>
            </select>
          </Field>
        </Row>

        <Row>
          <Num label="Vitesse (BPM)" value={draft.speed} min={0} max={1200}
            onChange={(v) => patchEffect({ speed: v })} />
          <Num label="Rate" value={draft.rate} min={0.05} max={20} step={0.05}
            onChange={(v) => patchEffect({ rate: v })} />
          <Field label="Sens">
            <select
              value={draft.direction}
              onChange={(e) => patchEffect({ direction: e.target.value as "forward" | "backward" })}
              style={inputStyle}
            >
              <option value="forward">Avant</option>
              <option value="backward">Arrière</option>
            </select>
          </Field>
        </Row>

        <Row>
          <Num label="Low (%)" value={line.low} min={0} max={100} onChange={(v) => patchLine({ low: v })} />
          <Num label="High (%)" value={line.high} min={0} max={100} onChange={(v) => patchLine({ high: v })} />
          <Num label="Width (%)" value={line.width} min={1} max={100} onChange={(v) => patchLine({ width: v })} />
        </Row>

        <Row>
          <Num label="Phase de" value={line.phaseFrom} min={-1440} max={1440}
            onChange={(v) => patchLine({ phaseFrom: v })} />
          <Num label="Phase à" value={line.phaseTo} min={-1440} max={1440}
            onChange={(v) => patchLine({ phaseTo: v })} />
          <Num label="Attack (%)" value={line.attack ?? 0} min={0} max={100}
            onChange={(v) => patchLine({ attack: v })} />
          <Num label="Decay (%)" value={line.decay ?? 0} min={0} max={100}
            onChange={(v) => patchLine({ decay: v })} />
        </Row>

        <Row>
          <Num label="Blocks" value={draft.matricks?.blocks ?? 1} min={1} max={100}
            onChange={(v) => patchMatricks({ blocks: v })} />
          <Num label="Groups" value={draft.matricks?.groups ?? 1} min={1} max={50}
            onChange={(v) => patchMatricks({ groups: v })} />
          <Num label="Wings" value={draft.matricks?.wings ?? 1} min={1} max={8}
            onChange={(v) => patchMatricks({ wings: v })} />
          <Num label="Interleave" value={draft.matricks?.interleave ?? 1} min={1} max={16}
            onChange={(v) => patchMatricks({ interleave: v })} />
        </Row>

        {draft.lines.length > 1 ? (
          <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
            Cet effet a {draft.lines.length} lignes ; les réglages ci-dessus ne touchent
            que la première ({ATTRIBUTE_LABELS[line.attribute]}).
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button
            type="button"
            disabled={!canRun || runMutation.isLoading}
            onClick={() => runMutation.mutate(draft)}
            style={canRun ? buttonPrimary : buttonDisabled}
          >
            <Play size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            Lancer sur la sélection
          </button>
          {running.length > 0 ? (
            <button type="button" onClick={() => stopAllMutation.mutate()} style={buttonSecondary}>
              <Square size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
              Tout arrêter
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Effets en cours ──────────────────────────────────────────────── */}
      <div style={panelStyle}>
        <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
          En cours
        </div>
        {running.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Aucun effet ne tourne.</p>
        ) : (
          running.map((r) => <RunningRow key={r.id} run={r} onStop={() => stopMutation.mutate(r.id)} />)
        )}
      </div>
    </div>
  );
};

const RunningRow = ({ run, onStop }: { run: RunningEffect; onStop: () => void }) => {
  const { fixtures } = useAppData();
  const names = run.fixtureIds
    .map((id) => fixtures.find((f) => f.id === id)?.name ?? "?")
    .join(", ");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
      <button type="button" onClick={onStop} style={buttonSecondary} title="Arrêter">
        <Square size={12} />
      </button>
      <span style={{ flex: 1 }}>
        {run.effect.lines.map((l) => ATTRIBUTE_LABELS[l.attribute]).join(" + ")}{" "}
        <span className="muted">
          · {run.effect.speed} BPM × {run.effect.rate} · {run.cellCount} cellule
          {run.cellCount > 1 ? "s" : ""} · {names}
        </span>
      </span>
    </div>
  );
};

// ── Petits blocs de mise en page ────────────────────────────────────────────

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>{children}</div>
);

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label title={hint} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 92 }}>
    <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
    {children}
  </label>
);

const Num = ({
  label, value, min, max, step, onChange
}: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
}) => (
  <Field label={label}>
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => {
        const v = Number(e.target.value);
        // Un champ vidé donne NaN : on ignore plutôt que d'envoyer une config
        // invalide au backend, qui la refuserait avec une erreur illisible.
        if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
      style={inputStyle}
    />
  </Field>
);

const panelStyle: React.CSSProperties = {
  padding: 8,
  background: "#0a0a0a",
  border: "1px solid var(--border)"
};

const inputStyle: React.CSSProperties = {
  background: "#050505",
  border: "1px solid var(--border)",
  color: "var(--fg, #ddd)",
  padding: "3px 6px",
  fontSize: 13,
  borderRadius: 0,
  width: "100%"
};

const chip: React.CSSProperties = {
  padding: "3px 9px",
  fontSize: 12,
  borderRadius: 0,
  cursor: "pointer",
  border: "1px solid var(--border)",
  background: "linear-gradient(180deg,#1a1a1a,#050505)",
  color: "var(--dim)"
};

const chipActive: React.CSSProperties = {
  ...chip,
  background: "linear-gradient(180deg,#2b7fd0,#10457d)",
  color: "#fff",
  fontWeight: 700
};

const buttonPrimary: React.CSSProperties = {
  ...chip,
  padding: "5px 12px",
  fontSize: 13,
  background: "linear-gradient(180deg,#2b7fd0,#10457d)",
  color: "#fff",
  fontWeight: 700
};

const buttonSecondary: React.CSSProperties = { ...chip, padding: "5px 10px", fontSize: 13 };

const buttonDisabled: React.CSSProperties = {
  ...buttonSecondary,
  opacity: 0.45,
  cursor: "not-allowed"
};
