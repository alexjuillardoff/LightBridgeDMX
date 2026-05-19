import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RgbColor, SmartLight } from "@lightbridgedmx/shared";
import { api } from "../../lib/api";

/** Paint each of the N zones a color, then commit via /effect (kind:"static")
 *  so the EffectEngine drives them continuously (works only when streaming is on). */
export const ZonePainter = ({
  light,
  onUpdated
}: {
  light: SmartLight;
  onUpdated: (light: SmartLight) => void;
}) => {
  const zoneCount = light.streaming?.zoneCount ?? 50;
  const initialPalette = useMemo<RgbColor[]>(() => {
    if (light.currentEffect?.kind === "static") {
      const p = light.currentEffect.palette;
      if (p.length === zoneCount) return p;
    }
    return Array.from({ length: zoneCount }, () => ({ r: 0, g: 0, b: 0 }));
  }, [light.currentEffect, zoneCount]);

  const [palette, setPalette] = useState<RgbColor[]>(initialPalette);
  const [brush, setBrush] = useState<RgbColor>({ r: 255, g: 100, b: 0 });
  const [isPainting, setIsPainting] = useState(false);

  const apply = useMutation(
    (next: RgbColor[]) =>
      api.smartLights.setEffect(light.id, { kind: "static", palette: next, brightness: 100 }),
    { onSuccess: onUpdated }
  );

  const paint = (i: number) => {
    setPalette((prev) => {
      const next = [...prev];
      next[i] = brush;
      return next;
    });
  };

  const fillAll = (color: RgbColor) => {
    const next = Array.from({ length: zoneCount }, () => color);
    setPalette(next);
  };

  const commit = () => apply.mutate(palette);

  const streamingOn = light.streaming?.enabled ?? false;

  return (
    <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
      <div className="flex-between" style={{ marginBottom: 6 }}>
        <strong style={{ fontSize: 13 }}>Painter ({zoneCount} zones)</strong>
        {!streamingOn ? (
          <span style={{ fontSize: 11, color: "var(--accent-2)" }}>⚠ active Streaming UDP pour voir le rendu live</span>
        ) : null}
      </div>

      {/* Brush + palette presets */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input
          type="color"
          value={rgbToHex(brush)}
          onChange={(e) => setBrush(hexToRgb(e.target.value))}
          style={swatchBoxStyle}
          title="Pinceau"
        />
        <div style={{ display: "flex", gap: 4 }}>
          {PRESETS.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setBrush(c)}
              title={`R${c.r} G${c.g} B${c.b}`}
              style={{
                width: 22, height: 22, borderRadius: 4,
                background: `rgb(${c.r},${c.g},${c.b})`,
                border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", padding: 0
              }}
            />
          ))}
        </div>
        <button type="button" onClick={() => fillAll(brush)} style={buttonStyleSecondary}>Fill all</button>
        <button type="button" onClick={() => fillAll({ r: 0, g: 0, b: 0 })} style={buttonStyleSecondary}>Clear</button>
      </div>

      {/* The strip */}
      <div
        onMouseLeave={() => setIsPainting(false)}
        onMouseUp={() => setIsPainting(false)}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${zoneCount}, 1fr)`,
          gap: 1,
          height: 32,
          padding: 2,
          background: "#000",
          borderRadius: 6,
          userSelect: "none"
        }}
      >
        {palette.map((c, i) => (
          <div
            key={i}
            onMouseDown={() => { setIsPainting(true); paint(i); }}
            onMouseEnter={() => { if (isPainting) paint(i); }}
            title={`Zone ${i}: rgb(${c.r}, ${c.g}, ${c.b})`}
            style={{
              background: `rgb(${c.r}, ${c.g}, ${c.b})`,
              borderRadius: 2,
              cursor: "crosshair"
            }}
          />
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          style={buttonStylePrimary}
          disabled={apply.isLoading}
          onClick={commit}
        >
          {apply.isLoading ? "Envoi…" : "Appliquer"}
        </button>
        <button
          type="button"
          style={buttonStyleSecondary}
          onClick={() => setPalette(initialPalette)}
        >
          Reset
        </button>
      </div>
      {apply.error ? (
        <p style={{ color: "var(--danger)", fontSize: 12, margin: "4px 0 0 0" }}>
          {(apply.error as Error).message}
        </p>
      ) : null}
    </div>
  );
};

const PRESETS: RgbColor[] = [
  { r: 255, g: 0, b: 0 }, { r: 255, g: 100, b: 0 }, { r: 255, g: 255, b: 0 },
  { r: 0, g: 255, b: 0 }, { r: 0, g: 200, b: 255 }, { r: 0, g: 0, b: 255 },
  { r: 200, g: 0, b: 255 }, { r: 255, g: 255, b: 255 }
];

const buttonStylePrimary: React.CSSProperties = {
  padding: "6px 12px", background: "var(--accent)", color: "#001a14",
  border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13
};
const buttonStyleSecondary: React.CSSProperties = {
  padding: "6px 12px", background: "rgba(255,255,255,0.06)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 13
};
const swatchBoxStyle: React.CSSProperties = {
  width: 32, height: 32, padding: 0, border: "1px solid var(--border)",
  borderRadius: 6, background: "transparent"
};

export function rgbToHex(c: RgbColor): string {
  const hx = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hx(c.r)}${hx(c.g)}${hx(c.b)}`;
}
export function hexToRgb(hex: string): RgbColor {
  const clean = hex.replace(/^#/, "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}
