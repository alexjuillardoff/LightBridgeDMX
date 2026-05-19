import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RgbColor, SmartLight, SmartLightZoneLayout } from "@lightbridgedmx/shared";
import { api } from "../../lib/api";

/** Paint each of the N zones a color, then commit via /effect (kind:"static")
 *  so the EffectEngine drives them continuously (works only when streaming is on).
 *
 *  Brush has a special "spare" mode: paints the zone as physically absent (no LED behind it),
 *  stored in zoneLayout.spareZones. Spare zones are forced black by the EffectEngine and
 *  hidden in the 3D editor. */
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

  const initialSpare = useMemo<Set<number>>(
    () => new Set(light.zoneLayout?.spareZones ?? []),
    [light.zoneLayout]
  );

  const [palette, setPalette] = useState<RgbColor[]>(initialPalette);
  const [spare, setSpare] = useState<Set<number>>(initialSpare);
  // `brush` can be a color OR the special "spare" marker (handled via brushMode).
  const [brushMode, setBrushMode] = useState<"color" | "spare">("color");
  const [brush, setBrush] = useState<RgbColor>({ r: 255, g: 100, b: 0 });
  const [isPainting, setIsPainting] = useState(false);

  const apply = useMutation(
    (next: RgbColor[]) =>
      api.smartLights.setEffect(light.id, { kind: "static", palette: next, brightness: 100 }),
    { onSuccess: onUpdated }
  );

  const saveLayout = useMutation(
    (nextLayout: SmartLightZoneLayout) => api.smartLights.setLayout(light.id, nextLayout),
    { onSuccess: onUpdated }
  );

  const paint = (i: number) => {
    if (brushMode === "spare") {
      setSpare((prev) => {
        const next = new Set(prev);
        next.add(i);
        return next;
      });
      setPalette((prev) => {
        const next = [...prev];
        next[i] = { r: 0, g: 0, b: 0 };
        return next;
      });
    } else {
      setPalette((prev) => {
        const next = [...prev];
        next[i] = brush;
        return next;
      });
      // Painting a color over a spare zone implicitly un-spares it.
      if (spare.has(i)) {
        setSpare((prev) => {
          const next = new Set(prev);
          next.delete(i);
          return next;
        });
      }
    }
  };

  const fillAll = (color: RgbColor) => {
    const next = Array.from({ length: zoneCount }, () => color);
    setPalette(next);
  };

  const commit = () => {
    apply.mutate(palette);
    // Also persist the spare set into the layout (preserving existing segments if any).
    const baseLayout: SmartLightZoneLayout = light.zoneLayout
      ? { ...light.zoneLayout, segments: light.zoneLayout.segments.slice() }
      : {
          mode: "linked",
          segments: Array.from({ length: zoneCount }, (_, i) => ({
            start: { x: i / zoneCount - 0.5, y: 0, z: 0 },
            end: { x: (i + 1) / zoneCount - 0.5, y: 0, z: 0 }
          }))
        };
    saveLayout.mutate({ ...baseLayout, spareZones: [...spare].sort((a, b) => a - b) });
  };

  const streamingOn = light.streaming?.enabled ?? false;

  const activeCount = zoneCount - spare.size;

  return (
    <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
      <div className="flex-between" style={{ marginBottom: 6 }}>
        <strong style={{ fontSize: 13 }}>
          Painter — {activeCount} actives / {spare.size} spare / {zoneCount} total
        </strong>
        {!streamingOn ? (
          <span style={{ fontSize: 11, color: "var(--accent-2)" }}>⚠ active Streaming UDP pour voir le rendu live</span>
        ) : null}
      </div>

      {/* Brush + palette presets + spare toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          type="color"
          value={rgbToHex(brush)}
          onChange={(e) => { setBrush(hexToRgb(e.target.value)); setBrushMode("color"); }}
          style={{ ...swatchBoxStyle, outline: brushMode === "color" ? "2px solid var(--accent)" : "none" }}
          title="Pinceau couleur"
        />
        <div style={{ display: "flex", gap: 4 }}>
          {PRESETS.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setBrush(c); setBrushMode("color"); }}
              title={`R${c.r} G${c.g} B${c.b}`}
              style={{
                width: 22, height: 22, borderRadius: 4,
                background: `rgb(${c.r},${c.g},${c.b})`,
                border: brushMode === "color" && brush.r === c.r && brush.g === c.g && brush.b === c.b
                  ? "2px solid var(--accent)" : "1px solid rgba(255,255,255,0.15)",
                cursor: "pointer", padding: 0
              }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setBrushMode("spare")}
          title="Marquer comme spare (zone non câblée physiquement)"
          style={{
            width: 22, height: 22, borderRadius: 4, padding: 0,
            background: "repeating-linear-gradient(45deg, #444, #444 3px, #222 3px, #222 6px)",
            border: brushMode === "spare" ? "2px solid var(--accent)" : "1px solid rgba(255,255,255,0.15)",
            cursor: "pointer"
          }}
        />
        <button type="button" onClick={() => fillAll(brush)} style={buttonStyleSecondary}>Fill all</button>
        <button type="button" onClick={() => { fillAll({ r: 0, g: 0, b: 0 }); setSpare(new Set()); }} style={buttonStyleSecondary}>Clear</button>
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
        {palette.map((c, i) => {
          const isSpare = spare.has(i);
          return (
            <div
              key={i}
              onMouseDown={() => { setIsPainting(true); paint(i); }}
              onMouseEnter={() => { if (isPainting) paint(i); }}
              onContextMenu={(e) => {
                e.preventDefault();
                setSpare((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i); else next.add(i);
                  return next;
                });
              }}
              title={isSpare ? `Zone ${i}: SPARE (clic droit pour réactiver)` : `Zone ${i}: rgb(${c.r}, ${c.g}, ${c.b}) — clic droit pour marquer spare`}
              style={{
                background: isSpare
                  ? "repeating-linear-gradient(45deg, #555, #555 2px, #222 2px, #222 4px)"
                  : `rgb(${c.r}, ${c.g}, ${c.b})`,
                borderRadius: 2,
                cursor: "crosshair"
              }}
            />
          );
        })}
      </div>

      <p className="muted" style={{ fontSize: 11, margin: "4px 0 0 0" }}>
        Clic = peindre · Clic droit = toggle spare · Pinceau hachuré = mode spare
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          style={buttonStylePrimary}
          disabled={apply.isLoading || saveLayout.isLoading}
          onClick={commit}
        >
          {(apply.isLoading || saveLayout.isLoading) ? "Envoi…" : "Appliquer (palette + spare)"}
        </button>
        <button
          type="button"
          style={buttonStyleSecondary}
          onClick={() => { setPalette(initialPalette); setSpare(initialSpare); }}
        >
          Reset
        </button>
      </div>
      {apply.error ? (
        <p style={{ color: "var(--danger)", fontSize: 12, margin: "4px 0 0 0" }}>
          {(apply.error as Error).message}
        </p>
      ) : null}
      {saveLayout.error ? (
        <p style={{ color: "var(--danger)", fontSize: 12, margin: "4px 0 0 0" }}>
          {(saveLayout.error as Error).message}
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
