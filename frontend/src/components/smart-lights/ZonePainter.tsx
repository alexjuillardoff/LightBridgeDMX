// Editeur de palette par zone pour un bandeau LED (strip) connecte.
// L'utilisateur peint chaque zone du strip avec une couleur, puis envoie le
// resultat au backend en tant qu'effet "static". Le moteur d'effets (EffectEngine)
// rejoue ensuite cette palette en continu. Le rendu live n'est visible que si le
// streaming UDP est actif.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RgbColor, SmartLight, SmartLightZoneLayout } from "@lightbridgedmx/shared";
import { api } from "../../lib/api";

/** Peint chacune des N zones avec une couleur, puis valide via /effect (kind:"static")
 *  pour que le moteur d'effets (EffectEngine) les pilote en continu (ne fonctionne
 *  que lorsque le streaming UDP est actif).
 *
 *  Le pinceau a un mode special "spare" : il marque la zone comme physiquement absente
 *  (pas de LED derriere), stockee dans zoneLayout.spareZones. Les zones spare sont forcees
 *  en noir par le moteur d'effets et masquees dans l'editeur 3D. */
export const ZonePainter = ({
  light,
  onUpdated
}: {
  light: SmartLight;
  onUpdated: (light: SmartLight) => void;
}) => {
  // Nombre de zones du strip (par defaut 50, ex. le Nanoleaf NL72K3).
  const zoneCount = light.streaming?.zoneCount ?? 50;

  // Palette de depart : on reprend la palette de l'effet "static" en cours s'il en
  // existe une de la bonne taille, sinon on part d'un strip tout noir.
  const initialPalette = useMemo<RgbColor[]>(() => {
    if (light.currentEffect?.kind === "static") {
      const p = light.currentEffect.palette;
      if (p.length === zoneCount) return p;
    }
    return Array.from({ length: zoneCount }, () => ({ r: 0, g: 0, b: 0 }));
  }, [light.currentEffect, zoneCount]);

  // Ensemble des zones spare (LED non cablees) deja enregistrees dans le layout.
  const initialSpare = useMemo<Set<number>>(
    () => new Set(light.zoneLayout?.spareZones ?? []),
    [light.zoneLayout]
  );

  const [palette, setPalette] = useState<RgbColor[]>(initialPalette);
  const [spare, setSpare] = useState<Set<number>>(initialSpare);
  // Le pinceau peut etre une couleur OU le marqueur special "spare" (gere via brushMode).
  const [brushMode, setBrushMode] = useState<"color" | "spare">("color");
  const [brush, setBrush] = useState<RgbColor>({ r: 255, g: 100, b: 0 });
  // Vrai tant que le bouton souris est enfonce : permet de peindre en glissant.
  const [isPainting, setIsPainting] = useState(false);

  // Envoie la palette au backend comme effet "static" (le moteur d'effets la rejoue).
  const apply = useMutation(
    (next: RgbColor[]) =>
      api.smartLights.setEffect(light.id, { kind: "static", palette: next, brightness: 100 }),
    { onSuccess: onUpdated }
  );

  // Enregistre la disposition (layout) du strip, dont la liste des zones spare.
  const saveLayout = useMutation(
    (nextLayout: SmartLightZoneLayout) => api.smartLights.setLayout(light.id, nextLayout),
    { onSuccess: onUpdated }
  );

  // Applique le pinceau a la zone i (clic ou survol pendant le glisser).
  const paint = (i: number) => {
    if (brushMode === "spare") {
      // Mode spare : on marque la zone comme non cablee et on la force en noir.
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
      // Peindre une couleur sur une zone spare la sort automatiquement du mode spare.
      if (spare.has(i)) {
        setSpare((prev) => {
          const next = new Set(prev);
          next.delete(i);
          return next;
        });
      }
    }
  };

  // Remplit toutes les zones avec une meme couleur.
  const fillAll = (color: RgbColor) => {
    const next = Array.from({ length: zoneCount }, () => color);
    setPalette(next);
  };

  // Valide le travail : envoie la palette en effet "static" ET enregistre les zones spare
  // dans le layout, en deux requetes distinctes.
  const commit = () => {
    apply.mutate(palette);
    // On persiste aussi l'ensemble des zones spare dans le layout (en gardant les
    // segments existants s'il y en a). Sinon, on cree un layout lineaire par defaut :
    // chaque zone occupe un segment regulier sur l'axe x, centre autour de 0 (d'ou le -0.5).
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

  // Nombre de zones reellement actives (total moins les zones spare).
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

      {/* Barre d'outils : pinceau couleur + presets de couleurs + bascule mode spare + Fill/Clear */}
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

      {/* Le strip lui-meme : une grille d'une cellule par zone, peinte au clic/glisser */}
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
              // Clic droit : bascule rapidement la zone en spare ou la reactive,
              // sans changer le mode de pinceau courant.
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

// Couleurs predefinies proposees comme raccourcis de pinceau.
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

// Convertit une couleur RGB (0-255) en chaine hex "#rrggbb" pour l'input <input type="color">.
export function rgbToHex(c: RgbColor): string {
  const hx = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hx(c.r)}${hx(c.g)}${hx(c.b)}`;
}
// Convertit une chaine hex "#rrggbb" (ou sans #) renvoyee par l'input couleur en RGB (0-255).
export function hexToRgb(hex: string): RgbColor {
  const clean = hex.replace(/^#/, "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}
