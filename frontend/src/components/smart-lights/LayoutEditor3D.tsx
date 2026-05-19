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
  buildUShapeLayout as buildUShape
} from "@lightbridgedmx/shared";
import { api } from "../../lib/api";

/**
 * 3D editor for the per-zone physical layout of a smart light strip.
 *
 * Two modes:
 *   • Linked (default) — consecutive zones share an endpoint, forming a polyline.
 *     User edits N+1 points (50 zones → 51 handles).
 *   • Unlinked — every zone segment is independent.
 *     User edits 2N points (100 handles), useful for branched / disjoint layouts.
 *
 * Default layout: linear horizontal strip from x=0 to x=1.
 * User can drag any handle in 3D space (constrained to the XZ plane by default; Y unlocks via shift).
 */
export const LayoutEditor3D = ({
  light,
  onUpdated
}: {
  light: SmartLight;
  onUpdated: (light: SmartLight) => void;
}) => {
  const zoneCount = light.streaming?.zoneCount ?? 50;

  const initialLayout = useMemo<SmartLightZoneLayout>(() => {
    if (light.zoneLayout) return light.zoneLayout;
    return makeLinearLayout(zoneCount);
  }, [light.zoneLayout, zoneCount]);

  const [layout, setLayout] = useState<SmartLightZoneLayout>(initialLayout);
  const [mode, setMode] = useState<"linked" | "unlinked">(layout.mode ?? "linked");
  const [yLocked, setYLocked] = useState(true);
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [hideSpare, setHideSpare] = useState(true);

  // U-shape preset inputs (back/right/front/left counts + room dimensions)
  const totalActive = zoneCount - (layout.spareZones?.length ?? 0);
  const [showUForm, setShowUForm] = useState(false);
  const [uBack, setUBack] = useState(Math.floor(totalActive / 4));
  const [uRight, setURight] = useState(Math.floor(totalActive / 4));
  const [uFront, setUFront] = useState(Math.floor(totalActive / 4));
  const [uLeft, setULeft] = useState(totalActive - 3 * Math.floor(totalActive / 4));
  const [uWidth, setUWidth] = useState(4);
  const [uDepth, setUDepth] = useState(3);

  const spareSet = useMemo(() => new Set(layout.spareZones ?? []), [layout.spareZones]);

  const apply = useMutation(
    (next: SmartLightZoneLayout) => api.smartLights.setLayout(light.id, next),
    { onSuccess: onUpdated }
  );

  const movePoint = (zoneIndex: number, end: "start" | "end", next: Point3D) => {
    setLayout((prev) => {
      const segs = prev.segments.map((s) => ({ start: { ...s.start }, end: { ...s.end } }));
      segs[zoneIndex][end] = next;
      if ((prev.mode ?? "linked") === "linked") {
        // Propagate the shared endpoint to the neighbor segment so the polyline stays connected.
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

  const reset = () => {
    const next = makeLinearLayout(zoneCount);
    // Preserve spareZones across reset (they're a property of the physical strip, not the layout).
    setLayout({ ...next, spareZones: layout.spareZones });
  };

  const switchMode = (nextMode: "linked" | "unlinked") => {
    setMode(nextMode);
    setLayout((prev) => ({ ...prev, mode: nextMode }));
  };

  const applyUShape = () => {
    const next = buildUShape({
      totalZones: zoneCount,
      backZones: uBack,
      rightZones: uRight,
      frontZones: uFront,
      leftZones: uLeft,
      width: uWidth,
      depth: uDepth
    });
    // Merge user-provided spareZones if any (auto-generated spares from buildUShape are inferred,
    // but user may have manually marked extras as spare via the painter).
    const merged = new Set([...(layout.spareZones ?? []), ...(next.spareZones ?? [])]);
    setLayout({ ...next, spareZones: [...merged].sort((a, b) => a - b) });
    setShowUForm(false);
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
        <button type="button" onClick={() => setShowUForm(!showUForm)} style={buttonStyleSecondary}>
          {showUForm ? "Annuler U" : "🔲 Preset U-shape"}
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
            Génère un layout en U autour d'une pièce rectangulaire. Total actif :{" "}
            <strong>{uBack + uRight + uFront + uLeft}</strong> / {zoneCount} zones —{" "}
            <strong>{Math.max(0, zoneCount - (uBack + uRight + uFront + uLeft))}</strong> auto-marquées spare.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
            <SidesInput label="Fond (jaune)" value={uBack} onChange={setUBack} />
            <SidesInput label="Droit (rouge)" value={uRight} onChange={setURight} />
            <SidesInput label="Avant (bleu)" value={uFront} onChange={setUFront} />
            <SidesInput label="Gauche (vert)" value={uLeft} onChange={setULeft} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
            <SidesInput label="Largeur (m)" value={uWidth} onChange={setUWidth} step={0.1} />
            <SidesInput label="Profondeur (m)" value={uDepth} onChange={setUDepth} step={0.1} />
          </div>
          <button type="button" onClick={applyUShape} style={buttonStylePrimary}>Appliquer U-shape</button>
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
  // Strip rendered as colored lines between each segment's start and end.
  // If a `sides` mapping exists, color each segment by its side (matches the painter convention).
  const lines = useMemo(() => {
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
        const color = selectedZone === i
          ? "#1dd3b0"
          : isSpare
            ? "#444"
            : sideColor ?? `hsl(${(i * 360) / layout.segments.length}, 70%, 55%)`;
        return { i, isSpare, points: [toV(seg.start), toV(seg.end)] as [THREE.Vector3, THREE.Vector3], color };
      })
      .filter((l) => !(hideSpare && l.isSpare));
  }, [layout, selectedZone, hideSpare, spareSet]);

  // Handle points: in linked mode show N+1 unique points (start of each + end of last);
  // in unlinked mode show every start and every end (2N).
  // Spare zones don't get handles when hidden — they're not physically there.
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

/** A small sphere the user can pointer-drag in 3D. Drags are constrained to a plane
 *  (Y locked = XZ horizontal plane; unlocked = XY vertical plane through the camera). */
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
        // Disable orbit on drag start: drei OrbitControls reads pointer events,
        // and stopPropagation here is enough for it not to engage.
      }}
      onPointerUp={() => {
        setDragging(false);
        document.body.style.cursor = hovered ? "grab" : "default";
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        // Raycast against the drag plane: a horizontal plane (Y=current) when yLocked,
        // otherwise a plane through the current point facing the camera.
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
      {hovered ? (
        <Html distanceFactor={8} style={{ pointerEvents: "none", fontSize: 11, color: "#fff", background: "rgba(0,0,0,0.7)", padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
          {fmt(position)}
        </Html>
      ) : null}
    </mesh>
  );
};

// ─── helpers ────────────────────────────────────────────────────────────────

const toV = (p: Point3D): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
const fmt = (p: Point3D) => `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;

function makeLinearLayout(zoneCount: number): SmartLightZoneLayout {
  return buildLinearLayout(zoneCount);
}

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

const buttonStylePrimary: React.CSSProperties = {
  padding: "6px 12px", background: "var(--accent)", color: "#001a14",
  border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13
};
const buttonStyleSecondary: React.CSSProperties = {
  padding: "6px 12px", background: "rgba(255,255,255,0.06)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 13
};
