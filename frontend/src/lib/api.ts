// Client API du frontend : point d'entree unique pour parler au backend Fastify.
// Regroupe tous les appels REST (projecteurs, scenes, univers DMX, QXF, HomeKit,
// Mode Dance, lampes connectees) derriere l'objet `api`, plus le helper wsUrl()
// qui calcule l'URL du WebSocket temps reel. Les types sont importes du package
// partage @lightbridgedmx/shared pour rester coherents avec le backend.

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

// Prefixe des URLs API. Vide par defaut : on passe alors par le proxy Vite (/api → :5000).
// VITE_API_BASE permet de viser un backend distant (ex. en production).
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// Etat d'un projecteur (fixture) tel qu'expose dans le pont HomeKit.
// source = origine du mapping RGB : "config" (canaux explicites) ou "capability"
// (deduit des capabilities r/g/b). mapping = canaux et adresse DMX resolus.
export type HomeKitFixtureStatus = {
  fixtureId: string;
  name: string;
  source: "config" | "capability";
  mapping: { r: number; g: number; b: number; universe: number; address: number };
};

// Etat global du pont HomeKit renvoye par GET /api/homekit.
// Sert a l'onglet Reglages : activation, demarrage, code PIN, URI de configuration
// (QR code), chemin de stockage HAP et la liste des projecteurs exposes.
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

/**
 * Helper central pour tous les appels HTTP au backend.
 * - Ajoute l'en-tete Content-Type JSON uniquement quand il y a un corps (body).
 * - Leve une Error avec le texte de la reponse si le statut n'est pas 2xx
 *   (l'UI peut afficher ce message directement).
 * - Gere le 204 (No Content) en renvoyant undefined, sinon parse le JSON.
 * @param path chemin relatif de la route (ex. "/api/fixtures")
 * @param init options fetch (methode, corps, en-tetes)
 * @returns le corps JSON type en T (ou undefined pour un 204)
 */
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

  // 204 = succes sans corps (ex. apres un DELETE) : rien a parser.
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

// Objet `api` : surface complete des appels backend, regroupes par domaine.
// Chaque methode renvoie une promesse typee via fetchJSON. C'est l'unique facade
// utilisee par les composants React (ils n'appellent jamais fetch directement).
export const api = {
  // Projecteurs (fixtures) : CRUD + import depuis la bibliotheque QXF.
  fixtures: {
    list: () => fetchJSON<Fixture[]>("/api/fixtures"),
    create: (body: unknown) => fetchJSON<Fixture>("/api/fixtures", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: unknown) =>
      fetchJSON<Fixture>(`/api/fixtures/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    delete: (id: string) => fetchJSON<void>(`/api/fixtures/${id}`, { method: "DELETE" }),
    importQxfLibrary: (body: unknown) =>
      fetchJSON<Fixture>("/api/fixtures/import/qxf-library", { method: "POST", body: JSON.stringify(body) })
  },
  // Scenes enregistrees (etats rappelables de plusieurs canaux).
  scenes: {
    list: () => fetchJSON<Scene[]>("/api/scenes")
  },
  // Univers DMX : ecrit la valeur 0-255 d'un canal donne (console DMX / curseurs).
  universe: {
    setChannel: (channel: number, value: number) =>
      fetchJSON<{ ok: true }>(`/api/universe/${channel}`, {
        method: "POST",
        body: JSON.stringify({ value })
      })
  },
  // Bibliotheque de profils QXF (QLC+) : lecture du cache local et rafraichissement
  // (refresh re-telecharge depuis GitHub, ~50 Mo au premier acces).
  qxf: {
    library: () => fetchJSON<QxfLibraryFixture[]>("/api/qxf/library"),
    refresh: () => fetchJSON<QxfLibraryFixture[]>("/api/qxf/library/refresh", { method: "POST" })
  },
  // Etat du pont HomeKit (lecture seule).
  homekit: {
    status: () => fetchJSON<HomeKitStatus>("/api/homekit")
  },
  // Liste des pieces (rooms) connues, pour le rangement des projecteurs/lampes.
  rooms: {
    list: () => fetchJSON<string[]>("/api/rooms")
  },
  // Mode Dance (chenillard automatique) : etat, config, demarrage et arret.
  dance: {
    state: () => fetchJSON<DanceState>("/api/dance/state"),
    updateConfig: (patch: Partial<DanceConfig>) =>
      fetchJSON<DanceState>("/api/dance/config", { method: "PUT", body: JSON.stringify(patch) }),
    start: () => fetchJSON<DanceState>("/api/dance/start", { method: "POST" }),
    stop: () => fetchJSON<DanceState>("/api/dance/stop", { method: "POST" })
  },
  // Lampes connectees (smart lights, ex. Nanoleaf) : CRUD, etat bas-latence,
  // appairage/re-appairage, sonde de joignabilite, decouverte mDNS, effets,
  // streaming UDP, palette par zone, layout 3D et effet sensible a la position.
  smartLights: {
    list: () => fetchJSON<SmartLight[]>("/api/smart-lights"),
    create: (body: SmartLightInput) =>
      fetchJSON<SmartLight>("/api/smart-lights", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<SmartLightInput>) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    delete: (id: string) => fetchJSON<void>(`/api/smart-lights/${id}`, { method: "DELETE" }),
    // Chemin bas-latence : pousse un etat (couleur/intensite) regroupe cote backend.
    setState: (id: string, body: SmartLightStateInput) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/state`, { method: "POST", body: JSON.stringify(body) }),
    // Appaire une nouvelle lampe (cree l'entree). L'appareil doit etre en mode appairage.
    pair: (body: { host: string; port?: number; name?: string; room?: string }) =>
      fetchJSON<SmartLight>("/api/smart-lights/pair", { method: "POST", body: JSON.stringify(body) }),
    // Re-appaire une lampe existante pour rafraichir son token.
    repair: (id: string) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/pair`, { method: "POST" }),
    // Sonde rapide : verifie si l'API Nanoleaf repond et si elle est en mode appairage.
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

/**
 * Calcule l'URL du WebSocket /ws (flux temps reel : ticks DMX, maj des lampes...).
 * Ordre de priorite des sources :
 *   1. VITE_WS_URL force tout (override explicite).
 *   2. VITE_API_BASE si defini : on reutilise sa base en convertissant http→ws / https→wss.
 *   3. En dev : on vise directement le backend sur :5000 pour eviter les soucis de proxy WS.
 *      ATTENTION : on prend le hostname de la page (pas "localhost") pour que l'acces
 *      depuis un telephone sur le LAN fonctionne.
 *   4. En prod : meme host que la page, protocole ws/wss aligne sur http/https.
 */
export const wsUrl = () => {
  const override = import.meta.env.VITE_WS_URL as string | undefined;
  if (override) return override;
  // Si une base API explicite est definie, on la reutilise (conversion http -> ws).
  if (API_BASE.startsWith("http")) {
    const url = new URL(API_BASE);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    return url.toString();
  }
  // Defaut en dev : taper le backend directement pour eviter les soucis de proxy WS
  // (on utilise le host de la page, pas localhost, pour l'acces depuis le LAN).
  if (import.meta.env.DEV) {
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    return `ws://${host}:5000/ws`;
  }
  const { protocol, host } = window.location;
  const wsProtocol = protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${host}/ws`;
};
