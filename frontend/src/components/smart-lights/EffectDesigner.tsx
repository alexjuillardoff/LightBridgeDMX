// EffectDesigner : panneau de reglage des effets position-aware (sensibles a la position)
// d'une lampe connectee (smart light). On choisit un type d'effet (grandMA, solid, gradient,
// chase, wave) puis on ajuste ses parametres en direct ; chaque changement est pousse au backend
// via /effect. ATTENTION : ces effets ne fonctionnent qu'en streaming UDP (voir avertissement
// affiche), car ils evaluent l'animation a 30 Hz cote serveur.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  EffectForm,
  EffectMa,
  EffectTarget,
  Point3D,
  RgbColor,
  SmartLight,
  SmartLightEffectConfig,
  SMART_LIGHT_EFFECT_PRESETS
} from "@lightbridgedmx/shared";
import { api } from "../../lib/api";
import { hexToRgb, rgbToHex } from "./ZonePainter";

// Les familles d'effets proposees. On garde les ids en anglais (utilises par le backend).
// "ma" est le moteur parametrique facon grandMA2 : une forme d'onde, une phase
// repartie sur les zones, et les MAtricks. Il couvre a lui seul chenillard, vague,
// arc-en-ciel, strobe et scintillement — les autres familles restent pour leur
// simplicite et parce que des configs enregistrees s'en servent.
type Kind = "solid" | "gradient" | "chase" | "wave" | "ma";

// Libelles des onglets : les ids restent en anglais cote reseau.
const KIND_LABELS: Record<Kind, string> = {
  ma: "grandMA", solid: "solid", gradient: "gradient", chase: "chase", wave: "wave"
};

// Libelles francais des formes d'onde et des cibles du moteur "ma".
const FORM_LABELS: Record<EffectForm, string> = {
  sin: "Sinus", cos: "Cosinus", rampUp: "Rampe ↑", rampDown: "Rampe ↓",
  triangle: "Triangle", pwm: "Créneau", random: "Random"
};
const TARGET_LABELS: Record<EffectTarget, string> = {
  dimmer: "Intensité", color: "Couleur", hue: "Teinte"
};

// Familles du pool d'effets, dans l'ordre d'affichage.
const GROUP_LABELS = {
  pupitre: "Pupitre — phase répartie sur les zones",
  "3d": "3D — phase répartie dans l'espace",
  meuble: "Meuble — taillés pour la géométrie relevée"
} as const;

// Valeurs par defaut de chaque type d'effet : servies quand on change de famille,
// pour avoir tout de suite un effet visible sans champ vide.
const DEFAULTS: Record<Kind, SmartLightEffectConfig> = {
  solid:    { kind: "solid", color: { r: 255, g: 100, b: 0 }, brightness: 100 },
  gradient: { kind: "gradient", from: { r: 255, g: 0, b: 0 }, to: { r: 0, g: 0, b: 255 }, direction: { x: 1, y: 0, z: 0 }, scrollSpeed: 0, brightness: 100 },
  chase:    { kind: "chase", color: { r: 0, g: 200, b: 255 }, bgColor: { r: 0, g: 0, b: 0 }, speed: 8, width: 4, bounce: false, brightness: 100 },
  wave:     { kind: "wave", from: { r: 100, g: 0, b: 200 }, to: { r: 0, g: 200, b: 255 }, direction: { x: 1, y: 0, z: 0 }, wavelength: 0.5, speed: 0.8, brightness: 100 },
  // Par defaut, l'onglet grandMA ouvre sur le premier preset du pool.
  ma:       SMART_LIGHT_EFFECT_PRESETS[0].config
};

/**
 * Choisit un type d'effet et permet d'en regler les parametres en direct.
 * Chaque changement est applique aussitot via /effect.
 * @param light Lampe connectee ciblee.
 * @param onUpdated Rappel apres mise a jour reussie cote backend (renvoie la lampe a jour).
 */
export const EffectDesigner = ({
  light,
  onUpdated
}: {
  light: SmartLight;
  onUpdated: (light: SmartLight) => void;
}) => {
  // Effet courant de la lampe, mais seulement si c'est un vrai effet anime.
  // L'etat "static" (couleur figee) est ignore ici : on repartira sur un effet par defaut.
  const cur = light.currentEffect && light.currentEffect.kind !== "static" ? light.currentEffect : null;
  const initialKind: Kind = (cur?.kind as Kind) ?? "solid";
  const [config, setConfig] = useState<SmartLightEffectConfig>(cur ?? DEFAULTS[initialKind]);

  // Applique l'effet (le backend le persiste et le diffuse).
  const apply = useMutation(
    (cfg: SmartLightEffectConfig) => api.smartLights.setEffect(light.id, cfg),
    { onSuccess: onUpdated }
  );
  // Stoppe l'effet en cours (null = plus d'effet).
  const clear = useMutation(() => api.smartLights.setEffect(light.id, null), { onSuccess: onUpdated });

  // Reglage en direct : on applique a chaque changement. C'est peu couteux car le backend
  // se contente de persister la config et de diffuser le nouvel etat.
  const updateAndApply = (next: SmartLightEffectConfig) => {
    setConfig(next);
    apply.mutate(next);
  };
  // Change de famille d'effet : on repart des valeurs par defaut de ce type.
  const changeKind = (kind: Kind) => {
    const next = DEFAULTS[kind];
    updateAndApply(next);
  };

  // Les effets position-aware exigent le streaming UDP : sinon, on affiche un avertissement.
  const streamingOn = light.streaming?.enabled ?? false;

  return (
    <div style={{ padding: 10, background: "#0a0a0a", borderRadius: 0 }}>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>Effet position-aware</strong>
        {!streamingOn ? (
          <span style={{ fontSize: 12, color: "var(--accent-2)" }}>⚠ Streaming UDP requis</span>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
        {(["ma", "solid", "gradient", "chase", "wave"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => changeKind(k)}
            style={config.kind === k ? tabActive : tabInactive}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
        <button type="button" onClick={() => clear.mutate()} style={{ ...tabInactive, color: "var(--danger)" }}>
          ⏹ Stop
        </button>
      </div>

      {config.kind === "solid" && (
        <>
          <ColorRow label="Couleur" value={config.color} onChange={(c) => updateAndApply({ ...config, color: c })} />
          <NumberRow label="Brightness" value={config.brightness ?? 100} min={0} max={100} unit="%"
            onChange={(v) => updateAndApply({ ...config, brightness: v })} />
        </>
      )}

      {config.kind === "gradient" && (
        <>
          <ColorRow label="De" value={config.from} onChange={(c) => updateAndApply({ ...config, from: c })} />
          <ColorRow label="À" value={config.to} onChange={(c) => updateAndApply({ ...config, to: c })} />
          <DirectionRow value={config.direction ?? { x: 1, y: 0, z: 0 }}
            onChange={(d) => updateAndApply({ ...config, direction: d })} />
          <NumberRow label="Scroll (cycles/s)" value={config.scrollSpeed ?? 0} min={-5} max={5} step={0.1} unit=""
            onChange={(v) => updateAndApply({ ...config, scrollSpeed: v })} />
          <NumberRow label="Brightness" value={config.brightness ?? 100} min={0} max={100} unit="%"
            onChange={(v) => updateAndApply({ ...config, brightness: v })} />
        </>
      )}

      {config.kind === "chase" && (
        <>
          <ColorRow label="Couleur" value={config.color} onChange={(c) => updateAndApply({ ...config, color: c })} />
          <ColorRow label="Fond" value={config.bgColor ?? { r: 0, g: 0, b: 0 }}
            onChange={(c) => updateAndApply({ ...config, bgColor: c })} />
          <NumberRow label="Vitesse (zones/s)" value={config.speed} min={0.1} max={30} step={0.1} unit=""
            onChange={(v) => updateAndApply({ ...config, speed: v })} />
          <NumberRow label="Largeur tête" value={config.width} min={1} max={20} unit=" zones"
            onChange={(v) => updateAndApply({ ...config, width: v })} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "4px 0" }}>
            <input type="checkbox" checked={config.bounce ?? false}
              onChange={(e) => updateAndApply({ ...config, bounce: e.target.checked })} />
            Ping-pong (rebond)
          </label>
          <NumberRow label="Brightness" value={config.brightness ?? 100} min={0} max={100} unit="%"
            onChange={(v) => updateAndApply({ ...config, brightness: v })} />
        </>
      )}

      {config.kind === "wave" && (
        <>
          <ColorRow label="De" value={config.from} onChange={(c) => updateAndApply({ ...config, from: c })} />
          <ColorRow label="À" value={config.to} onChange={(c) => updateAndApply({ ...config, to: c })} />
          <DirectionRow value={config.direction ?? { x: 1, y: 0, z: 0 }}
            onChange={(d) => updateAndApply({ ...config, direction: d })} />
          <NumberRow label="Longueur d'onde" value={config.wavelength} min={0.05} max={5} step={0.05} unit=" m"
            onChange={(v) => updateAndApply({ ...config, wavelength: v })} />
          <NumberRow label="Vitesse (λ/s)" value={config.speed} min={-10} max={10} step={0.1} unit=""
            onChange={(v) => updateAndApply({ ...config, speed: v })} />
          <NumberRow label="Brightness" value={config.brightness ?? 100} min={0} max={100} unit="%"
            onChange={(v) => updateAndApply({ ...config, brightness: v })} />
        </>
      )}
      {config.kind === "ma" && (
        <MaPanel
          config={config}
          onChange={updateAndApply}
          hasLayout={(light.zoneLayout?.segments.length ?? 0) > 0}
          sideLabels={(light.zoneLayout?.sides ?? []).map((s) => s.label)}
        />
      )}
    </div>
  );
};

/**
 * Reglages du moteur parametrique facon grandMA2.
 * En haut, le POOL : des effets prets a jouer, comme le pool d'effets du pupitre.
 * En dessous, les memes reglages que sur la console — forme, vitesse en BPM,
 * plage low/high, phase repartie sur les zones, largeur, attack/decay, MAtricks.
 * Cliquer un preset ne fait que charger sa config : tout reste modifiable ensuite.
 */
const MaPanel = ({
  config,
  onChange,
  hasLayout,
  sideLabels
}: {
  config: EffectMa;
  onChange: (c: EffectMa) => void;
  /** La lampe a-t-elle un layout 3D ? Sans lui, la distribution spatiale n'a rien a mesurer. */
  hasLayout: boolean;
  /** Sections nommees du layout (`sides`), que l'effet peut viser une par une. */
  sideLabels: string[];
}) => {
  const set = (patch: Partial<EffectMa>) => onChange({ ...config, ...patch });
  const matricks = config.matricks ?? {};
  const setMatricks = (patch: Partial<NonNullable<EffectMa["matricks"]>>) =>
    set({ matricks: { ...matricks, ...patch } });

  // Preset actif = celui dont la config est identique a la config courante.
  const activePreset = SMART_LIGHT_EFFECT_PRESETS.find(
    (p) => JSON.stringify(p.config) === JSON.stringify(config)
  );
  // Attack/Decay n'ont de sens que sur les formes a fronts durs.
  const softEdges = config.form === "pwm" || config.form === "random";
  // 60 BPM = 1 cycle/s : on affiche l'equivalent en Hz, plus parlant pour un strobe.
  const hz = config.speed / 60;

  return (
    <>
      {/* Pool d'effets, groupe par famille : les effets de pupitre marchent partout,
          les 3D demandent un layout, ceux du meuble en plus ses sections nommees. */}
      {(Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[]).map((group) => {
        const presets = SMART_LIGHT_EFFECT_PRESETS.filter((p) => p.group === group);
        if (!presets.length) return null;
        return (
          <div key={group} style={{ marginBottom: 8 }}>
            <div className="muted" style={{ fontSize: 12, margin: "2px 0 4px" }}>{GROUP_LABELS[group]}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 4 }}>
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.hint}
                  onClick={() => onChange(preset.config as EffectMa)}
                  style={activePreset?.id === preset.id ? poolActive : poolInactive}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {activePreset ? (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>{activePreset.hint}</p>
      ) : null}

      <ChipRow
        label="Forme"
        options={(Object.keys(FORM_LABELS) as EffectForm[]).map((f) => ({ value: f, label: FORM_LABELS[f] }))}
        value={config.form}
        onChange={(f) => set({ form: f })}
      />
      <ChipRow
        label="Cible"
        options={(Object.keys(TARGET_LABELS) as EffectTarget[]).map((t) => ({ value: t, label: TARGET_LABELS[t] }))}
        value={config.target}
        onChange={(t) => set({ target: t })}
      />
      <ChipRow
        label="Sens"
        options={[{ value: "forward" as const, label: "→ Avant" }, { value: "backward" as const, label: "← Arrière" }]}
        value={config.direction ?? "forward"}
        onChange={(d) => set({ direction: d })}
      />

      <NumberRow label={`Vitesse (BPM · ${hz.toFixed(2)} Hz)`} value={config.speed} min={0} max={600} unit=" BPM"
        onChange={(v) => set({ speed: v })} />
      <NumberRow label="Low" value={config.low} min={0} max={100} unit="%" onChange={(v) => set({ low: v })} />
      <NumberRow label="High" value={config.high} min={0} max={100} unit="%" onChange={(v) => set({ high: v })} />
      <NumberRow label="Phase départ" value={config.phaseFrom} min={-720} max={720} step={15} unit="°"
        onChange={(v) => set({ phaseFrom: v })} />
      <NumberRow label="Phase fin" value={config.phaseTo} min={-720} max={720} step={15} unit="°"
        onChange={(v) => set({ phaseTo: v })} />
      <NumberRow label="Largeur" value={config.width} min={1} max={100} unit="%" onChange={(v) => set({ width: v })} />

      {softEdges ? (
        <>
          <NumberRow label="Attack" value={config.attack ?? 0} min={0} max={100} unit="%"
            onChange={(v) => set({ attack: v })} />
          <NumberRow label="Decay" value={config.decay ?? 0} min={0} max={100} unit="%"
            onChange={(v) => set({ decay: v })} />
        </>
      ) : null}
      {config.form === "random" ? (
        <NumberRow label="Graine" value={config.seed ?? 1} min={0} max={64} unit="" onChange={(v) => set({ seed: v })} />
      ) : null}

      {/* Distribution : la phase suit-elle l'ordre du ruban, ou la geometrie de la piece ? */}
      <ChipRow
        label="Distribution"
        options={[
          { value: "index" as const, label: "Rang de zone" },
          { value: "axis" as const, label: "Axe 3D" },
          { value: "radial" as const, label: "Radial 3D" },
          { value: "angular" as const, label: "Angulaire 3D" }
        ]}
        value={config.spatial?.mode ?? "index"}
        onChange={(mode) => {
          if (mode === "index") return set({ spatial: undefined });
          if (mode === "axis") {
            return set({ spatial: { mode: "axis", direction: config.spatial?.direction ?? { x: 0, y: 1, z: 0 } } });
          }
          // radial et angular partagent le meme point d'origine : on le conserve
          // en passant de l'un a l'autre.
          const origin = config.spatial?.origin ?? { x: 0, y: 0.1, z: 0.2 };
          return set({ spatial: { mode, origin } });
        }}
      />
      {config.spatial && !hasLayout ? (
        <p style={{ fontSize: 12, color: "var(--accent-2)", margin: "0 0 6px" }}>
          ⚠ Pas de layout 3D sur cette lampe : le moteur retombe sur une ligne droite.
        </p>
      ) : null}
      {config.spatial?.mode === "axis" ? (
        <DirectionRow
          value={config.spatial.direction ?? { x: 0, y: 1, z: 0 }}
          onChange={(d) => set({ spatial: { mode: "axis", direction: d } })}
        />
      ) : null}
      {config.spatial && config.spatial.mode !== "axis" ? (
        <div style={{ margin: "4px 0" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {config.spatial.mode === "angular" ? "Axe de rotation (m)" : "Origine (m)"}
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginTop: 2 }}>
            {(["x", "y", "z"] as const).map((axis) => {
              const origin = config.spatial?.origin ?? { x: 0, y: 0.1, z: 0.2 };
              const mode = config.spatial?.mode === "angular" ? ("angular" as const) : ("radial" as const);
              return (
                <label key={axis} style={{ fontSize: 12 }}>
                  <span style={{ color: "var(--muted)" }}>{axis.toUpperCase()}: {origin[axis].toFixed(2)}</span>
                  <input type="range" min={-3} max={3} step={0.05} value={origin[axis]}
                    onChange={(e) =>
                      set({ spatial: { mode, origin: { ...origin, [axis]: Number(e.target.value) } } })
                    }
                    style={{ width: "100%" }} />
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Sections : restreindre l'effet a une partie relevee du bandeau (les niches,
          le tour du bas...). Sans selection, l'effet joue partout. */}
      {sideLabels.length ? (
        <div style={{ margin: "6px 0" }}>
          <span className="muted" style={{ fontSize: 13 }}>Sections visées</span>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
            {sideLabels.map((label) => {
              const selected = config.sides?.includes(label) ?? false;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    const next = selected
                      ? (config.sides ?? []).filter((l) => l !== label)
                      : [...(config.sides ?? []), label];
                    set({ sides: next.length ? next : undefined });
                  }}
                  style={selected ? poolActive : poolInactive}
                >
                  {label}
                </button>
              );
            })}
            {config.sides?.length ? (
              <button type="button" onClick={() => set({ sides: undefined })} style={poolInactive}>
                ✕ tout
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* MAtricks : la sous-selection entrelacee du pupitre, ramenee aux zones du bandeau.
          En distribution spatiale, seul "groups" agit (blocks et wings raisonnent en rang). */}
      <div style={{ margin: "8px 0 4px" }}>
        <span className="muted" style={{ fontSize: 13 }}>MAtricks</span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginTop: 2 }}>
          <IntBox label="Blocks" title="N zones consécutives partagent la même phase"
            value={matricks.blocks ?? 1} min={1} max={25} onChange={(v) => setMatricks({ blocks: v })} />
          <IntBox label="Groups" title="Le motif se répète N fois sur la longueur"
            value={matricks.groups ?? 1} min={1} max={25} onChange={(v) => setMatricks({ groups: v })} />
          <IntBox label="Wings" title="Bandeau plié en N ailes, une sur deux en miroir"
            value={matricks.wings ?? 1} min={1} max={8} onChange={(v) => setMatricks({ wings: v })} />
        </div>
      </div>

      {config.target === "dimmer" && (
        <>
          <ColorRow label="Couleur" value={config.color ?? { r: 255, g: 255, b: 255 }}
            onChange={(c) => set({ color: c })} />
          <ColorRow label="Fond" value={config.bgColor ?? { r: 0, g: 0, b: 0 }}
            onChange={(c) => set({ bgColor: c })} />
        </>
      )}
      {config.target === "color" && (
        <>
          <ColorRow label="De" value={config.color ?? { r: 0, g: 0, b: 0 }} onChange={(c) => set({ color: c })} />
          <ColorRow label="À" value={config.colorTo ?? { r: 255, g: 255, b: 255 }}
            onChange={(c) => set({ colorTo: c })} />
        </>
      )}
      {config.target === "hue" && (
        <>
          <NumberRow label="Teinte départ" value={config.hueFrom ?? 0} min={-360} max={720} step={5} unit="°"
            onChange={(v) => set({ hueFrom: v })} />
          <NumberRow label="Teinte fin" value={config.hueTo ?? 360} min={-360} max={720} step={5} unit="°"
            onChange={(v) => set({ hueTo: v })} />
          <NumberRow label="Saturation" value={config.saturation ?? 100} min={0} max={100} unit="%"
            onChange={(v) => set({ saturation: v })} />
        </>
      )}

      <NumberRow label="Brightness" value={config.brightness ?? 100} min={0} max={100} unit="%"
        onChange={(v) => set({ brightness: v })} />
    </>
  );
};

// Ligne de boutons a choix unique (forme, cible, sens).
const ChipRow = <T extends string>({
  label, options, value, onChange
}: {
  label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) => (
  <div style={{ margin: "6px 0" }}>
    <span className="muted" style={{ fontSize: 13 }}>{label}</span>
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          style={value === o.value ? poolActive : poolInactive}>
          {o.label}
        </button>
      ))}
    </div>
  </div>
);

// Petit champ entier (MAtricks) : trop peu de valeurs utiles pour un curseur.
const IntBox = ({
  label, title, value, min, max, onChange
}: {
  label: string; title: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) => (
  <label title={title} style={{ fontSize: 12 }}>
    <span style={{ color: "var(--muted)" }}>{label}</span>
    <input type="number" min={min} max={max} value={value}
      onChange={(e) => {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
      }}
      style={{ width: "100%", background: "#050505", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 0, padding: "2px 4px" }} />
  </label>
);

// Ligne de selection d'une couleur RGB : le <input type="color"> travaille en hex,
// on convertit donc dans les deux sens (hex <-> RgbColor) a l'affichage et a la saisie.
const ColorRow = ({ label, value, onChange }: { label: string; value: RgbColor; onChange: (c: RgbColor) => void }) => (
  <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
    <span className="muted" style={{ fontSize: 13, width: 70 }}>{label}</span>
    <input
      type="color"
      value={rgbToHex(value)}
      onChange={(e) => onChange(hexToRgb(e.target.value))}
      style={{ width: 32, height: 28, padding: 0, border: "1px solid var(--border)", borderRadius: 0, background: "transparent" }}
    />
    <span style={{ fontSize: 12, color: "var(--muted)" }}>rgb({value.r},{value.g},{value.b})</span>
  </label>
);

// Ligne de reglage numerique : un curseur (slider) avec sa valeur affichee a droite.
const NumberRow = ({
  label, value, min, max, step, unit, onChange
}: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void;
}) => (
  <label style={{ display: "block", margin: "4px 0" }}>
    <div className="flex-between" style={{ marginBottom: 2 }}>
      <span className="muted" style={{ fontSize: 13 }}>{label}</span>
      {/* 2 decimales pour les pas fins (< 1), sinon valeur entiere. */}
      <span style={{ fontSize: 13 }}>{value.toFixed(step && step < 1 ? 2 : 0)}{unit}</span>
    </div>
    <input type="range" min={min} max={max} step={step ?? 1} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: "100%" }} />
  </label>
);

// Reglage du vecteur direction 3D (axes X, Y, Z, chacun borne entre -1 et 1).
// Utilise par gradient et wave pour orienter l'effet dans la disposition (layout) du bandeau.
const DirectionRow = ({ value, onChange }: { value: Point3D; onChange: (p: Point3D) => void }) => (
  <div style={{ margin: "4px 0" }}>
    <span className="muted" style={{ fontSize: 13 }}>Direction (XYZ)</span>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginTop: 2 }}>
      {(["x", "y", "z"] as const).map((axis) => (
        <label key={axis} style={{ fontSize: 12 }}>
          <span style={{ color: "var(--muted)" }}>{axis.toUpperCase()}: {value[axis].toFixed(2)}</span>
          <input
            type="range" min={-1} max={1} step={0.05} value={value[axis]}
            onChange={(e) => onChange({ ...value, [axis]: Number(e.target.value) })}
            style={{ width: "100%" }}
          />
        </label>
      ))}
    </div>
  </div>
);

// Styles des onglets de selection d'effet : base commune, puis variante active/inactive.
const tabBase: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 0, fontSize: 13, cursor: "pointer", border: "1px solid var(--border)"
};
const tabActive: React.CSSProperties = { ...tabBase, background: "linear-gradient(180deg,#2b7fd0,#10457d)", color: "#fff", fontWeight: 700 };
const tabInactive: React.CSSProperties = { ...tabBase, background: "linear-gradient(180deg,#1a1a1a,#050505)", color: "var(--dim)" };

// Boutons du pool d'effets et des choix (forme / cible / sens) : plus petits que
// les onglets de famille, meme grammaire visuelle que le reste du pupitre.
const poolBase: React.CSSProperties = {
  padding: "4px 6px", borderRadius: 0, fontSize: 12, cursor: "pointer",
  border: "1px solid var(--border)", textAlign: "center", whiteSpace: "nowrap",
  overflow: "hidden", textOverflow: "ellipsis"
};
const poolActive: React.CSSProperties = { ...poolBase, background: "linear-gradient(180deg,#2b7fd0,#10457d)", color: "#fff", fontWeight: 700 };
const poolInactive: React.CSSProperties = { ...poolBase, background: "linear-gradient(180deg,#151515,#050505)", color: "var(--dim)" };
