// Encoder bar MA3 (bas de l'écran, 15,5 rem) :
//   rangée 1 : Sync | 1 Dimmer … 8 Shapers | Selection Phaser MAtricks Prog Time Exec Time | Grand Master
//   rangée 2 : Single Step | Dimmer 1 of N | Link Values | Values and Timings / Phaser Overall / Phaser Steps | ▶ |
//              Absolute Relative Fade Delay | ◀ 1 ▶ ⟳
//   rangée 3 : Align / Readout | 4 encodeurs | Screen Y / Screen X (Display 1)
// Variante « command wing bar » : 10 executors (fader horizontal + Go/Off) et 2 encodeurs compacts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, WheelEvent } from "react";
import type { DmxEffect, RunningEffect } from "@lightbridgedmx/shared";
import { useStore } from "../lib/store";
import {
  ATTRIBUTES,
  FEATURE_GROUPS,
  READOUT_LABELS,
  attrsOfGroup,
  channelsForAttr,
  formatValue,
  groupsAvailable,
  nextReadout
} from "../lib/attributes";
import type { AttrKey, Readout } from "../lib/attributes";
import type { PatchedFixture } from "../lib/patch";
import { useRunningEffects } from "../state/app";
import { useChannels } from "../state/universe";
import {
  programmerStore,
  setAlign,
  setAttribute,
  setEncoderPage,
  setFeatureGroup,
  setGrandMaster,
  setLayer,
  setLayerGroup,
  setLink,
  setReadout,
  setSingleStep,
  setSync,
  useActiveChannels,
  useSelectedFixtures,
  useSelection
} from "../state/programmer";
import type { Align, Layer, LayerGroup } from "../state/programmer";
import { goExecutor, offExecutor, setExecutorLevel, useExecutors } from "../state/playback";
import { openOverlay, useWorkspace } from "../state/workspace";
import { openWindow } from "../windows/registry";
import { updateEffect } from "./actions";
import { Encoder } from "./Encoder";
import { Fader } from "./Fader";
import { IconArrowLeft, IconArrowRight, IconSlash, IconStepLoop } from "./icons";
import type { CalculatorPayload } from "./overlays/Calculator";
import { SelectionOverlay } from "./overlays/SelectionOverlay";
import { toast } from "./Toasts";

// --- Constantes -------------------------------------------------------------------

const LAYER_COLORS: Record<Layer, string> = {
  absolute: "var(--c-layer-abs)",
  relative: "var(--c-layer-rel)",
  fade: "var(--c-layer-fade)",
  delay: "var(--c-layer-delay)"
};
const LAYER_LABELS: Record<Layer, string> = { absolute: "Absolute", relative: "Relative", fade: "Fade", delay: "Delay" };
const LAYER_ORDER: Layer[] = ["absolute", "relative", "fade", "delay"];

const LAYER_GROUPS: Array<{ id: LayerGroup; label: string; color: string }> = [
  { id: "values", label: "Values and\nTimings", color: "var(--c-layer-abs)" },
  { id: "phaserOverall", label: "Phaser\nOverall", color: "var(--c-layer-phaser)" },
  { id: "phaserSteps", label: "Phaser\nSteps", color: "var(--c-layer-phaser)" }
];

const ALIGN_ORDER: Align[] = ["off", "<", ">", "<>"];
const ALIGN_LABELS: Record<Align, string> = { off: "Off", "<": "<", ">": ">", "<>": "<>" };

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

function layerStyle(color: string): CSSProperties {
  return { ["--layer" as string]: color } as CSSProperties;
}

// Paramètres pilotables d'un phaser en cours par les encodeurs (couches Phaser).
type PhaserParam = {
  label: string;
  min: number;
  max: number;
  step: number;
  get: (e: DmxEffect) => number;
  set: (e: DmxEffect, v: number) => DmxEffect;
  format: (v: number) => string;
};

function lineField(label: string, key: "low" | "high" | "phaseTo" | "width" | "attack" | "decay", min: number, max: number, unit: string): PhaserParam {
  return {
    label,
    min,
    max,
    step: 1,
    get: (e) => e.lines[0]?.[key] ?? 0,
    set: (e, v) => ({ ...e, lines: e.lines.map((l, i) => (i === 0 ? { ...l, [key]: v } : l)) }),
    format: (v) => `${Math.round(v)}${unit}`
  };
}

const PHASER_OVERALL: PhaserParam[] = [
  { label: "Speed", min: 0, max: 1200, step: 1, get: (e) => e.speed, set: (e, v) => ({ ...e, speed: v }), format: (v) => `${Math.round(v)} BPM` },
  {
    label: "Rate",
    min: 0.05,
    max: 20,
    step: 0.05,
    get: (e) => e.rate,
    set: (e, v) => ({ ...e, rate: Math.round(v * 100) / 100 }),
    format: (v) => `${v.toFixed(2)} ×`
  },
  lineField("Phase", "phaseTo", -1440, 1440, "°"),
  lineField("Width", "width", 1, 100, " %")
];
const PHASER_STEPS: PhaserParam[] = [
  lineField("Low", "low", 0, 100, " %"),
  lineField("High", "high", 0, 100, " %"),
  lineField("Attack", "attack", 0, 100, " %"),
  lineField("Decay", "decay", 0, 100, " %")
];

// --- Composant racine --------------------------------------------------------------

export function EncoderBar() {
  const wing = useWorkspace((s) => s.wingBar);
  return (
    <div className={`sh-encbar${wing ? " sh-encbar--wing" : ""}`} data-neutral="" role="region" aria-label={wing ? "Command wing bar" : "Encoder bar"}>
      <div className="sh-encbar__main">{wing ? <CommandWingBar /> : <EncoderRows />}</div>
      <GrandMasterColumn />
    </div>
  );
}

// --- Les trois rangées ----------------------------------------------------------------

function EncoderRows() {
  const featureGroup = useStore(programmerStore, (s) => s.featureGroup);
  const encoderPage = useStore(programmerStore, (s) => s.encoderPage);
  const layerGroup = useStore(programmerStore, (s) => s.layerGroup);
  const layer = useStore(programmerStore, (s) => s.layer);
  const readout = useStore(programmerStore, (s) => s.readout);
  const sync = useStore(programmerStore, (s) => s.sync);
  const singleStep = useStore(programmerStore, (s) => s.singleStep);
  const align = useStore(programmerStore, (s) => s.align);
  const link = useStore(programmerStore, (s) => s.link);
  const selected = useSelectedFixtures();
  const [showSelection, setShowSelection] = useState(false);

  const available = useMemo(() => groupsAvailable(selected), [selected]);
  const group = FEATURE_GROUPS.find((g) => g.id === featureGroup) ?? FEATURE_GROUPS[0];
  const attrs = useMemo(() => attrsOfGroup(featureGroup), [featureGroup]);
  const pages = Math.max(1, Math.ceil(attrs.length / 4));
  const page = Math.max(0, Math.min(encoderPage, pages - 1));
  const pageAttrs: Array<AttrKey | null> = [0, 1, 2, 3].map((i) => attrs[page * 4 + i] ?? null);

  const running = useRunningOnSelection();
  const phaserParams = layerGroup === "phaserOverall" ? PHASER_OVERALL : layerGroup === "phaserSteps" ? PHASER_STEPS : null;

  const cycleAlign = () => setAlign(ALIGN_ORDER[(ALIGN_ORDER.indexOf(align) + 1) % ALIGN_ORDER.length] ?? "off");
  const cycleReadout = () => setReadout(nextReadout(readout));
  const toggleLink = () => setLink(link === "single" ? "feature" : "single");
  const nextPage = () => setEncoderPage((page + 1) % pages);
  const unavailable = (name: string) => toast(`${name} : non disponible dans LightBridgeDMX`, "warn");

  return (
    <>
      {/* ---- Rangée 1 ---- */}
      <div className="sh-encbar__row sh-encbar__row1">
        <button type="button" className={`ma-btn sh-encbar__side${sync ? " ma-btn--active" : ""}`} aria-pressed={sync} onClick={() => setSync(!sync)}>
          Sync
          <span className={`ma-btn__toggle${sync ? " ma-btn__toggle--on" : ""}`} aria-hidden="true" />
        </button>
        {FEATURE_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`ma-btn sh-encbar__group${g.id === featureGroup ? " ma-btn--active" : ""}`}
            aria-pressed={g.id === featureGroup}
            onClick={() => setFeatureGroup(g.id)}
            title={`${g.label} (F${g.index})`}
          >
            <span className="ma-btn__num">{g.index}</span>
            {g.label}
            <span className={`ma-btn__dot${available.has(g.id) ? " ma-btn__dot--on" : ""}`} aria-hidden="true" />
          </button>
        ))}
        <button type="button" className="ma-btn sh-encbar__tool sh-encbar__tool--sel" onClick={() => setShowSelection(true)} title="Sélection courante">
          <span className="sh-encbar__selmark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Selection
          <Dots />
        </button>
        <button type="button" className="ma-btn sh-encbar__tool" onClick={() => openWindow("phaser")} title="Ouvrir la fenêtre Phaser">
          Phaser
          <Dots />
        </button>
        <button type="button" className="ma-btn sh-encbar__tool" onClick={() => unavailable("MAtricks")}>
          MAtricks
          <Dots />
        </button>
        <button type="button" className="ma-btn sh-encbar__tool sh-encbar__tool--time" onClick={() => unavailable("Prog Time")}>
          Prog Time
          <Dots />
        </button>
        <button type="button" className="ma-btn sh-encbar__tool sh-encbar__tool--time" onClick={() => unavailable("Exec Time")}>
          Exec Time
          <Dots />
        </button>
      </div>

      {/* ---- Rangée 2 ---- */}
      <div className="sh-encbar__row sh-encbar__row2">
        <button type="button" className={`ma-btn sh-encbar__side${singleStep ? " ma-btn--active" : ""}`} aria-pressed={singleStep} onClick={() => setSingleStep(!singleStep)}>
          {"Single\nStep"}
          <span className={`ma-btn__toggle${singleStep ? " ma-btn__toggle--on" : ""}`} aria-hidden="true" />
        </button>
        <button type="button" className="ma-btn sh-encbar__page" onClick={nextPage} title="Page d'encodeurs suivante">
          {`${group.label} ${page + 1} of ${pages}`}
          <span className="ma-btn__caret" aria-hidden="true" />
        </button>
        <button type="button" className="ma-btn sh-encbar__link" onClick={toggleLink} title="Link Values">
          <span className="ma-btn__small">Link Values</span>
          <span className="sh-encbar__linkval">{link === "single" ? "Single" : "Feature"}</span>
          <span className="ma-btn__caret" aria-hidden="true" />
        </button>
        {LAYER_GROUPS.map((lg) => (
          <button
            key={lg.id}
            type="button"
            className={`ma-btn ma-btn--layer sh-encbar__lgroup${layerGroup === lg.id ? " ma-btn--active" : ""}`}
            style={layerStyle(lg.color)}
            aria-pressed={layerGroup === lg.id}
            onClick={() => setLayerGroup(lg.id)}
          >
            {lg.label}
            <span className={`ma-btn__dot${layerGroup === lg.id ? " ma-btn__dot--on" : ""}`} aria-hidden="true" />
          </button>
        ))}
        <span className="sh-encbar__chevron" aria-hidden="true" />
        {LAYER_ORDER.map((l) => (
          <button
            key={l}
            type="button"
            className={`ma-btn ma-btn--layer sh-encbar__layer${layer === l ? " ma-btn--active" : ""}`}
            style={layerStyle(LAYER_COLORS[l])}
            aria-pressed={layer === l}
            onClick={() => setLayer(l)}
          >
            {LAYER_LABELS[l]}
            <span className={`ma-btn__dot${layer === l ? " ma-btn__dot--on" : ""}`} aria-hidden="true" />
          </button>
        ))}
        <div className="sh-encbar__steps" aria-label="Pas de phaser">
          <button type="button" className="ma-btn sh-encbar__step" onClick={() => unavailable("Pas de phaser")} aria-label="Pas précédent">
            <IconArrowLeft />
          </button>
          <button type="button" className="ma-btn sh-encbar__step sh-encbar__step--num" onClick={() => unavailable("Pas de phaser")} aria-label="Pas courant">
            1<span className="sh-encbar__step-slash" aria-hidden="true"><IconSlash /></span>
          </button>
          <button type="button" className="ma-btn sh-encbar__step" onClick={() => unavailable("Pas de phaser")} aria-label="Pas suivant">
            <IconArrowRight />
          </button>
          <button type="button" className="ma-btn sh-encbar__step" onClick={() => unavailable("Pas de phaser")} aria-label="Boucle des pas">
            <IconStepLoop />
          </button>
        </div>
      </div>

      {/* ---- Rangée 3 ---- */}
      <div className="sh-encbar__row sh-encbar__row3">
        <div className="sh-encbar__col">
          <button type="button" className="ma-btn sh-encbar__side sh-encbar__side--half" onClick={cycleAlign} title="Align">
            <span className="ma-btn__small">Align</span>
            <span className="sh-encbar__sideval">{ALIGN_LABELS[align]}</span>
            <span className="ma-btn__caret" aria-hidden="true" />
          </button>
          <button type="button" className="ma-btn sh-encbar__side sh-encbar__side--half" onClick={cycleReadout} title="Readout">
            <span className="ma-btn__small">Readout</span>
            <span className="sh-encbar__sideval">{READOUT_LABELS[readout]}</span>
            <span className="ma-btn__caret" aria-hidden="true" />
          </button>
        </div>
        {phaserParams
          ? phaserParams.map((p) => <PhaserEncoder key={p.label} param={p} running={running} />)
          : pageAttrs.map((attr, i) => <AttrEncoder key={attr ?? `empty-${i}`} attr={attr} selected={selected} readout={readout} layer={layer} />)}
        <ScreenEncoders />
      </div>

      {showSelection ? <SelectionOverlay onClose={() => setShowSelection(false)} /> : null}
    </>
  );
}

function Dots() {
  return (
    <span className="ma-btn__dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

// --- Encodeur d'attribut ---------------------------------------------------------------

type AttrEncoderProps = {
  attr: AttrKey | null;
  selected: PatchedFixture[];
  readout: Readout;
  layer: Layer;
  compact?: boolean;
};

export function AttrEncoder({ attr, selected, readout, layer, compact = false }: AttrEncoderProps) {
  // Canaux absolus de l'attribut sur toute la sélection (dédoublonnés).
  const channels = useMemo(() => {
    if (!attr) return [];
    const set = new Set<number>();
    for (const f of selected) for (const ch of channelsForAttr(f, attr)) set.add(ch);
    return [...set];
  }, [attr, selected]);
  const values = useChannels(channels);
  const active = useActiveChannels();

  const value = values.length > 0 ? Math.max(...values) : null;
  const isActive = channels.some((ch) => active[ch] !== undefined);
  const timing = layer === "fade" || layer === "delay";
  const disabled = attr === null || channels.length === 0 || timing;
  const label = attr ? ATTRIBUTES[attr].label : null;
  const display = timing ? "—" : value === null || attr === null ? "" : formatValue(value, attr, readout);

  const onDelta = useCallback(
    (d: number) => {
      if (!attr || value === null) return;
      if (layer === "relative") setAttribute(attr, d, { unit: "dmx", relative: true });
      else setAttribute(attr, clamp255(value + d), { unit: "dmx" });
    },
    [attr, layer, value]
  );
  const onSet = useCallback(
    (v: number) => {
      if (attr) setAttribute(attr, clamp255(v), { unit: "dmx" });
    },
    [attr]
  );
  const onOpen = useCallback(() => {
    if (!attr || !label) return;
    const payload: CalculatorPayload = {
      label,
      value: value === null ? null : Math.round((value / 255) * 100),
      onSubmit: (pct) => setAttribute(attr, pct, { unit: "percent" }),
      // « a Thru b » : fan linéaire dans l'ordre de sélection.
      onSubmitRange: (from, to) => {
        const n = selected.length;
        selected.forEach((f, i) => setAttribute(attr, n > 1 ? from + ((to - from) * i) / (n - 1) : from, { ids: [f.id], unit: "percent" }));
      }
    };
    openOverlay("calculator", payload);
  }, [attr, label, value, selected]);

  return (
    <Encoder
      label={label}
      display={display}
      value={value}
      active={isActive}
      disabled={disabled}
      onDelta={onDelta}
      onSet={onSet}
      onOpen={onOpen}
      compact={compact}
    />
  );
}

// --- Encodeur de phaser (couches Phaser Overall / Phaser Steps) ---------------------------------

/** Phaser en cours visant au moins un projecteur de la sélection (null sinon). */
function useRunningOnSelection(): RunningEffect | null {
  const running = useRunningEffects();
  const selection = useSelection();
  return useMemo(() => {
    if (selection.length === 0) return null;
    const ids = new Set(selection);
    return running.find((r) => r.fixtureIds.some((id) => ids.has(id))) ?? null;
  }, [running, selection]);
}

// Retouches locales en attente (debounce 150 ms) pour ne pas mitrailler le backend.
const PHASER_DEBOUNCE_MS = 150;

function PhaserEncoder({ param, running }: { param: PhaserParam; running: RunningEffect | null }) {
  const [local, setLocal] = useState<{ id: string; effect: DmxEffect } | null>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<{ running: RunningEffect; effect: DmxEffect } | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const effect = running ? (local && local.id === running.id ? local.effect : running.effect) : null;
  const value = effect ? param.get(effect) : null;

  const schedule = (next: DmxEffect) => {
    if (!running) return;
    setLocal({ id: running.id, effect: next });
    pending.current = { running, effect: next };
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const p = pending.current;
      pending.current = null;
      if (p) void updateEffect(p.running, p.effect);
    }, PHASER_DEBOUNCE_MS);
  };

  const onDelta = (d: number) => {
    if (!effect || value === null) return;
    const next = Math.max(param.min, Math.min(param.max, value + d * param.step));
    schedule(param.set(effect, next));
  };
  const onSet = (v: number) => {
    if (!effect) return;
    // v arrive en 0..255 (Home/End) : on le ramène aux bornes du paramètre.
    const next = v <= 0 ? param.min : param.max;
    schedule(param.set(effect, next));
  };

  return (
    <Encoder
      label={param.label}
      display={value === null ? "" : param.format(value)}
      value={value === null ? null : Math.round(((value - param.min) / (param.max - param.min)) * 255)}
      disabled={!running}
      onDelta={onDelta}
      onSet={onSet}
    />
  );
}

// --- Encodeurs d'écran (décoratifs) --------------------------------------------------------------

function ScreenEncoders() {
  return (
    <div className="sh-screenenc" aria-hidden="true">
      <div className="sh-screenenc__row">
        <span className="sh-screenenc__knob" />
        <span className="sh-screenenc__text">
          <span>Screen Y</span>
          <span>Display 1</span>
        </span>
      </div>
      <div className="sh-screenenc__row">
        <span className="sh-screenenc__knob" />
        <span className="sh-screenenc__text">
          <span>Screen X</span>
          <span>Display 1</span>
        </span>
      </div>
    </div>
  );
}

// --- Colonne Grand Master -----------------------------------------------------------------------

function GrandMasterColumn() {
  const gm = useStore(programmerStore, (s) => s.grandMaster);
  const blackout = useStore(programmerStore, (s) => s.blackout);
  const last = useRef<number | null>(null);
  const start = useRef(0);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = e.clientY;
    start.current = gm;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (last.current === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    // 2 px = 1 % : la colonne fait ~12 rem, soit une course complète en ~200 px.
    const delta = (last.current - e.clientY) / 2;
    const next = Math.max(0, Math.min(100, Math.round(start.current + delta)));
    if (next !== gm) setGrandMaster(next);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    last.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const notch = Math.sign(-e.deltaY);
    if (notch === 0) return;
    setGrandMaster(Math.max(0, Math.min(100, gm + notch * (e.shiftKey ? 1 : 5))));
  };

  return (
    <div className="sh-gm">
      <button type="button" className="ma-btn sh-gm__head" onClick={() => openOverlay("masterControls")} title="Master Controls">
        {"Grand\nMaster"}
        <span className="ma-btn__toggle ma-btn__toggle--empty" aria-hidden="true" />
      </button>
      <div
        className={`sh-gm__col${blackout ? " is-blackout" : ""}`}
        role="slider"
        tabIndex={0}
        aria-label="Grand Master"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={gm}
        aria-valuetext={blackout ? "Blackout" : `${gm} %`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={(e) => {
          const map: Record<string, number> = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
          const d = map[e.key];
          if (e.key === "Home") setGrandMaster(0);
          else if (e.key === "End") setGrandMaster(100);
          else if (d !== undefined) setGrandMaster(Math.max(0, Math.min(100, gm + d)));
          else return;
          e.preventDefault();
        }}
        title="Grand Master : glisser verticalement ou molette ; clic sur l'en-tête pour les Master Controls"
      >
        <div className="sh-gm__value">{blackout ? "B.O." : `${gm}%`}</div>
        <div className="sh-gm__body">
          <div className="sh-gm__fill" style={{ height: `${gm}%` }} />
        </div>
      </div>
    </div>
  );
}

// --- Command wing bar ---------------------------------------------------------------------------

function CommandWingBar() {
  const executors = useExecutors();
  const featureGroup = useStore(programmerStore, (s) => s.featureGroup);
  const encoderPage = useStore(programmerStore, (s) => s.encoderPage);
  const readout = useStore(programmerStore, (s) => s.readout);
  const layer = useStore(programmerStore, (s) => s.layer);
  const selected = useSelectedFixtures();
  const attrs = useMemo(() => attrsOfGroup(featureGroup), [featureGroup]);
  const pages = Math.max(1, Math.ceil(attrs.length / 4));
  const page = Math.max(0, Math.min(encoderPage, pages - 1));
  const wingAttrs: Array<AttrKey | null> = [0, 1].map((i) => attrs[page * 4 + i] ?? null);

  return (
    <div className="sh-wing">
      <div className="sh-wing__execs">
        {executors.slice(0, 10).map((ex) => (
          <WingExecutor key={ex.slot} slot={ex.slot} name={ex.scene?.name ?? null} level={ex.level} active={ex.active} />
        ))}
      </div>
      <div className="sh-wing__encs">
        {wingAttrs.map((attr, i) => (
          <AttrEncoder key={attr ?? `empty-${i}`} attr={attr} selected={selected} readout={readout} layer={layer} compact />
        ))}
      </div>
    </div>
  );
}

type WingExecutorProps = { slot: number; name: string | null; level: number; active: boolean };

function WingExecutor({ slot, name, level, active }: WingExecutorProps) {
  const go = async () => {
    const r = await goExecutor(slot);
    if (!r.ok) toast(r.message, "error");
  };
  const off = () => {
    const r = offExecutor(slot);
    if (!r.ok) toast(r.message, "error");
  };
  return (
    <div className={`sh-wing__exec${name ? "" : " is-empty"}${active ? " is-active" : ""}`}>
      <div className="sh-wing__exec-head">
        <span className="sh-wing__exec-num">{slot}</span>
        <span className="sh-wing__exec-name ma-ellipsis">{name ?? ""}</span>
        <span className={`ma-led${active ? " ma-led--green" : ""}`} aria-hidden="true" />
      </div>
      <Fader
        className="ma-fader--exec"
        orientation="horizontal"
        value={Math.round(level * 100)}
        onChange={(v) => setExecutorLevel(slot, v / 100)}
        label={`Executor ${slot}${name ? ` ${name}` : ""}`}
        disabled={!name}
        valueText={`${Math.round(level * 100)} %`}
      />
      <div className="sh-wing__exec-btns">
        <button type="button" className="ma-btn ma-btn--small ma-btn--ok ma-btn--active" disabled={!name} onClick={() => void go()}>
          Go+
        </button>
        <button type="button" className="ma-btn ma-btn--small" disabled={!name} onClick={off}>
          Off
        </button>
      </div>
    </div>
  );
}
