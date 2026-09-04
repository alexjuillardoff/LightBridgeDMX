// Aperçu vivant de l'effet : la rangée de cellules telle que le moteur va la jouer,
// et la forme d'onde de la ligne en cours d'édition.
//
// Il ne s'agit pas d'une illustration : l'aperçu appelle `evaluateDmxEffect`, la
// MÊME fonction que le runner DMX (elle vit dans le package partagé pour ça), sur
// les MÊMES cellules que celles que la sélection produira. Ce qui bouge à l'écran
// est donc ce qui sortira sur le plateau — à la traduction en couleur près, qui
// passe elle aussi par la fonction partagée `effectLineColor`.
//
// C'est ce qui rend l'éditeur utilisable sans allumer les projecteurs : on règle
// une phase, un width ou un MAtricks en regardant l'écran, puis on lance.
import { useEffect, useMemo, useRef } from "react";
import {
  DmxEffect,
  EffectCell,
  applyCurve,
  effectLineColor,
  evaluateDmxEffect,
  formValue,
  spatialPositions
} from "@lightbridgedmx/shared";
import type { RgbColor } from "@lightbridgedmx/shared";
import { ATTRIBUTE_GROUP } from "./labels";

type Props = {
  effect: DmxEffect;
  /** Cellules de la sélection, développées comme le fera le moteur. */
  cells: EffectCell[];
  /** true quand la sélection est vide : les cellules sont alors fictives et on le dit. */
  virtual: boolean;
  /** Ligne dont on trace la forme d'onde (celle sélectionnée dans le tableau). */
  lineIndex: number;
};

// Au-delà, les cellules font moins d'un pixel et l'aperçu ne dit plus rien ;
// on l'annonce au lieu d'en dessiner 400 illisibles.
const MAX_CELLS = 160;
// L'aperçu tourne à ~25 images/s : assez pour lire un chenillard, dix fois moins
// coûteux qu'un rendu à chaque rafraîchissement d'écran.
const FRAME_MS = 40;

export const EffectPreview = ({ effect, cells, virtual, lineIndex }: Props) => {
  const shown = cells.length > MAX_CELLS ? cells.slice(0, MAX_CELLS) : cells;
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const cursorRef = useRef<SVGLineElement>(null);
  // Les réglages changent pendant que la boucle tourne : on les lit dans une ref
  // pour ne pas redémarrer l'animation (donc la phase) à chaque frappe.
  const stateRef = useRef({ effect, cells: shown });
  stateRef.current = { effect, cells: shown };

  const positions = useMemo(
    () => spatialPositions(shown, effect.spatial, effect.sides, effect.matricks?.groups ?? 1),
    [shown, effect.spatial, effect.sides, effect.matricks?.groups]
  );
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  // Y a-t-il une ligne de position ? Le point de visée n'a de sens que dans ce cas.
  const hasPosition = effect.lines.some((l) => ATTRIBUTE_GROUP[l.attribute] === "position");

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const t0 = performance.now();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      last = now;

      const { effect: fx, cells: cs } = stateRef.current;
      const n = cs.length;
      if (!n) return;
      const t = (now - t0) / 1000;
      const frames = evaluateDmxEffect(fx, n, t, positionsRef.current ?? undefined);

      for (let i = 0; i < n; i++) {
        const cell = cs[i];
        let rgb: RgbColor | null = null;
        let intensity: number | null = null;
        let pan: number | null = null;
        let tilt: number | null = null;

        for (let li = 0; li < fx.lines.length; li++) {
          const line = fx.lines[li];
          const frame = frames[li];
          if (frame.skipped[i]) continue;
          const v = frame.values[i];
          const hasChannel = cell.channels[line.attribute] !== undefined;

          switch (line.attribute) {
            case "pan":
              if (hasChannel) pan = v;
              break;
            case "tilt":
              if (hasChannel) tilt = v;
              break;
            case "red":
            case "green":
            case "blue": {
              if (!hasChannel) break;
              const base: RgbColor = rgb ?? { r: 0, g: 0, b: 0 };
              rgb = {
                r: line.attribute === "red" ? v * 255 : base.r,
                g: line.attribute === "green" ? v * 255 : base.g,
                b: line.attribute === "blue" ? v * 255 : base.b
              };
              break;
            }
            case "dimmer":
              // Canal d'intensité dédié : l'effet module la luminosité, et pose la
              // couleur déclarée sur le trio R/G/B s'il y en a un — c'est ce que fait
              // le runner. Sans canal d'intensité (chaque zone d'un ruban RGB), la
              // ligne devient elle-même un fondu bgColor -> color.
              if (hasChannel) {
                intensity = applyCurve(v, fx.curve);
                if (fx.color && cell.channels.red !== undefined) rgb = fx.color;
              } else if (cell.channels.red !== undefined) {
                rgb = effectLineColor(fx, "dimmer", applyCurve(v, fx.curve)) ?? rgb;
              }
              break;
            default:
              // « Couleur » et « Teinte » n'ont pas de canal a elles : elles pilotent
              // le trio R/G/B d'un coup, comme dans le runner.
              if (cell.channels.red !== undefined)
                rgb = effectLineColor(fx, line.attribute, v) ?? rgb;
              break;
          }
        }

        // Une cellule que rien ne touche reste noire — c'est aussi ce que fera le
        // plateau, où elle gardera simplement sa valeur d'avant l'effet.
        const k = intensity ?? (rgb ? 1 : 0);
        const c = rgb ?? { r: 255, g: 255, b: 255 };
        const el = cellRefs.current[i];
        if (el) {
          el.style.background = `rgb(${Math.round(c.r * k)},${Math.round(c.g * k)},${Math.round(
            c.b * k
          )})`;
        }
        const dot = dotRefs.current[i];
        if (dot) {
          dot.style.left = `${(pan ?? 0.5) * 100}%`;
          dot.style.top = `${(1 - (tilt ?? 0.5)) * 100}%`;
        }
      }

      // Curseur de lecture sur la forme d'onde : il parcourt un cycle complet.
      if (cursorRef.current) {
        const adv = (fx.speed / 60) * fx.rate * t;
        const x = (adv - Math.floor(adv)) * 100;
        cursorRef.current.setAttribute("x1", String(x));
        cursorRef.current.setAttribute("x2", String(x));
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Forme d'onde de la ligne éditée, sur un cycle. Statique : seul le curseur bouge.
  const line = effect.lines[Math.min(lineIndex, effect.lines.length - 1)];
  const path = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 100; i++) {
      const v = formValue(line, i / 100, 0);
      const scaled = (line.low + (line.high - line.low) * v) / 100;
      pts.push(`${i},${(1 - scaled) * 30}`);
    }
    return `M${pts.join(" L")}`;
  }, [line]);

  return (
    <div className="fx-preview">
      <div className="fx-preview-head">
        <span>Aperçu</span>
        <span className="fx-preview-note">
          {virtual
            ? "sélection vide — 12 cellules fictives"
            : `${cells.length} cellule${cells.length > 1 ? "s" : ""}${
                cells.length > MAX_CELLS ? ` (${MAX_CELLS} affichées)` : ""
              }`}
          {effect.spatial ? (positions ? " · phase 3D" : " · phase 3D sans géométrie → par rang") : ""}
        </span>
      </div>

      <div className="fx-cells">
        {shown.map((cell, i) => (
          <div
            key={`${cell.fixtureId}-${cell.cellIndex}`}
            className="fx-cell"
            ref={(el) => {
              cellRefs.current[i] = el;
            }}
          >
            {hasPosition ? (
              <span
                className="fx-cell-dot"
                ref={(el) => {
                  dotRefs.current[i] = el;
                }}
              />
            ) : null}
          </div>
        ))}
      </div>

      <svg className="fx-wave" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="15" x2="100" y2="15" className="fx-wave-mid" />
        <path d={path} className="fx-wave-path" />
        <line ref={cursorRef} x1="0" y1="0" x2="0" y2="30" className="fx-wave-cursor" />
      </svg>
    </div>
  );
};
