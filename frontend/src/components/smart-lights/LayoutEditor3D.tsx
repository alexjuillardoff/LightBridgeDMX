import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Line, Html } from "@react-three/drei";
import { useMutation } from "@tanstack/react-query";
import * as THREE from "three";
import {
  Point3D,
  SmartLight,
  SmartLightZoneLayout,
  ZoneSegment,
  buildLinearLayout,
  buildRoomLoopLayout,
  buildUShapeLayout as buildUShape
} from "@lightbridgedmx/shared";
import { api } from "../../lib/api";

/**
 * Editeur 3D de la disposition (layout) physique, zone par zone, d'un bandeau LED (strip)
 * d'une lampe connectee (smart light).
 *
 * Role : permet a l'utilisateur de placer dans l'espace chaque zone du bandeau, pour que
 * le moteur d'effets sensible a la position (position-aware) sache ou se trouve chaque LED.
 *
 * Deux modes :
 *   - Linked (par defaut) — les zones consecutives partagent un point d'extremite et
 *     forment une polyligne. L'utilisateur edite N+1 points (50 zones -> 51 poignees).
 *   - Unlinked — chaque segment de zone est independant.
 *     L'utilisateur edite 2N points (100 poignees), utile pour les layouts ramifies / disjoints.
 *
 * Disposition par defaut : strip lineaire horizontal de x=0 a x=1.
 * L'utilisateur peut deplacer (drag) chaque poignee dans l'espace 3D. Le deplacement est
 * contraint au plan XZ par defaut ; on libere l'axe Y en decochant "Verrouiller Y".
 */
export const LayoutEditor3D = ({
  light,
  onUpdated
}: {
  light: SmartLight;
  onUpdated: (light: SmartLight) => void;
}) => {
  // Nombre de zones du bandeau (50 par defaut pour le NL72K3).
  const zoneCount = light.streaming?.zoneCount ?? 50;

  // Layout de depart : celui deja enregistre sur la lampe, sinon un strip lineaire genere.
  const initialLayout = useMemo<SmartLightZoneLayout>(() => {
    if (light.zoneLayout) return light.zoneLayout;
    return makeLinearLayout(zoneCount);
  }, [light.zoneLayout, zoneCount]);

  const [layout, setLayout] = useState<SmartLightZoneLayout>(initialLayout);
  const [mode, setMode] = useState<"linked" | "unlinked">(layout.mode ?? "linked");
  // yLocked : si vrai, le drag reste dans le plan horizontal XZ (l'altitude Y ne bouge pas).
  const [yLocked, setYLocked] = useState(true);
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  // hideSpare : masque les zones spare (LED non cablees) pour ne pas encombrer la vue 3D.
  const [hideSpare, setHideSpare] = useState(true);

  // Champs du preset U-shape : nombre de zones par cote (fond/gauche/avant/droit) dans
  // l'ordre de parcours du strip, plus les dimensions de la piece.
  // Les zones spare sont placees par defaut au DEBUT du strip (cote controleur).
  const totalActive = zoneCount - (layout.spareZones?.length ?? 0);
  const [showUForm, setShowUForm] = useState(false);
  const [uBack, setUBack] = useState(Math.floor(totalActive / 4));
  const [uLeft, setULeft] = useState(Math.floor(totalActive / 4));
  const [uFront, setUFront] = useState(Math.floor(totalActive / 4));
  const [uRight, setURight] = useState(totalActive - 3 * Math.floor(totalActive / 4));
  const [uWidth, setUWidth] = useState(4);
  const [uDepth, setUDepth] = useState(3);
  const [uSpareAtStart, setUSpareAtStart] = useState(true);

  // Preset Room loop (7 sections — voir buildRoomLoopLayout pour le trace exact).
  // Les valeurs par defaut reprennent le mapping precis du NL72K3 releve le 2026-05-19.
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [rBackRightFloor, setRBackRightFloor] = useState(5);
  const [rBackRightUp,    setRBackRightUp]    = useState(2);
  const [rTopRightToLeft, setRTopRightToLeft] = useState(17);
  const [rBackLeftDown,   setRBackLeftDown]   = useState(2);
  const [rLeftBToF,       setRLeftBToF]       = useState(4);
  const [rFrontLToR,      setRFrontLToR]      = useState(17);
  const [rRightFToB,      setRRightFToB]      = useState(3);
  const [rWidth,          setRWidth]          = useState(4);
  const [rDepth,          setRDepth]          = useState(3);
  const [rHeight,         setRHeight]         = useState(2.5);

  // Ensemble des index de zones spare, pour un test d'appartenance rapide (O(1)).
  const spareSet = useMemo(() => new Set(layout.spareZones ?? []), [layout.spareZones]);

  // Sauvegarde du layout cote serveur via l'API ; previent le parent au succes.
  const apply = useMutation(
    (next: SmartLightZoneLayout) => api.smartLights.setLayout(light.id, next),
    { onSuccess: onUpdated }
  );

  // Deplace une extremite (start ou end) d'une zone. En mode linked, on propage le point
  // deplace au voisin qui le partage pour que la polyligne reste connectee.
  const movePoint = (zoneIndex: number, end: "start" | "end", next: Point3D) => {
    setLayout((prev) => {
      // Copie en profondeur des segments pour ne pas muter l'etat React precedent.
      const segs = prev.segments.map((s) => ({ start: { ...s.start }, end: { ...s.end } }));
      segs[zoneIndex][end] = next;
      if ((prev.mode ?? "linked") === "linked") {
        // Propage le point d'extremite partage au segment voisin pour garder la polyligne connectee.
        if (end === "end" && zoneIndex + 1 < segs.length) {
          segs[zoneIndex + 1].start = next;
        }
        if (end === "start" && zoneIndex - 1 >= 0) {
          segs[zoneIndex - 1].end = next;
        }
      }
      return { ...prev, segments: segs };
    });
  };

  // Remet la disposition en ligne droite.
  const reset = () => {
    const next = makeLinearLayout(zoneCount);
    // On conserve les spareZones au reset : c'est une propriete du strip physique, pas du layout.
    setLayout({ ...next, spareZones: layout.spareZones });
  };

  // Bascule entre les modes linked et unlinked.
  const switchMode = (nextMode: "linked" | "unlinked") => {
    setMode(nextMode);
    setLayout((prev) => ({ ...prev, mode: nextMode }));
  };

  // Genere et applique une disposition en U a partir des champs du formulaire.
  const applyUShape = () => {
    const next = buildUShape({
      totalZones: zoneCount,
      backZones: uBack,
      leftZones: uLeft,
      frontZones: uFront,
      rightZones: uRight,
      width: uWidth,
      depth: uDepth,
      spareAtStart: uSpareAtStart
    });
    setLayout(next);
    setShowUForm(false);
  };

  // Genere et applique la boucle 3D autour de la piece (Room loop) a partir du formulaire.
  const applyRoomLoop = () => {
    const next = buildRoomLoopLayout({
      backRightFloorZones: rBackRightFloor,
      backRightUpZones: rBackRightUp,
      topRightToLeftZones: rTopRightToLeft,
      backLeftDownZones: rBackLeftDown,
      leftFloorBToFZones: rLeftBToF,
      frontFloorLToRZones: rFrontLToR,
      rightFloorFToBZones: rRightFToB,
      totalZones: zoneCount,
      width: rWidth,
      depth: rDepth,
      height: rHeight
    });
    setLayout(next);
    setShowRoomForm(false);
  };

  return (
    <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Layout 3D ({zoneCount} zones)</strong>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          Drag les sphères. Clic droit = rotation. Molette = zoom.
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <button type="button"
          onClick={() => switchMode(mode === "linked" ? "unlinked" : "linked")}
          style={buttonStyleSecondary}>
          Mode : <strong>{mode === "linked" ? "Linked (polyline)" : "Unlinked (libre)"}</strong>
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={yLocked} onChange={(e) => setYLocked(e.target.checked)} />
          Verrouiller Y
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={hideSpare} onChange={(e) => setHideSpare(e.target.checked)} />
          Cacher spare ({spareSet.size})
        </label>
        <button type="button" onClick={reset} style={buttonStyleSecondary}>Reset ligne</button>
        <button type="button" onClick={() => { setShowUForm(!showUForm); setShowRoomForm(false); }} style={buttonStyleSecondary}>
          {showUForm ? "Annuler U" : "🔲 U-shape"}
        </button>
        <button type="button" onClick={() => { setShowRoomForm(!showRoomForm); setShowUForm(false); }} style={buttonStyleSecondary}>
          {showRoomForm ? "Annuler Room loop" : "🏠 Room loop"}
        </button>
        <button type="button"
          onClick={() => apply.mutate(layout)}
          style={buttonStylePrimary}
          disabled={apply.isLoading}>
          {apply.isLoading ? "Enreg…" : "Enregistrer"}
        </button>
      </div>

      {showUForm ? (
        <div style={{ padding: 8, background: "rgba(255,255,255,0.04)", borderRadius: 6, marginBottom: 6 }}>
          <p className="muted" style={{ margin: "0 0 6px 0", fontSize: 12 }}>
            Génère un layout en U (counter-clockwise vu de dessus). Ordre le long du strip :{" "}
            <strong>{uSpareAtStart ? "spare → " : ""}fond → gauche → avant → droit{!uSpareAtStart ? " → spare" : ""}</strong>.<br />
            Total actif : <strong>{uBack + uLeft + uFront + uRight}</strong> / {zoneCount} —{" "}
            <strong>{Math.max(0, zoneCount - (uBack + uLeft + uFront + uRight))}</strong> auto-marquées spare.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
            <SidesInput label="Fond (jaune)" value={uBack} onChange={setUBack} />
            <SidesInput label="Gauche (vert)" value={uLeft} onChange={setULeft} />
            <SidesInput label="Avant (bleu)" value={uFront} onChange={setUFront} />
            <SidesInput label="Droit (rouge)" value={uRight} onChange={setURight} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
            <SidesInput label="Largeur (m)" value={uWidth} onChange={setUWidth} step={0.1} />
            <SidesInput label="Profondeur (m)" value={uDepth} onChange={setUDepth} step={0.1} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, marginBottom: 6 }}>
            <input type="checkbox" checked={uSpareAtStart} onChange={(e) => setUSpareAtStart(e.target.checked)} />
            Zones spare au début du strip (côté contrôleur)
          </label>
          <button type="button" onClick={applyUShape} style={buttonStylePrimary}>Appliquer U-shape</button>
        </div>
      ) : null}

      {showRoomForm ? (
        <div style={{ padding: 8, background: "rgba(255,255,255,0.04)", borderRadius: 6, marginBottom: 6 }}>
          <p className="muted" style={{ margin: "0 0 6px 0", fontSize: 12 }}>
            Boucle 3D autour de la pièce : strip entre au sol back-droit, monte au plafond, traverse le haut, redescend back-gauche, fait le tour au sol. <strong>7 sections</strong> dans l'ordre du strip.
            Total : <strong>{rBackRightFloor + rBackRightUp + rTopRightToLeft + rBackLeftDown + rLeftBToF + rFrontLToR + rRightFToB}</strong> / {zoneCount}.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
            <SidesInput label="Back-right sol (violet)" value={rBackRightFloor} onChange={setRBackRightFloor} />
            <SidesInput label="Montée back-right (orange)" value={rBackRightUp} onChange={setRBackRightUp} />
            <SidesInput label="Plafond droite→gauche (vert)" value={rTopRightToLeft} onChange={setRTopRightToLeft} />
            <SidesInput label="Descente back-left (cyan)" value={rBackLeftDown} onChange={setRBackLeftDown} />
            <SidesInput label="Gauche sol B→F (rouge)" value={rLeftBToF} onChange={setRLeftBToF} />
            <SidesInput label="Avant sol G→D (bleu)" value={rFrontLToR} onChange={setRFrontLToR} />
            <SidesInput label="Droite sol F→B (jaune)" value={rRightFToB} onChange={setRRightFToB} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
            <SidesInput label="Largeur W (m)" value={rWidth} onChange={setRWidth} step={0.1} />
            <SidesInput label="Profondeur D (m)" value={rDepth} onChange={setRDepth} step={0.1} />
            <SidesInput label="Hauteur H (m)" value={rHeight} onChange={setRHeight} step={0.1} />
          </div>
          <button type="button" onClick={applyRoomLoop} style={buttonStylePrimary}>Appliquer Room loop</button>
        </div>
      ) : null}

      {layout.sides && layout.sides.length > 0 ? (
        <p className="muted" style={{ fontSize: 11, margin: "0 0 6px 0" }}>
          Sides :{" "}
          {layout.sides.map((s, i) => (
            <span key={s.label} style={{ marginRight: 8 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, background: s.color ?? "#888", borderRadius: 2, verticalAlign: "middle", marginRight: 3 }} />
              {s.label} [{s.zoneStart}–{s.zoneEnd}]
              {i < (layout.sides?.length ?? 0) - 1 ? " ·" : ""}
            </span>
          ))}
        </p>
      ) : null}

      <div style={{ width: "100%", height: 360, background: "#050a18", borderRadius: 6, overflow: "hidden" }}>
        <Canvas camera={{ position: [1.5, 1.5, 1.5], fov: 50 }}>
          <ambientLight intensity={0.6} />
          <pointLight position={[2, 3, 2]} intensity={1.0} />
          <Grid args={[10, 10]} sectionColor="#1f2c44" cellColor="#142443" />
          <axesHelper args={[0.5]} />

          <Scene
            layout={layout}
            mode={mode}
            yLocked={yLocked}
            hideSpare={hideSpare}
            spareSet={spareSet}
            selectedZone={selectedZone}
            onSelectZone={setSelectedZone}
            onMovePoint={movePoint}
          />

          <OrbitControls makeDefault enableDamping />
        </Canvas>
      </div>

      <p className="muted" style={{ fontSize: 11, margin: "6px 0 0 0" }}>
        Zone sélectionnée :{" "}
        {selectedZone !== null ? (
          <strong>
            #{selectedZone} — start ({fmt(layout.segments[selectedZone].start)}) → end ({fmt(layout.segments[selectedZone].end)})
          </strong>
        ) : "(aucune)"}
      </p>
    </div>
  );
};

// Scene Three.js : dessine le bandeau (lignes colorees) et les poignees deplacables.
// Composant interne au Canvas react-three-fiber ; il ne gere pas l'etat, il l'affiche.
const Scene = ({
  layout,
  mode,
  yLocked,
  hideSpare,
  spareSet,
  selectedZone,
  onSelectZone,
  onMovePoint
}: {
  layout: SmartLightZoneLayout;
  mode: "linked" | "unlinked";
  yLocked: boolean;
  hideSpare: boolean;
  spareSet: Set<number>;
  selectedZone: number | null;
  onSelectZone: (i: number | null) => void;
  onMovePoint: (zone: number, end: "start" | "end", next: Point3D) => void;
}) => {
  // Le bandeau est dessine sous forme de lignes colorees reliant le start et le end de chaque segment.
  // Si un mapping `sides` existe, chaque segment prend la couleur de son cote (memes couleurs que le painter).
  const lines = useMemo(() => {
    // Retourne la couleur du cote (side) qui contient la zone i, ou null si aucun.
    const findSideColor = (i: number): string | null => {
      if (!layout.sides) return null;
      for (const s of layout.sides) {
        if (i >= s.zoneStart && i <= s.zoneEnd) return s.color ?? null;
      }
      return null;
    };
    return layout.segments
      .map((seg, i) => {
        const isSpare = spareSet.has(i);
        const sideColor = findSideColor(i);
        // Priorite des couleurs : zone selectionnee (vert) > spare (gris) > couleur du cote
        // > a defaut, teinte HSB repartie sur la roue selon l'index pour distinguer les zones.
        const color = selectedZone === i
          ? "#1dd3b0"
          : isSpare
            ? "#444"
            : sideColor ?? `hsl(${(i * 360) / layout.segments.length}, 70%, 55%)`;
        return { i, isSpare, points: [toV(seg.start), toV(seg.end)] as [THREE.Vector3, THREE.Vector3], color };
      })
      // Si "Cacher spare" est actif, on retire les segments spare de l'affichage.
      .filter((l) => !(hideSpare && l.isSpare));
  }, [layout, selectedZone, hideSpare, spareSet]);

  // Poignees deplacables :
  //   - mode linked : N+1 points uniques (le start de chaque zone + le end de la derniere) ;
  //   - mode unlinked : chaque start et chaque end, soit 2N poignees.
  // Quand elles sont masquees, les zones spare n'ont pas de poignee : elles ne sont pas physiquement la.
  const handles = useMemo(() => {
    const list: { key: string; pos: Point3D; zoneIndex: number; end: "start" | "end" }[] = [];
    if (mode === "linked") {
      layout.segments.forEach((seg, i) => {
        if (hideSpare && spareSet.has(i)) return;
        list.push({ key: `s${i}`, pos: seg.start, zoneIndex: i, end: "start" });
      });
      const last = layout.segments[layout.segments.length - 1];
      if (!(hideSpare && spareSet.has(layout.segments.length - 1))) {
        list.push({ key: `e${layout.segments.length - 1}`, pos: last.end, zoneIndex: layout.segments.length - 1, end: "end" });
      }
    } else {
      layout.segments.forEach((seg, i) => {
        if (hideSpare && spareSet.has(i)) return;
        list.push({ key: `s${i}`, pos: seg.start, zoneIndex: i, end: "start" });
        list.push({ key: `e${i}`, pos: seg.end, zoneIndex: i, end: "end" });
      });
    }
    return list;
  }, [layout, mode, hideSpare, spareSet]);

  return (
    <>
      {lines.map(({ i, points, color }) => (
        <Line
          key={i}
          points={points}
          color={color}
          lineWidth={selectedZone === i ? 5 : 2.5}
          onClick={() => onSelectZone(i)}
        />
      ))}
      {handles.map((h) => (
        <DraggableHandle
          key={h.key}
          position={h.pos}
          yLocked={yLocked}
          onChange={(next) => onMovePoint(h.zoneIndex, h.end, next)}
          isSelected={selectedZone === h.zoneIndex}
        />
      ))}
    </>
  );
};

/**
 * Petite sphere que l'utilisateur peut deplacer (drag) a la souris dans la scene 3D.
 * Le deplacement est contraint a un plan : Y verrouille = plan horizontal XZ ;
 * Y libere = plan vertical face a la camera (on bouge alors en hauteur).
 */
const DraggableHandle = ({
  position,
  yLocked,
  onChange,
  isSelected
}: {
  position: Point3D;
  yLocked: boolean;
  onChange: (next: Point3D) => void;
  isSelected: boolean;
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  // A chaque trame (frame), on recale la sphere sur la position courante. Cela garde la
  // poignee synchro avec l'etat React meme quand le point bouge en dehors du drag.
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.set(position.x, position.y, position.z);
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={[position.x, position.y, position.z]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "grab";
      }}
      onPointerOut={() => {
        setHovered(false);
        if (!dragging) document.body.style.cursor = "default";
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        setDragging(true);
        document.body.style.cursor = "grabbing";
        // On coupe l'orbite au debut du drag : les OrbitControls de drei lisent les
        // evenements pointeur, et le stopPropagation ci-dessus suffit a les empecher de s'activer.
      }}
      onPointerUp={() => {
        setDragging(false);
        document.body.style.cursor = hovered ? "grab" : "default";
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        // On lance un rayon (raycast) depuis le curseur vers un plan de drag, puis on prend
        // le point d'intersection comme nouvelle position de la poignee.
        //   - yLocked : plan horizontal a l'altitude Y actuelle (on glisse au sol).
        //   - sinon : plan passant par le point et faisant face a la camera (on glisse en hauteur).
        const plane = new THREE.Plane();
        if (yLocked) {
          plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(position.x, position.y, position.z));
        } else {
          const camDir = new THREE.Vector3();
          e.camera.getWorldDirection(camDir);
          plane.setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3(position.x, position.y, position.z));
        }
        const ray = e.ray;
        const point = new THREE.Vector3();
        if (ray.intersectPlane(plane, point)) {
          onChange({ x: point.x, y: point.y, z: point.z });
        }
      }}
    >
      <sphereGeometry args={[0.03, 16, 16]} />
      <meshStandardMaterial
        color={isSelected ? "#1dd3b0" : hovered || dragging ? "#f39c12" : "#e8f1ff"}
        emissive={isSelected ? "#1dd3b0" : "#000000"}
        emissiveIntensity={isSelected ? 0.6 : 0}
      />
      {/* Au survol, on affiche les coordonnees du point dans une petite etiquette HTML. */}
      {hovered ? (
        <Html distanceFactor={8} style={{ pointerEvents: "none", fontSize: 11, color: "#fff", background: "rgba(0,0,0,0.7)", padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
          {fmt(position)}
        </Html>
      ) : null}
    </mesh>
  );
};

// ----- helpers -----

// Convertit un Point3D (x,y,z) en Vector3 Three.js pour le rendu.
const toV = (p: Point3D): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
// Formate un point en texte court "x, y, z" arrondi a 2 decimales (etiquettes/affichage).
const fmt = (p: Point3D) => `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;

// Construit une disposition en ligne droite. Delegue au builder partage pour rester
// coherent avec le backend et le moteur d'effets.
function makeLinearLayout(zoneCount: number): SmartLightZoneLayout {
  return buildLinearLayout(zoneCount);
}

// Champ numerique reutilisable pour les formulaires de presets (cote U-shape, dimensions...).
const SidesInput = ({
  label,
  value,
  onChange,
  step = 1
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) => (
  <label style={{ fontSize: 11, color: "var(--muted)" }}>
    {label}
    <input
      type="number"
      step={step}
      min={0}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        display: "block",
        width: "100%",
        marginTop: 2,
        padding: "4px 6px",
        background: "rgba(0,0,0,0.25)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        fontSize: 12
      }}
    />
  </label>
);

// Styles partages des boutons : primaire (action principale, ex. Enregistrer) et secondaire.
const buttonStylePrimary: React.CSSProperties = {
  padding: "6px 12px", background: "var(--accent)", color: "#001a14",
  border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13
};
const buttonStyleSecondary: React.CSSProperties = {
  padding: "6px 12px", background: "rgba(255,255,255,0.06)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 13
};
