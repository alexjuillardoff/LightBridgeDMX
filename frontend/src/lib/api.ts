// Client API du frontend : point d'entrée unique pour parler au backend Fastify.
// Regroupe tous les appels REST (projecteurs, scènes, presets, univers DMX, effets,
// QXF, HomeKit, lampes connectées, appareils, Meross, système) derrière l'objet
// `api`, plus le helper wsUrl() qui calcule l'URL du WebSocket temps réel.
// Les types viennent du package partagé @lightbridgedmx/shared pour rester
// cohérents avec le backend. Aucun composant n'appelle fetch directement.
import type {
  DeviceInventory,
  DmxEffect,
  Fixture,
  MerossConfigInput,
  MerossConsumption,
  MerossStatus,
  NanoleafDiscovered,
  Preset,
  QxfLibraryFixture,
  RunningEffect,
  Scene,
  SmartLight,
  SmartLightInput,
  SmartLightStateInput,
  SmartLightZoneLayout,
  SmartLightZonePalette
} from "@lightbridgedmx/shared";

// Préfixe des URLs API. Vide par défaut : on passe alors par le proxy Vite (/api → :5000)
// ou par le reverse proxy en façade. VITE_API_BASE permet de viser un backend distant.
const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

// État d'un projecteur tel qu'exposé dans le pont HomeKit.
// kind = famille d'accessoire : "channels" (un Lightbulb par canal DMX) ou
// "movingHead" (lyre exposée en accessoire multi-services).
export type HomeKitFixtureStatus = {
  fixtureId: string;
  name: string;
  universe: number;
  kind: "channels" | "movingHead";
  channels: Record<string, number>;
};

// État global du pont HomeKit renvoyé par GET /api/homekit (fenêtre Setup).
export type HomeKitStatus = {
  enabled: boolean;
  started: boolean;
  name: string;
  pin: string;
  username: string;
  port?: number;
  setupId?: string;
  setupUri: string | null;
  storagePath: string;
  fixtures: HomeKitFixtureStatus[];
  /** Lampes connectées exposées. `fixtureId` est présent quand la lampe est exposée
   *  via sa façade DMX : c'est ce projecteur-là qui porte le badge HomeKit. */
  smartLights?: { id: string; name: string; backend: string; fixtureId?: string }[];
  message?: string;
};

/** Erreur HTTP : le statut permet aux fenêtres de distinguer un 409 (conflit de patch)
 *  d'une panne réseau. `message` est le texte renvoyé par le backend quand il y en a un. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Extrait un message lisible d'un corps d'erreur : { error } ou { message } JSON, sinon le texte brut.
const errorMessage = (text: string, fallback: string): string => {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    /* pas du JSON : on garde le texte */
  }
  return text;
};

/**
 * Helper central pour tous les appels HTTP au backend.
 * - Ajoute l'en-tête Content-Type JSON uniquement quand il y a un corps.
 * - Lève une ApiError (statut + message) si la réponse n'est pas 2xx.
 * - Gère le 204 (No Content) en renvoyant undefined, sinon parse le JSON.
 */
export async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init !== undefined && init.body !== undefined && init.body !== null;
  const headers = hasBody ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, errorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown): string => JSON.stringify(body);

// Objet `api` : surface complète des appels backend, regroupés par domaine.
export const api = {
  // Projecteurs (fixtures) : CRUD, repatch groupé, import depuis la bibliothèque QXF.
  fixtures: {
    list: () => fetchJSON<Fixture[]>("/api/fixtures"),
    create: (body: unknown) => fetchJSON<Fixture>("/api/fixtures", { method: "POST", body: json(body) }),
    update: (id: string, body: unknown) =>
      fetchJSON<Fixture>(`/api/fixtures/${id}`, { method: "PUT", body: json(body) }),
    delete: (id: string) => fetchJSON<void>(`/api/fixtures/${id}`, { method: "DELETE" }),
    // Le backend valide la disposition FINALE puis écrit en transaction : un PUT par
    // projecteur échouerait en 409 dès que deux projecteurs se croisent.
    repatch: (moves: { id: string; address: number; universe?: number }[]) =>
      fetchJSON<Fixture[]>("/api/fixtures/repatch", { method: "POST", body: json({ moves }) }),
    importQxfLibrary: (body: { path: string; mode?: string; address: number; universe: number; name?: string; room?: string }) =>
      fetchJSON<Fixture>("/api/fixtures/import/qxf-library", { method: "POST", body: json(body) })
  },
  // Scènes = les executors du pupitre : STORE crée une scène, GO la rejoue (côté frontend,
  // via le writer — `activate` existe mais la nouvelle interface ne s'en sert pas).
  scenes: {
    list: () => fetchJSON<Scene[]>("/api/scenes"),
    create: (body: { name: string; steps: { fixtureId: string; values: number[] }[] }) =>
      fetchJSON<Scene>("/api/scenes", { method: "POST", body: json(body) }),
    activate: (id: string) => fetchJSON<{ ok: true }>(`/api/scenes/${id}/activate`, { method: "POST" }),
    delete: (id: string) => fetchJSON<void>(`/api/scenes/${id}`, { method: "DELETE" })
  },
  // Presets : jeux de valeurs de canaux réutilisables. Pas de DELETE ni de PUT côté backend.
  presets: {
    list: () => fetchJSON<Preset[]>("/api/presets"),
    create: (body: { name: string; payload: Record<string, number> }) =>
      fetchJSON<Preset>("/api/presets", { method: "POST", body: json(body) }),
    apply: (id: string) => fetchJSON<{ ok: true }>(`/api/presets/${id}/apply`, { method: "POST" })
  },
  // Univers DMX. `setMany` est l'écriture GROUPÉE utilisée par state/dmx-writer.ts :
  // une seule requête pour tous les canaux qui ont bougé (max 512 entrées).
  universe: {
    setChannel: (channel: number, value: number) =>
      fetchJSON<{ ok: true }>(`/api/universe/${channel}`, { method: "POST", body: json({ value }) }),
    setMany: (values: Record<number, number>) =>
      fetchJSON<{ ok: true; count: number }>("/api/universe", { method: "POST", body: json({ values }) })
  },
  // Moteur d'effets DMX (les « phasers »). Un effet se joue sur une SÉLECTION et vit
  // dans le backend le temps qu'il tourne — rien n'est persisté.
  effects: {
    list: () => fetchJSON<{ running: RunningEffect[] }>("/api/effects"),
    run: (effect: DmxEffect, fixtureIds: string[]) =>
      fetchJSON<RunningEffect>("/api/effects/run", { method: "POST", body: json({ effect, fixtureIds }) }),
    /** Retouche un effet EN COURS : la phase ne repart pas de zéro. */
    update: (id: string, effect: DmxEffect) =>
      fetchJSON<RunningEffect>(`/api/effects/${id}`, { method: "PUT", body: json({ effect }) }),
    stop: (id: string) => fetchJSON<{ stopped: string }>(`/api/effects/${id}`, { method: "DELETE" }),
    stopAll: () => fetchJSON<{ running: RunningEffect[] }>("/api/effects/stop-all", { method: "POST" })
  },
  // Lampes connectées (Nanoleaf HTTP/UDP, ampoules Thread via sidecar).
  smartLights: {
    list: () => fetchJSON<SmartLight[]>("/api/smart-lights"),
    get: (id: string) => fetchJSON<SmartLight>(`/api/smart-lights/${id}`),
    create: (body: SmartLightInput) => fetchJSON<SmartLight>("/api/smart-lights", { method: "POST", body: json(body) }),
    update: (id: string, body: Partial<SmartLightInput>) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}`, { method: "PUT", body: json(body) }),
    delete: (id: string) => fetchJSON<void>(`/api/smart-lights/${id}`, { method: "DELETE" }),
    setState: (id: string, body: SmartLightStateInput) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/state`, { method: "POST", body: json(body) }),
    pair: (body: { host: string; port?: number; name?: string; room?: string }) =>
      fetchJSON<SmartLight>("/api/smart-lights/pair", { method: "POST", body: json(body) }),
    repair: (id: string) => fetchJSON<SmartLight>(`/api/smart-lights/${id}/pair`, { method: "POST" }),
    probe: (body: { host: string; port?: number }) =>
      fetchJSON<{ reachable: boolean; inPairingMode: boolean; status?: number }>("/api/smart-lights/probe", {
        method: "POST",
        body: json(body)
      }),
    discover: (body?: { timeoutMs?: number }) =>
      fetchJSON<{ devices: NanoleafDiscovered[] }>("/api/smart-lights/discover", { method: "POST", body: json(body ?? {}) }),
    setStreaming: (id: string, enabled: boolean, zoneCount?: number) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/streaming`, { method: "POST", body: json({ enabled, zoneCount }) }),
    setZones: (id: string, palette: SmartLightZonePalette) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/zones`, { method: "POST", body: json(palette) }),
    setLayout: (id: string, layout: SmartLightZoneLayout | null) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/layout`, { method: "POST", body: json(layout) }),
    // Expose le bandeau comme un projecteur DMX (3 canaux R/G/B par zone + dimmer master en queue).
    createDmxFixture: (
      id: string,
      body?: { zoneCount?: number; startChannel?: number; universe?: number; name?: string; room?: string }
    ) =>
      fetchJSON<{ light: SmartLight; fixture: Fixture }>(`/api/smart-lights/${id}/dmx-fixture`, {
        method: "POST",
        body: json(body ?? {})
      }),
    deleteDmxFixture: (id: string) => fetchJSON<SmartLight>(`/api/smart-lights/${id}/dmx-fixture`, { method: "DELETE" })
  },
  // Patch automatisé des ampoules HomeKit-sur-Thread.
  threadLights: {
    candidates: () =>
      fetchJSON<{ sidecarUp: boolean; candidates: { alias: string; name: string; reachable: boolean }[]; message?: string }>(
        "/api/smart-lights/thread/candidates"
      ),
    adopt: (body: { alias: string; name?: string; room?: string; patchDmx?: boolean; fixtureId?: string; universe?: number }) =>
      fetchJSON<{ light: SmartLight; fixture: Fixture | null; address: number | null }>("/api/smart-lights/thread/adopt", {
        method: "POST",
        body: json(body)
      }),
    pair: (body: { name: string; pin: string; alias?: string; timeoutSec?: number }) =>
      fetchJSON<{ started: boolean; alias: string; message: string }>("/api/smart-lights/thread/pair", {
        method: "POST",
        body: json(body)
      })
  },
  // Inventaire unifié des appareils. `list` sert le cache ; `scan` relance un scan mDNS (quelques secondes).
  devices: {
    list: () => fetchJSON<DeviceInventory>("/api/devices"),
    scan: (body?: { timeoutMs?: number }) =>
      fetchJSON<DeviceInventory>("/api/devices/scan", { method: "POST", body: json(body ?? {}) })
  },
  // Bibliothèque QXF (profils QLC+) : lecture du cache local, rafraîchissement (~50 Mo depuis GitHub).
  qxf: {
    library: () => fetchJSON<QxfLibraryFixture[]>("/api/qxf/library"),
    refresh: () => fetchJSON<QxfLibraryFixture[]>("/api/qxf/library/refresh", { method: "POST" })
  },
  // Pont HomeKit (lecture seule).
  homekit: {
    status: () => fetchJSON<HomeKitStatus>("/api/homekit")
  },
  // Prise connectée Meross : statut, config, test de connexion, consommation.
  meross: {
    status: () => fetchJSON<MerossStatus>("/api/meross"),
    update: (patch: MerossConfigInput) => fetchJSON<MerossStatus>("/api/meross", { method: "PUT", body: json(patch) }),
    test: () =>
      fetchJSON<{ reachable: boolean; on: boolean | null; error: string | null }>("/api/meross/test", { method: "POST" }),
    consumption: () => fetchJSON<MerossConsumption | null>("/api/meross/consumption")
  },
  // Pièces connues (union des projecteurs et lampes ayant une `room`).
  rooms: {
    list: () => fetchJSON<string[]>("/api/rooms")
  },
  // Système : healthcheck (icône globe de la ligne de commande) et redémarrage complet.
  system: {
    health: () => fetchJSON<{ status: string }>("/api/health"),
    restart: () => fetchJSON<{ status: string; services: string[] }>("/api/system/restart", { method: "POST" })
  }
};

/**
 * URL du WebSocket /ws (ticks DMX, mises à jour des projecteurs et des lampes…).
 * Ordre de priorité :
 *   1. VITE_WS_URL force tout ;
 *   2. VITE_API_BASE si défini : même base, http → ws / https → wss ;
 *   3. défaut : même origine que la page (host AVEC le port), `wss:` si la page est en
 *      HTTPS. On emprunte le proxy /ws exactement comme les appels /api — Vite en dev,
 *      Caddy derrière https://light.alexjuillard.fr. Jamais `ws://<host>:5000` en dur :
 *      Mixed Content derrière HTTPS, et le port 5000 n'est pas exposé par le proxy.
 * Hors navigateur (tests Node) on renvoie une valeur neutre.
 */
export const wsUrl = (): string => {
  const override = import.meta.env.VITE_WS_URL as string | undefined;
  if (override) return override;
  if (API_BASE.startsWith("http")) {
    const url = new URL(API_BASE);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    return url.toString();
  }
  if (typeof location === "undefined") return "ws://localhost:5000/ws";
  const { protocol, host } = location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/ws`;
};
