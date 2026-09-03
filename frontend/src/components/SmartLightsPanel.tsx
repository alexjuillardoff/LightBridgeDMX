// Panneau UI des lampes connectees (smart lights).
// Affiche la liste des lampes WiFi (Nanoleaf...), une carte d'appairage (pairing),
// et pour chaque lampe : on/off, couleur, curseurs, streaming UDP, painter,
// effets, layout 3D et mirror DMX. Toutes les actions passent par l'API REST
// (`api.smartLights.*`) et le cache react-query est mis a jour localement.
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
import { lightMatchesBackend, SmartLightBackendId } from "./smart-lights/backendRegistry";

// Chargement differe (lazy) de l'editeur 3D : three.js + drei pesent ~600 Ko.
// On ne paie ce poids que si l'utilisateur ouvre vraiment l'onglet Layout 3D.
const LayoutEditor3D = lazy(() =>
  import("./smart-lights/LayoutEditor3D").then((m) => ({ default: m.LayoutEditor3D }))
);

// Resultat d'un test (probe) de lampe : joignable ? en mode appairage ?
type Probe = { reachable: boolean; inPairingMode: boolean; status?: number } | null;

type SmartLightsPanelProps = {
  // Filtre par marque/type de lampe ("all" = toutes).
  backendFilter?: SmartLightBackendId | "all";
  // Masque le titre de section (utile quand le panneau est integre dans un onglet deja titre).
  hideSectionTitle?: boolean;
};

// Composant racine du panneau : liste les lampes filtrees + carte d'appairage.
export const SmartLightsPanel = ({
  backendFilter = "all",
  hideSectionTitle = false
}: SmartLightsPanelProps = {}) => {
  const queryClient = useQueryClient();
  const lightsQuery = useQuery<SmartLight[]>(["smart-lights"], api.smartLights.list);

  // Met a jour le cache react-query sans refetch : remplace la lampe si elle
  // existe deja, sinon l'ajoute (upsert). Evite un aller-retour reseau a chaque action.
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
  // Retire une lampe du cache local apres suppression cote serveur.
  const removeLight = (id: string) => {
    queryClient.setQueryData<SmartLight[]>(["smart-lights"], (prev = []) =>
      prev.filter((l) => l.id !== id)
    );
  };

  // Ne garde que les lampes qui correspondent au filtre de backend demande.
  const lights = (lightsQuery.data ?? []).filter((l) => lightMatchesBackend(l, backendFilter));

  return (
    <>
      {hideSectionTitle ? null : (
        <div className="section-title">
          <h2>Smart Lights</h2>
          <span className="muted">Nanoleaf et autres lampes WiFi pilotées par LightBridge</span>
        </div>
      )}
      <div className="grid">
        <PairCard onPaired={upsertLight} />
        {lights.map((light) => (
          <SmartLightCard
            key={light.id}
            light={light}
            onUpdated={upsertLight}
            onDeleted={removeLight}
          />
        ))}
        {lights.length === 0 && lightsQuery.isFetched ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Aucune lampe pour ce backend. Utilise <em>Pairer un Nanoleaf</em> pour en ajouter.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
};

// ─── Appairage (pairing) + decouverte (discovery) ───────────────────────────

// Carte permettant d'ajouter un Nanoleaf : saisie/scan de l'IP, test de
// joignabilite, puis appairage. Le strip doit etre en mode pairing (LED qui pulse).
const PairCard = ({ onPaired }: { onPaired: (light: SmartLight) => void }) => {
  const [host, setHost] = useState("");
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [probe, setProbe] = useState<Probe>(null);
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<NanoleafDiscovered[]>([]);

  // Test (probe) : verifie que l'API du Nanoleaf repond a l'IP donnee.
  const probeMutation = useMutation(api.smartLights.probe, {
    onSuccess: (data) => {
      setProbe(data);
      setError(null);
    },
    onError: (err) => setError((err as Error).message)
  });
  // Appairage : recupere un token et enregistre la lampe (le strip doit etre en pairing).
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
  // Decouverte (discovery mDNS) : scanne le reseau ~4 s pour trouver les Nanoleaf.
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
        {/* Liste des lampes detectees par le scan : un clic pre-remplit l'IP et le nom. */}
        {discovered.length > 0 ? (
          <div style={{ fontSize: 13 }}>
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
          <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
            {probe.reachable
              ? probe.inPairingMode
                ? "API joignable, mode pairing détecté."
                : "API joignable. Mets le strip en pairing puis Pairer."
              : "API injoignable. Vérifie l'IP et l'option 'API' dans l'app Nanoleaf."}
          </p>
        ) : null}
        {error ? <p style={{ color: "var(--danger)", fontSize: 14, margin: 0 }}>{error}</p> : null}
      </div>
    </div>
  );
};

// ─── Carte d'une lampe ──────────────────────────────────────────────────────

// Carte de controle d'une lampe : etat, couleur, curseurs HSB + temperature,
// bascule streaming UDP, onglets (painter / effets / layout 3D) et reglages avances.
const SmartLightCard = ({
  light,
  onUpdated,
  onDeleted
}: {
  light: SmartLight;
  onUpdated: (light: SmartLight) => void;
  onDeleted: (id: string) => void;
}) => {
  // Etat affiche : celui de la lampe, ou des valeurs neutres par defaut si inconnu.
  const state = light.state ?? { on: false, hue: 0, sat: 0, brightness: 0, reachable: true };
  const streaming = light.streaming?.enabled ?? false;
  // En streaming UDP, le colorMode renvoye par l'appareil ("effect" → "*ExtControl*")
  // n'apprend rien. On affiche plutot ce que LightBridge envoie reellement : le type
  // d'effet streame. Sinon on retombe sur ce que l'appareil declare (hs/ct/effect).
  const colorMode: string = streaming
    ? light.currentEffect
      ? `stream · ${light.currentEffect.kind}`
      : "stream · uniform"
    : state.colorMode ?? "hs";
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Onglet ouvert sous la carte ("none" = aucun).
  const [tab, setTab] = useState<"none" | "painter" | "effect" | "layout3d">("none");

  // --- Mutations : chaque action met a jour le cache via onUpdated/onDeleted ---
  // Applique un nouvel etat (on, couleur, luminosite...) a la lampe.
  const setState = useMutation(
    (body: SmartLightStateInput) => api.smartLights.setState(light.id, body),
    { onSuccess: onUpdated }
  );
  const deleteLight = useMutation(() => api.smartLights.delete(light.id), {
    onSuccess: () => onDeleted(light.id)
  });
  // Met a jour la config de la lampe (ex. le mirror DMX).
  const updateLight = useMutation(
    (body: Parameters<typeof api.smartLights.update>[1]) => api.smartLights.update(light.id, body),
    { onSuccess: onUpdated }
  );
  // Active/desactive le streaming UDP (flux basse latence vers la lampe).
  const toggleStreaming = useMutation(
    (next: boolean) => api.smartLights.setStreaming(light.id, next),
    { onSuccess: onUpdated }
  );
  // Liste des effets builtin de la lampe. Charge seulement si le panneau avance
  // est ouvert ET que la lampe possede un token (sinon l'API n'est pas accessible).
  // Les effets sont propres a l'API Nanoleaf : une ampoule HomeKit-sur-Thread n'en
  // expose aucun, elle ne connait que teinte / saturation / luminosite.
  const effectsQuery = useQuery(["smart-lights", light.id, "effects"], () => api.smartLights.listEffects(light.id), {
    enabled: showAdvanced && light.config.type === "nanoleaf-http" && !!light.config.token
  });
  const selectEffect = useMutation(
    (name: string) => api.smartLights.selectEffect(light.id, name),
    { onSuccess: onUpdated }
  );

  // Couleur du selecteur natif <input type=color> : on force V=100 % pour
  // afficher la teinte pure (la luminosite a son propre curseur).
  const hexColor = useMemo(() => hsvToHex(state.hue, state.sat, 100), [state.hue, state.sat]);
  // Pastille de couleur (badge) : temperature de couleur si mode ct, sinon HSB.
  const swatch = useMemo(
    () => (colorMode === "ct" && state.ct ? ctToCss(state.ct) : hsvToCss(state.hue, state.sat, state.brightness)),
    [state, colorMode]
  );

  return (
    <div className="card">
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{light.name}</h2>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {light.config.type === "nanoleaf-http"
              ? `Nanoleaf · ${light.config.host}`
              : light.backend}
            {light.room ? ` · ${light.room}` : null}
            {" · "}
            <span style={{ color: streaming ? "var(--accent)" : "var(--muted)" }}>
              {streaming ? `⚡ ${colorMode}` : `HTTP · ${colorMode}`}
            </span>
            {!streaming && colorMode === "effect" && state.currentEffect ? ` (${state.currentEffect})` : null}
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

      {/* Alerte si la lampe n'est pas joignable (reachable) sur le reseau. */}
      {state.reachable === false ? (
        <p style={{ color: "var(--danger)", fontSize: 13, margin: "4px 0" }}>
          Injoignable — vérifie le réseau ou re-paire.
        </p>
      ) : null}

      {/* Ligne d'actions rapides : on/off, selecteur de couleur, bascule streaming UDP. */}
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
            // Choisir une couleur rallume forcement la lampe (on: true).
            const { r, g, b } = hexToRgb(e.target.value);
            setState.mutate({ rgb: { r, g, b }, on: true });
          }}
          style={{ width: 40, height: 32, padding: 0, border: "1px solid var(--border)", borderRadius: 0, background: "transparent" }}
          title="Couleur"
        />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }} className="muted">
          <input
            type="checkbox"
            checked={streaming}
            onChange={(e) => toggleStreaming.mutate(e.target.checked)}
            disabled={toggleStreaming.isLoading}
          />
          Streaming UDP
        </label>
      </div>

      {/* Curseurs HSB + temperature de couleur. Pour la luminosite, 0 % eteint la lampe. */}
      <SliderRow label="Luminosité" value={Math.round(state.brightness)} min={0} max={100} unit="%"
        onChange={(v) => setState.mutate({ brightness: v, on: v > 0 })} />
      <SliderRow label="Teinte" value={Math.round(state.hue)} min={0} max={360} unit="°"
        onChange={(v) => setState.mutate({ hue: v })} />
      <SliderRow label="Saturation" value={Math.round(state.sat)} min={0} max={100} unit="%"
        onChange={(v) => setState.mutate({ sat: v })} />
      <SliderRow label="Temp. couleur" value={Math.round(state.ct ?? 2700)} min={2127} max={6535} unit=" K"
        onChange={(v) => setState.mutate({ ct: v })} />

      {/* Barre d'onglets : chaque bouton bascule (toggle) son panneau, sauf Avance et Supprimer. */}
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
      {/* Editeur 3D charge en differe (Suspense) : voir le lazy() en haut du fichier. */}
      {tab === "layout3d" ? (
        <div style={{ marginTop: 10 }}>
          <Suspense fallback={<p className="muted" style={{ fontSize: 13 }}>Chargement de l'éditeur 3D…</p>}>
            <LayoutEditor3D light={light} onUpdated={onUpdated} />
          </Suspense>
        </div>
      ) : null}

      {/* Panneau avance : choix d'un effet builtin de la lampe + edition du mirror DMX. */}
      {showAdvanced ? (
        <div style={{ marginTop: 10, padding: 10, background: "#0a0a0a", borderRadius: 0 }}>
          <p className="muted" style={{ margin: "0 0 6px 0", fontSize: 13 }}>Effets builtin</p>
          {effectsQuery.isLoading ? (
            <p className="muted" style={{ fontSize: 13 }}>Chargement…</p>
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
          <DmxFixtureEditor light={light} onUpdated={onUpdated} />
          <MirrorEditor
            mirror={light.dmxMirror ?? null}
            onSave={(mirror) =>
              updateLight.mutate({
                // On preserve le miroir par zone : il est gere par DmxFixtureEditor,
                // pas par cet editeur de canaux uniformes.
                dmxMirror: mirror
                  ? { ...mirror, ...(light.dmxMirror?.zones ? { zones: light.dmxMirror.zones } : {}) }
                  : light.dmxMirror?.zones
                    ? { zones: light.dmxMirror.zones }
                    : null
              })
            }
          />
        </div>
      ) : null}
    </div>
  );
};

// Ligne de curseur (slider) reutilisable : libelle + valeur + unite au-dessus
// d'un <input type=range>. Remonte la nouvelle valeur (nombre) via onChange.
const SliderRow = ({
  label, value, min, max, unit, onChange
}: {
  label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void;
}) => (
  <label style={{ display: "block", margin: "4px 0" }}>
    <div className="flex-between" style={{ marginBottom: 2 }}>
      <span className="muted" style={{ fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}{unit}</span>
    </div>
    <input
      type="range" min={min} max={max} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: "100%" }}
    />
  </label>
);

/**
 * Expose le bandeau comme un projecteur DMX multi-cellules : 3 canaux (rouge,
 * vert, bleu) pour CHAQUE zone, dans un bloc de canaux consecutifs.
 *
 * Le backend cree le projecteur correspondant et branche le miroir DMX par zone ;
 * a partir de la, la fixture sheet, les scenes et l'Art-Net entrant peignent le
 * bandeau zone par zone. Le pilotage local (painter, effets) reprend la main des
 * qu'on l'utilise, et le DMX la reprend au prochain mouvement de ses canaux.
 */
const DmxFixtureEditor = ({
  light, onUpdated
}: {
  light: SmartLight;
  onUpdated: (light: SmartLight) => void;
}) => {
  const queryClient = useQueryClient();
  const zones = light.dmxMirror?.zones ?? null;
  const streamingZones = light.streaming?.zoneCount ?? 50;
  const [zoneCount, setZoneCount] = useState<string>(String(zones?.zoneCount ?? streamingZones));
  const [start, setStart] = useState<string>(zones?.startChannel?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  // Le projecteur genere vit dans le cache ["fixtures"] : on l'invalide pour que
  // la fixture sheet et la vue Appareils voient tout de suite le changement.
  const refreshFixtures = () => queryClient.invalidateQueries(["fixtures"]);

  const expose = useMutation(
    () => {
      const n = parseInt(zoneCount, 10);
      const st = parseInt(start, 10);
      return api.smartLights.createDmxFixture(light.id, {
        ...(Number.isFinite(n) && n >= 1 ? { zoneCount: n } : {}),
        ...(Number.isFinite(st) && st >= 1 && st <= 512 ? { startChannel: st } : {})
      });
    },
    {
      onSuccess: (res) => {
        setError(null);
        setStart(String(res.fixture.address));
        onUpdated(res.light);
        void refreshFixtures();
      },
      onError: (err) => setError((err as Error).message)
    }
  );

  const remove = useMutation(() => api.smartLights.deleteDmxFixture(light.id), {
    onSuccess: (updated) => {
      setError(null);
      setStart("");
      onUpdated(updated);
      void refreshFixtures();
    },
    onError: (err) => setError((err as Error).message)
  });

  const busy = expose.isLoading || remove.isLoading;
  const span = zones ? `${zones.startChannel}–${zones.startChannel + zones.zoneCount * 3 - 1}` : null;

  return (
    <div style={{ marginTop: 10 }}>
      <p className="muted" style={{ margin: "0 0 6px 0", fontSize: 13 }}>
        Projecteur DMX par zone (3 canaux R/G/B par zone)
      </p>
      {zones ? (
        <p style={{ margin: "0 0 6px 0", fontSize: 13 }}>
          Exposé sur les canaux <strong>{span}</strong> · {zones.zoneCount} zones
        </p>
      ) : (
        <p className="muted" style={{ margin: "0 0 6px 0", fontSize: 13 }}>
          Pas encore exposé. Laisse l'adresse vide pour allouer le premier bloc libre.
        </p>
      )}
      {!light.streaming?.enabled ? (
        <p style={{ margin: "0 0 6px 0", fontSize: 13, color: "var(--amber-text)" }}>
          ⚠ Le streaming UDP doit être actif pour que le DMX pilote les zones.
        </p>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <ChanInput label="Zones" value={zoneCount} onChange={setZoneCount} />
        <ChanInput label="Adresse (vide = auto)" value={start} onChange={setStart} />
      </div>
      {error ? <p style={{ margin: "6px 0 0 0", fontSize: 13, color: "var(--danger, #ff6b6b)" }}>{error}</p> : null}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" style={buttonStylePrimary} disabled={busy} onClick={() => expose.mutate()}>
          {zones ? "Mettre à jour" : "Exposer en DMX"}
        </button>
        {zones ? (
          <button type="button" style={buttonStyleSecondary} disabled={busy} onClick={() => remove.mutate()}>
            Retirer
          </button>
        ) : null}
      </div>
    </div>
  );
};

// Editeur du mirror DMX : lie les composantes R/G/B/Dimmer de la lampe a des
// canaux DMX (1-512). Etablit la liaison bidirectionnelle entre la smart light
// et les canaux. Les champs sont des chaines pour permettre la saisie/le vide.
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

  // Convertit la saisie en numero de canal valide (entier 1-512), sinon undefined.
  const parseChan = (s: string): number | undefined => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 1 && n <= 512 ? n : undefined;
  };

  return (
    <div style={{ marginTop: 10 }}>
      <p className="muted" style={{ margin: "0 0 6px 0", fontSize: 13 }}>
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
            // Si aucun canal n'est renseigne, on enregistre null (mirror desactive).
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

// Petit champ de saisie d'un numero de canal DMX (libelle + input numerique).
const ChanInput = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <label className="muted" style={{ fontSize: 13 }}>
    {label}
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="1–512" inputMode="numeric" style={inputStyle} />
  </label>
);

// ─── styles inline partages par les composants de ce fichier ─────────────────

const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", marginTop: 4, padding: "6px 8px",
  background: "#000", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 0, fontSize: 14
};
const buttonStylePrimary: React.CSSProperties = {
  padding: "6px 12px", background: "linear-gradient(180deg,#1a1a1a,#050505)", color: "var(--amber-text)",
  border: "1px solid var(--edge)", borderRadius: 0, cursor: "pointer", fontWeight: 700, fontSize: 13
};
const buttonStyleSecondary: React.CSSProperties = {
  padding: "6px 12px", background: "linear-gradient(180deg,#1a1a1a,#050505)", color: "var(--text)",
  border: "1px solid var(--edge-grey)", borderRadius: 0, cursor: "pointer", fontWeight: 700, fontSize: 13
};

// ─── utilitaires couleur ─────────────────────────────────────────────────────

// HSB/HSV → couleur CSS pour la pastille. On divise V par 2 (luminosite max 50 %)
// pour que la pastille reste lisible sur le fond sombre de l'UI.
function hsvToCss(h: number, s: number, v: number): string {
  return `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${(v * 0.5).toFixed(0)}%)`;
}

/** Temperature de couleur (Kelvin) → couleur CSS approximative (orange chaud ≈ 2000K, blanc neutre ≈ 4000K, bleu froid ≈ 6500K). */
function ctToCss(ct: number): string {
  // Borne (clamp) la temperature sur 2000-6500K, plage visuellement parlante.
  const t = Math.max(0, Math.min(1, (ct - 2000) / (6500 - 2000)));
  // Teinte de 30° (orange chaud) a 220° (bleu froid), sur un arc qui evite les verts.
  const hue = 30 + t * 190;
  return `hsl(${hue.toFixed(0)} 60% 60%)`;
}

// HSB/HSV → couleur hex (#RRGGBB) pour le selecteur natif <input type=color>.
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

// Couleur hex (#RRGGBB) → composantes RGB 0-255 (sortie du selecteur de couleur).
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}
