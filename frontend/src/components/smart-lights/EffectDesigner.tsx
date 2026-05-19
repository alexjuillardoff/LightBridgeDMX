import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Point3D,
  RgbColor,
  SmartLight,
  SmartLightEffectConfig
} from "@lightbridgedmx/shared";
import { api } from "../../lib/api";
import { hexToRgb, rgbToHex } from "./ZonePainter";

type Kind = "solid" | "gradient" | "chase" | "wave";

const DEFAULTS: Record<Kind, SmartLightEffectConfig> = {
  solid:    { kind: "solid", color: { r: 255, g: 100, b: 0 }, brightness: 100 },
  gradient: { kind: "gradient", from: { r: 255, g: 0, b: 0 }, to: { r: 0, g: 0, b: 255 }, direction: { x: 1, y: 0, z: 0 }, scrollSpeed: 0, brightness: 100 },
  chase:    { kind: "chase", color: { r: 0, g: 200, b: 255 }, bgColor: { r: 0, g: 0, b: 0 }, speed: 8, width: 4, bounce: false, brightness: 100 },
  wave:     { kind: "wave", from: { r: 100, g: 0, b: 200 }, to: { r: 0, g: 200, b: 255 }, direction: { x: 1, y: 0, z: 0 }, wavelength: 0.5, speed: 0.8, brightness: 100 }
};

/** Pick an effect kind + tune its parameters live. Each change debounce-pushes via /effect. */
export const EffectDesigner = ({
  light,
  onUpdated
}: {
  light: SmartLight;
  onUpdated: (light: SmartLight) => void;
}) => {
  const cur = light.currentEffect && light.currentEffect.kind !== "static" ? light.currentEffect : null;
  const initialKind: Kind = (cur?.kind as Kind) ?? "solid";
  const [config, setConfig] = useState<SmartLightEffectConfig>(cur ?? DEFAULTS[initialKind]);

  const apply = useMutation(
    (cfg: SmartLightEffectConfig) => api.smartLights.setEffect(light.id, cfg),
    { onSuccess: onUpdated }
  );
  const clear = useMutation(() => api.smartLights.setEffect(light.id, null), { onSuccess: onUpdated });

  // For "live tweak": apply on every change (cheap, backend just persists + emits)
  const updateAndApply = (next: SmartLightEffectConfig) => {
    setConfig(next);
    apply.mutate(next);
  };
  const changeKind = (kind: Kind) => {
    const next = DEFAULTS[kind];
    updateAndApply(next);
  };

  const streamingOn = light.streaming?.enabled ?? false;

  return (
    <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Effet position-aware</strong>
        {!streamingOn ? (
          <span style={{ fontSize: 11, color: "var(--accent-2)" }}>⚠ Streaming UDP requis</span>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
        {(["solid", "gradient", "chase", "wave"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => changeKind(k)}
            style={config.kind === k ? tabActive : tabInactive}
          >
            {k}
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
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, margin: "4px 0" }}>
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
    </div>
  );
};

const ColorRow = ({ label, value, onChange }: { label: string; value: RgbColor; onChange: (c: RgbColor) => void }) => (
  <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
    <span className="muted" style={{ fontSize: 12, width: 70 }}>{label}</span>
    <input
      type="color"
      value={rgbToHex(value)}
      onChange={(e) => onChange(hexToRgb(e.target.value))}
      style={{ width: 32, height: 28, padding: 0, border: "1px solid var(--border)", borderRadius: 6, background: "transparent" }}
    />
    <span style={{ fontSize: 11, color: "var(--muted)" }}>rgb({value.r},{value.g},{value.b})</span>
  </label>
);

const NumberRow = ({
  label, value, min, max, step, unit, onChange
}: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void;
}) => (
  <label style={{ display: "block", margin: "4px 0" }}>
    <div className="flex-between" style={{ marginBottom: 2 }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 12 }}>{value.toFixed(step && step < 1 ? 2 : 0)}{unit}</span>
    </div>
    <input type="range" min={min} max={max} step={step ?? 1} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: "100%" }} />
  </label>
);

const DirectionRow = ({ value, onChange }: { value: Point3D; onChange: (p: Point3D) => void }) => (
  <div style={{ margin: "4px 0" }}>
    <span className="muted" style={{ fontSize: 12 }}>Direction (XYZ)</span>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginTop: 2 }}>
      {(["x", "y", "z"] as const).map((axis) => (
        <label key={axis} style={{ fontSize: 11 }}>
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

const tabBase: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)"
};
const tabActive: React.CSSProperties = { ...tabBase, background: "var(--accent)", color: "#001a14", fontWeight: 600 };
const tabInactive: React.CSSProperties = { ...tabBase, background: "rgba(255,255,255,0.06)", color: "var(--text)" };
