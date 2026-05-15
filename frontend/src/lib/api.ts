import { DanceConfig, DanceState, Fixture, QxfLibraryFixture, Scene } from "@lightbridgedmx/shared";

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
