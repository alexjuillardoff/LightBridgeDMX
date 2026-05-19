import { lazy, Suspense, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  NanoleafDiscovered,
  SmartLight,
  SmartLightDmxMirror,
  SmartLightStateInput
} from "@lightbridgedmx/shared";
import { api } from "../lib/api";
import { ZonePainter } from "./smart-lights/ZonePainter";
import { EffectDesigner } from "./smart-lights/EffectDesigner";

// Lazy-load the 3D editor — three.js + drei is ~600KB, only paid for when opened.
const LayoutEditor3D = lazy(() =>
  import("./smart-lights/LayoutEditor3D").then((m) => ({ default: m.LayoutEditor3D }))
);

type Probe = { reachable: boolean; inPairingMode: boolean; status?: number } | null;

export const SmartLightsPanel = () => {
  const queryClient = useQueryClient();
  const lightsQuery = useQuery<SmartLight[]>(["smart-lights"], api.smartLights.list);

  const upsertLight = (light: SmartLight) => {
    queryClient.setQueryData<SmartLight[]>(["smart-lights"], (prev = []) => {
      const idx = prev.findIndex((l) => l.id === light.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = light;
        return next;
      }
      return [...prev, light];
    });
  };
  const removeLight = (id: string) => {
    queryClient.setQueryData<SmartLight[]>(["smart-lights"], (prev = []) =>
      prev.filter((l) => l.id !== id)
    );
  };

  return (
    <>
      <div className="section-title">
        <h2>Smart Lights</h2>
        <span className="muted">Nanoleaf et autres lampes WiFi pilotées par LightBridge</span>
      </div>
      <div className="grid">
        <PairCard onPaired={upsertLight} />
        {(lightsQuery.data ?? []).map((light) => (
          <SmartLightCard
            key={light.id}
            light={light}
            onUpdated={upsertLight}
            onDeleted={removeLight}
          />
        ))}
      </div>
    </>
  );
};

// ─── Pairing + Discovery ────────────────────────────────────────────────────

const PairCard = ({ onPaired }: { onPaired: (light: SmartLight) => void }) => {
  const [host, setHost] = useState("");
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [probe, setProbe] = useState<Probe>(null);
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<NanoleafDiscovered[]>([]);

  const probeMutation = useMutation(api.smartLights.probe, {
    onSuccess: (data) => {
      setProbe(data);
      setError(null);
    },
    onError: (err) => setError((err as Error).message)
  });
  const pairMutation = useMutation(api.smartLights.pair, {
    onSuccess: (light) => {
      onPaired(light);
      setError(null);
      setHost("");
      setName("");
      setProbe(null);
    },
    onError: (err) => setError((err as Error).message)
  });
  const discoverMutation = useMutation(() => api.smartLights.discover({ timeoutMs: 4000 }), {
    onSuccess: (data) => {
      setDiscovered(data.devices);
      setError(data.devices.length === 0 ? "Aucun Nanoleaf détecté sur le réseau" : null);
    },
    onError: (err) => setError((err as Error).message)
  });

  return (
    <div className="card">
      <h2>Pairer un Nanoleaf</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Tiens le bouton <strong>power</strong> du strip ~5–7 s jusqu'à ce que la LED pulse, puis clique
        sur <em>Pairer</em>.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value.trim())}
            placeholder="192.168.0.234"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="button"
            disabled={discoverMutation.isLoading}
            onClick={() => discoverMutation.mutate()}
            style={buttonStyleSecondary}
            title="Scanner le réseau via mDNS"
          >
            {discoverMutation.isLoading ? "Scan…" : "Scanner"}
          </button>
        </div>
        {discovered.length > 0 ? (
          <div style={{ fontSize: 12 }}>
            <span className="muted">Détectés : </span>
            {discovered.map((d) => (
              <button
                key={d.host}
                type="button"
                onClick={() => {
                  setHost(d.host);
                  setName(d.name ?? "");
                }}
                style={{ ...buttonStyleSecondary, marginLeft: 4, padding: "2px 6px" }}
              >
                {d.name ?? d.host} ({d.host})
              </button>
            ))}
          </div>
        ) : null}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom (optionnel)" style={inputStyle} />
        <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Pièce (optionnel)" style={inputStyle} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={!host || probeMutation.isLoading}
            onClick={() => probeMutation.mutate({ host })}
            style={buttonStyleSecondary}
          >
            {probeMutation.isLoading ? "Test…" : "Tester"}
          </button>
          <button
            type="button"
            disabled={!host || pairMutation.isLoading}
            onClick={() =>
              pairMutation.mutate({ host, name: name || undefined, room: room || undefined })
            }
            style={buttonStylePrimary}
          >
            {pairMutation.isLoading ? "Pairing…" : "Pairer"}
          </button>
        </div>
        {probe ? (
          <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            {probe.reachable
              ? probe.inPairingMode
                ? "API joignable, mode pairing détecté."
                : "API joignable. Mets le strip en pairing puis Pairer."
              : "API injoignable. Vérifie l'IP et l'option 'API' dans l'app Nanoleaf."}
          </p>
        ) : null}
        {error ? <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{error}</p> : null}
      </div>
    </div>
  );
};

// ─── Per-light card ─────────────────────────────────────────────────────────

const SmartLightCard = ({
  light,
  onUpdated,
  onDeleted
}: {
  light: SmartLight;
  onUpdated: (light: SmartLight) => void;
  onDeleted: (id: string) => void;
}) => {
  const state = light.state ?? { on: false, hue: 0, sat: 0, brightness: 0, reachable: true };
  const colorMode = state.colorMode ?? "hs";
  const streaming = light.streaming?.enabled ?? false;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tab, setTab] = useState<"none" | "painter" | "effect" | "layout3d">("none");

  const setState = useMutation(
    (body: SmartLightStateInput) => api.smartLights.setState(light.id, body),
    { onSuccess: onUpdated }
  );
  const deleteLight = useMutation(() => api.smartLights.delete(light.id), {
    onSuccess: () => onDeleted(light.id)
  });
  const updateLight = useMutation(
    (body: Parameters<typeof api.smartLights.update>[1]) => api.smartLights.update(light.id, body),
    { onSuccess: onUpdated }
  );
  const toggleStreaming = useMutation(
    (next: boolean) => api.smartLights.setStreaming(light.id, next),
    { onSuccess: onUpdated }
  );
  const effectsQuery = useQuery(["smart-lights", light.id, "effects"], () => api.smartLights.listEffects(light.id), {
    enabled: showAdvanced && !!light.config.token
  });
  const selectEffect = useMutation(
    (name: string) => api.smartLights.selectEffect(light.id, name),
    { onSuccess: onUpdated }
  );

  const hexColor = useMemo(() => hsvToHex(state.hue, state.sat, 100), [state.hue, state.sat]);
  const swatch = useMemo(
    () => (colorMode === "ct" && state.ct ? ctToCss(state.ct) : hsvToCss(state.hue, state.sat, state.brightness)),
    [state, colorMode]
  );

  return (
    <div className="card">
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{light.name}</h2>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            {light.config.type === "nanoleaf-http"
              ? `Nanoleaf · ${light.config.host}`
              : light.backend}
            {light.room ? ` · ${light.room}` : null}
            {" · "}
            <span style={{ color: streaming ? "var(--accent)" : "var(--muted)" }}>
              {streaming ? "⚡ Streaming UDP" : "HTTP"}
            </span>
            {" · "}
            <span className="muted">{colorMode}</span>
            {colorMode === "effect" && state.currentEffect ? ` (${state.currentEffect})` : null}
          </p>
        </div>
        <span
          className="badge"
          style={{
            background: swatch,
            color: state.brightness > 50 ? "#000" : "var(--text)",
            borderColor: "transparent",
            minWidth: 60,
            textAlign: "center"
          }}
        >
          {state.on ? `${Math.round(state.brightness)}%` : "Off"}
        </span>
      </div>

      {state.reachable === false ? (
        <p style={{ color: "var(--danger)", fontSize: 12, margin: "4px 0" }}>
          Injoignable — vérifie le réseau ou re-paire.
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button
          type="button"
          onClick={() => setState.mutate({ on: !state.on })}
          style={state.on ? buttonStylePrimary : buttonStyleSecondary}
        >
          {state.on ? "Allumée" : "Éteinte"}
        </button>
        <input
          type="color"
          value={hexColor}
          onChange={(e) => {
            const { r, g, b } = hexToRgb(e.target.value);
            setState.mutate({ rgb: { r, g, b }, on: true });
          }}
          style={{ width: 40, height: 32, padding: 0, border: "1px solid var(--border)", borderRadius: 8, background: "transparent" }}
          title="Couleur"
        />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }} className="muted">
          <input
            type="checkbox"
            checked={streaming}
            onChange={(e) => toggleStreaming.mutate(e.target.checked)}
            disabled={toggleStreaming.isLoading}
          />
          Streaming UDP
        </label>
      </div>

      <SliderRow label="Luminosité" value={Math.round(state.brightness)} min={0} max={100} unit="%"
        onChange={(v) => setState.mutate({ brightness: v, on: v > 0 })} />
      <SliderRow label="Teinte" value={Math.round(state.hue)} min={0} max={360} unit="°"
        onChange={(v) => setState.mutate({ hue: v })} />
      <SliderRow label="Saturation" value={Math.round(state.sat)} min={0} max={100} unit="%"
        onChange={(v) => setState.mutate({ sat: v })} />
      <SliderRow label="Temp. couleur" value={Math.round(state.ct ?? 2700)} min={2127} max={6535} unit=" K"
        onChange={(v) => setState.mutate({ ct: v })} />

      <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setTab(tab === "painter" ? "none" : "painter")}
          style={tab === "painter" ? buttonStylePrimary : buttonStyleSecondary}>🎨 Painter</button>
        <button type="button" onClick={() => setTab(tab === "effect" ? "none" : "effect")}
          style={tab === "effect" ? buttonStylePrimary : buttonStyleSecondary}>✨ Effets</button>
        <button type="button" onClick={() => setTab(tab === "layout3d" ? "none" : "layout3d")}
          style={tab === "layout3d" ? buttonStylePrimary : buttonStyleSecondary}>📐 Layout 3D</button>
        <button type="button" onClick={() => setShowAdvanced((v) => !v)} style={buttonStyleSecondary}>
          {showAdvanced ? "Masquer avancé" : "Avancé…"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Supprimer ${light.name} ?`)) deleteLight.mutate();
          }}
          style={{ ...buttonStyleSecondary, color: "var(--danger)" }}
        >
          Supprimer
        </button>
      </div>

      {tab === "painter" ? (
        <div style={{ marginTop: 10 }}>
          <ZonePainter light={light} onUpdated={onUpdated} />
        </div>
      ) : null}
      {tab === "effect" ? (
        <div style={{ marginTop: 10 }}>
          <EffectDesigner light={light} onUpdated={onUpdated} />
        </div>
      ) : null}
      {tab === "layout3d" ? (
        <div style={{ marginTop: 10 }}>
          <Suspense fallback={<p className="muted" style={{ fontSize: 12 }}>Chargement de l'éditeur 3D…</p>}>
            <LayoutEditor3D light={light} onUpdated={onUpdated} />
          </Suspense>
        </div>
      ) : null}

      {showAdvanced ? (
        <div style={{ marginTop: 10, padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
          <p className="muted" style={{ margin: "0 0 6px 0", fontSize: 12 }}>Effets builtin</p>
          {effectsQuery.isLoading ? (
            <p className="muted" style={{ fontSize: 12 }}>Chargement…</p>
          ) : (
            <select
              value={state.currentEffect ?? ""}
              onChange={(e) => selectEffect.mutate(e.target.value)}
              style={{ ...inputStyle, marginTop: 0 }}
              disabled={selectEffect.isLoading}
            >
              <option value="" disabled>— Choisir un effet —</option>
              {(effectsQuery.data?.effects ?? []).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
          <MirrorEditor
            mirror={light.dmxMirror ?? null}
            onSave={(mirror) => updateLight.mutate({ dmxMirror: mirror })}
          />
        </div>
      ) : null}
    </div>
  );
};

const SliderRow = ({
  label, value, min, max, unit, onChange
}: {
  label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void;
}) => (
  <label style={{ display: "block", margin: "4px 0" }}>
    <div className="flex-between" style={{ marginBottom: 2 }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 12 }}>{value}{unit}</span>
    </div>
    <input
      type="range" min={min} max={max} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: "100%" }}
    />
  </label>
);

const MirrorEditor = ({
  mirror, onSave
}: {
  mirror: SmartLightDmxMirror | null;
  onSave: (mirror: SmartLightDmxMirror | null) => void;
}) => {
  const [r, setR] = useState<string>(mirror?.rChannel?.toString() ?? "");
  const [g, setG] = useState<string>(mirror?.gChannel?.toString() ?? "");
  const [b, setB] = useState<string>(mirror?.bChannel?.toString() ?? "");
  const [bri, setBri] = useState<string>(mirror?.briChannel?.toString() ?? "");

  const parseChan = (s: string): number | undefined => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 1 && n <= 512 ? n : undefined;
  };

  return (
    <div style={{ marginTop: 10 }}>
      <p className="muted" style={{ margin: "0 0 6px 0", fontSize: 12 }}>
        Mirror DMX (lier ce strip à des canaux 1–512)
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <ChanInput label="R" value={r} onChange={setR} />
        <ChanInput label="G" value={g} onChange={setG} />
        <ChanInput label="B" value={b} onChange={setB} />
        <ChanInput label="Dimmer" value={bri} onChange={setBri} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button" style={buttonStylePrimary}
          onClick={() => {
            const next: SmartLightDmxMirror = {
              rChannel: parseChan(r), gChannel: parseChan(g),
              bChannel: parseChan(b), briChannel: parseChan(bri)
            };
            const hasAny = next.rChannel || next.gChannel || next.bChannel || next.briChannel;
            onSave(hasAny ? next : null);
          }}
        >Enregistrer</button>
        <button
          type="button" style={buttonStyleSecondary}
          onClick={() => { setR(""); setG(""); setB(""); setBri(""); onSave(null); }}
        >Désactiver</button>
      </div>
    </div>
  );
};

const ChanInput = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <label className="muted" style={{ fontSize: 12 }}>
    {label}
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="1–512" inputMode="numeric" style={inputStyle} />
  </label>
);

// ─── styles ──────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", marginTop: 4, padding: "6px 8px",
  background: "rgba(0,0,0,0.25)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 6, fontSize: 13
};
const buttonStylePrimary: React.CSSProperties = {
  padding: "6px 12px", background: "var(--accent)", color: "#001a14",
  border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13
};
const buttonStyleSecondary: React.CSSProperties = {
  padding: "6px 12px", background: "rgba(255,255,255,0.06)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 13
};

// ─── color utils ────────────────────────────────────────────────────────────

function hsvToCss(h: number, s: number, v: number): string {
  return `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${(v * 0.5).toFixed(0)}%)`;
}

/** Rough Kelvin → CSS color (warm orange ≈ 2000K, neutral white ≈ 4000K, cool blue ≈ 6500K). */
function ctToCss(ct: number): string {
  // Clamp to a visually meaningful range and map to hue.
  const t = Math.max(0, Math.min(1, (ct - 2000) / (6500 - 2000)));
  // 30° (warm orange) → 220° (cool blue) along an arc skipping greens.
  const hue = 30 + t * 190;
  return `hsl(${hue.toFixed(0)} 60% 60%)`;
}

function hsvToHex(h: number, s: number, v: number): string {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(to255(r))}${toHex(to255(g))}${toHex(to255(b))}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}
