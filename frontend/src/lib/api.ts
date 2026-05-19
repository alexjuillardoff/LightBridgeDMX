import {
  DanceConfig,
  DanceState,
  Fixture,
  NanoleafDiscovered,
  QxfLibraryFixture,
  Scene,
  SmartLight,
  SmartLightEffectConfig,
  SmartLightInput,
  SmartLightStateInput,
  SmartLightZoneLayout,
  SmartLightZonePalette
} from "@lightbridgedmx/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export type HomeKitFixtureStatus = {
  fixtureId: string;
  name: string;
  source: "config" | "capability";
  mapping: { r: number; g: number; b: number; universe: number; address: number };
};

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
  message?: string;
};

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init && "body" in init && init.body !== undefined && init.body !== null;
  const headers = hasBody ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers;

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const api = {
  fixtures: {
    list: () => fetchJSON<Fixture[]>("/api/fixtures"),
    create: (body: unknown) => fetchJSON<Fixture>("/api/fixtures", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: unknown) =>
      fetchJSON<Fixture>(`/api/fixtures/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    delete: (id: string) => fetchJSON<void>(`/api/fixtures/${id}`, { method: "DELETE" }),
    importQxfLibrary: (body: unknown) =>
      fetchJSON<Fixture>("/api/fixtures/import/qxf-library", { method: "POST", body: JSON.stringify(body) })
  },
  scenes: {
    list: () => fetchJSON<Scene[]>("/api/scenes")
  },
  universe: {
    setChannel: (channel: number, value: number) =>
      fetchJSON<{ ok: true }>(`/api/universe/${channel}`, {
        method: "POST",
        body: JSON.stringify({ value })
      })
  },
  qxf: {
    library: () => fetchJSON<QxfLibraryFixture[]>("/api/qxf/library"),
    refresh: () => fetchJSON<QxfLibraryFixture[]>("/api/qxf/library/refresh", { method: "POST" })
  },
  homekit: {
    status: () => fetchJSON<HomeKitStatus>("/api/homekit")
  },
  rooms: {
    list: () => fetchJSON<string[]>("/api/rooms")
  },
  dance: {
    state: () => fetchJSON<DanceState>("/api/dance/state"),
    updateConfig: (patch: Partial<DanceConfig>) =>
      fetchJSON<DanceState>("/api/dance/config", { method: "PUT", body: JSON.stringify(patch) }),
    start: () => fetchJSON<DanceState>("/api/dance/start", { method: "POST" }),
    stop: () => fetchJSON<DanceState>("/api/dance/stop", { method: "POST" })
  },
  smartLights: {
    list: () => fetchJSON<SmartLight[]>("/api/smart-lights"),
    create: (body: SmartLightInput) =>
      fetchJSON<SmartLight>("/api/smart-lights", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<SmartLightInput>) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    delete: (id: string) => fetchJSON<void>(`/api/smart-lights/${id}`, { method: "DELETE" }),
    setState: (id: string, body: SmartLightStateInput) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/state`, { method: "POST", body: JSON.stringify(body) }),
    pair: (body: { host: string; port?: number; name?: string; room?: string }) =>
      fetchJSON<SmartLight>("/api/smart-lights/pair", { method: "POST", body: JSON.stringify(body) }),
    repair: (id: string) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/pair`, { method: "POST" }),
    probe: (body: { host: string; port?: number }) =>
      fetchJSON<{ reachable: boolean; inPairingMode: boolean; status?: number }>(
        "/api/smart-lights/probe",
        { method: "POST", body: JSON.stringify(body) }
      ),
    discover: (body?: { timeoutMs?: number }) =>
      fetchJSON<{ devices: NanoleafDiscovered[] }>("/api/smart-lights/discover", {
        method: "POST",
        body: JSON.stringify(body ?? {})
      }),
    listEffects: (id: string) =>
      fetchJSON<{ effects: string[] }>(`/api/smart-lights/${id}/effects`),
    selectEffect: (id: string, name: string) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/effects/select`, {
        method: "POST",
        body: JSON.stringify({ name })
      }),
    setStreaming: (id: string, enabled: boolean, zoneCount?: number) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/streaming`, {
        method: "POST",
        body: JSON.stringify({ enabled, zoneCount })
      }),
    setZones: (id: string, palette: SmartLightZonePalette) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/zones`, {
        method: "POST",
        body: JSON.stringify(palette)
      }),
    setLayout: (id: string, layout: SmartLightZoneLayout | null) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/layout`, {
        method: "POST",
        body: JSON.stringify(layout)
      }),
    setEffect: (id: string, effect: SmartLightEffectConfig | null) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/effect`, {
        method: "POST",
        body: JSON.stringify(effect)
      })
  }
};

export const wsUrl = () => {
  const override = import.meta.env.VITE_WS_URL as string | undefined;
  if (override) return override;
  // Prefer explicit API base when set (convert http -> ws).
  if (API_BASE.startsWith("http")) {
    const url = new URL(API_BASE);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    return url.toString();
  }
  // Dev default: hit backend directly to avoid proxy WS quirks (use host of the page, not localhost).
  if (import.meta.env.DEV) {
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    return `ws://${host}:5000/ws`;
  }
  const { protocol, host } = window.location;
  const wsProtocol = protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${host}/ws`;
};
