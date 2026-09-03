// Client API du frontend : point d'entree unique pour parler au backend Fastify.
// Regroupe tous les appels REST (projecteurs, scenes, univers DMX, QXF, HomeKit,
// Mode Dance, lampes connectees) derriere l'objet `api`, plus le helper wsUrl()
// qui calcule l'URL du WebSocket temps reel. Les types sont importes du package
// partage @lightbridgedmx/shared pour rester coherents avec le backend.

import {
  DanceConfig,
  DanceState,
  DeviceInventory,
  Fixture,
  MerossConfigInput,
  MerossConsumption,
  MerossStatus,
  NanoleafDiscovered,
  Preset,
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
// kind = famille d'accessoire : "channels" (un Lightbulb par canal DMX) ou
// "movingHead" (lyre exposee en accessoire multi-services). channels = les
// canaux resolus, indexes par role.
export type HomeKitFixtureStatus = {
  fixtureId: string;
  name: string;
  universe: number;
  kind: "channels" | "movingHead";
  channels: Record<string, number>;
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
  /** Lampes connectees exposees : un seul accessoire chacune, avec teinte et
   *  saturation natives — a la difference des projecteurs, exposes canal par canal.
   *  `fixtureId` est present quand la lampe est exposee via sa facade DMX : c'est
   *  ce projecteur-la qui porte le badge « HomeKit » dans le patch. */
  smartLights?: { id: string; name: string; backend: string; fixtureId?: string }[];
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
    // Repatch groupe : le backend valide la disposition finale d'un bloc puis
    // ecrit tout d'un coup. Un PUT par projecteur echouerait en 409 des que
    // deux projecteurs se croisent en cours de deplacement.
    repatch: (moves: { id: string; address: number; universe?: number }[]) =>
      fetchJSON<Fixture[]>("/api/fixtures/repatch", { method: "POST", body: JSON.stringify({ moves }) }),
    importQxfLibrary: (body: unknown) =>
      fetchJSON<Fixture>("/api/fixtures/import/qxf-library", { method: "POST", body: JSON.stringify(body) })
  },
  // Scenes enregistrees (etats rappelables de plusieurs canaux).
  // Ce sont les "executors" du pupitre : STORE ecrit une scene, GO la rejoue.
  scenes: {
    list: () => fetchJSON<Scene[]>("/api/scenes"),
    create: (body: { name: string; steps: { fixtureId: string; values: number[] }[] }) =>
      fetchJSON<Scene>("/api/scenes", { method: "POST", body: JSON.stringify(body) }),
    // Rejoue la scene cote backend : chaque pas est reecrit sur le DMX, puis un
    // evenement scene_activated est diffuse a toutes les UI connectees.
    activate: (id: string) =>
      fetchJSON<{ ok: true }>(`/api/scenes/${id}/activate`, { method: "POST" }),
    // Supprime definitivement la scene (et donc l'executor qui la porte).
    delete: (id: string) => fetchJSON<void>(`/api/scenes/${id}`, { method: "DELETE" })
  },
  // Presets : jeux de valeurs de canaux reutilisables (le "pool" du pupitre).
  presets: {
    list: () => fetchJSON<Preset[]>("/api/presets"),
    create: (body: { name: string; payload: Record<string, number> }) =>
      fetchJSON<Preset>("/api/presets", { method: "POST", body: JSON.stringify(body) }),
    apply: (id: string) =>
      fetchJSON<{ ok: true }>(`/api/presets/${id}/apply`, { method: "POST" })
  },
  // Univers DMX : ecrit la valeur 0-255 d'un canal donne (console DMX / curseurs).
  universe: {
    setChannel: (channel: number, value: number) =>
      fetchJSON<{ ok: true }>(`/api/universe/${channel}`, {
        method: "POST",
        body: JSON.stringify({ value })
      }),
    // Ecriture groupee : une seule requete pour tous les canaux qui ont bouge.
    // C'est ce que la console utilise pendant un glissement de fader ; envoyer un
    // POST par evenement de mouvement saturait les ~6 connexions du navigateur.
    setMany: (values: Record<number, number>) =>
      fetchJSON<{ ok: true; count: number }>("/api/universe", {
        method: "POST",
        body: JSON.stringify({ values })
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
  // Patch automatise des ampoules HomeKit-sur-Thread.
  threadLights: {
    // Appairees cote sidecar mais pas encore declarees : « pretes a patcher ».
    candidates: () =>
      fetchJSON<{
        sidecarUp: boolean;
        candidates: { alias: string; name: string; reachable: boolean }[];
        message?: string;
      }>("/api/smart-lights/thread/candidates"),
    // Declare la lampe et lui donne une adresse DMX (ou la rattache a un projecteur
    // existant via fixtureId), en une seule operation.
    adopt: (body: {
      alias: string;
      name?: string;
      room?: string;
      patchDmx?: boolean;
      fixtureId?: string;
    }) =>
      fetchJSON<{ light: SmartLight; fixture: Fixture | null; address: number | null }>(
        "/api/smart-lights/thread/adopt",
        { method: "POST", body: JSON.stringify(body) }
      ),
    // Lance l'appairage. Ouvre Terminal.app : le Bluetooth est inaccessible au backend.
    pair: (body: { name: string; pin: string; alias?: string }) =>
      fetchJSON<{ started: boolean; alias: string; message: string }>(
        "/api/smart-lights/thread/pair",
        { method: "POST", body: JSON.stringify(body) }
      )
  },
  // Inventaire unifie des appareils (DMX, lampes, prises, ponts, Matter).
  devices: {
    // Reponse immediate : sert le dernier scan mDNS en cache cote backend.
    list: () => fetchJSON<DeviceInventory>("/api/devices"),
    // Relance un scan reseau (quelques secondes) puis renvoie l'inventaire a jour.
    scan: (body?: { timeoutMs?: number }) =>
      fetchJSON<DeviceInventory>("/api/devices/scan", {
        method: "POST",
        body: JSON.stringify(body ?? {})
      })
  },
  // Prise connectee Meross (pilotage local LAN) : statut, mise a jour de config, test.
  meross: {
    status: () => fetchJSON<MerossStatus>("/api/meross"),
    update: (patch: MerossConfigInput) =>
      fetchJSON<MerossStatus>("/api/meross", { method: "PUT", body: JSON.stringify(patch) }),
    test: () =>
      fetchJSON<{ reachable: boolean; on: boolean | null; error: string | null }>("/api/meross/test", {
        method: "POST"
      }),
    // Historique de consommation journaliere (Wh/jour) lu dans la prise.
    // null si la prise est inactive ou depourvue de metrologie.
    consumption: () => fetchJSON<MerossConsumption | null>("/api/meross/consumption")
  },
  // Operations systeme : redemarrage complet de LightBridgeDMX (backend + frontend + QLC+).
  system: {
    restart: () =>
      fetchJSON<{ status: string; services: string[] }>("/api/system/restart", { method: "POST" })
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
      }),
    // Expose le bandeau comme un projecteur DMX : 3 canaux (R/G/B) par zone.
    // Le corps est optionnel — sans adresse, le backend alloue le premier bloc libre.
    createDmxFixture: (
      id: string,
      body?: { zoneCount?: number; startChannel?: number; universe?: number; name?: string; room?: string }
    ) =>
      fetchJSON<{ light: SmartLight; fixture: Fixture }>(`/api/smart-lights/${id}/dmx-fixture`, {
        method: "POST",
        body: JSON.stringify(body ?? {})
      }),
    // Supprime le projecteur genere et debranche le miroir DMX par zone.
    deleteDmxFixture: (id: string) =>
      fetchJSON<SmartLight>(`/api/smart-lights/${id}/dmx-fixture`, { method: "DELETE" })
  }
};

/**
 * Calcule l'URL du WebSocket /ws (flux temps reel : ticks DMX, maj des lampes...).
 * Ordre de priorite des sources :
 *   1. VITE_WS_URL force tout (override explicite).
 *   2. VITE_API_BASE si defini : on reutilise sa base en convertissant http→ws / https→wss.
 *   3. Defaut : meme origine que la page (host ET port), protocole ws/wss aligne sur
 *      http/https. On passe donc par le proxy /ws (dev server Vite en dev, reverse
 *      proxy en facade sinon), exactement comme les appels REST /api.
 *
 * Historique : le mode dev visait auparavant `ws://<hostname>:5000` en dur pour
 * court-circuiter le proxy. Deux defauts rendaient l'app inutilisable derriere une
 * facade HTTPS (ex. https://light.alexjuillard.fr) : le `ws://` en dur declenchait un
 * blocage Mixed Content du navigateur, et le port 5000 n'est de toute facon pas expose
 * par le reverse proxy. Le proxy WS de Vite (`ws: true`) fonctionne, donc suivre
 * l'origine de la page est correct dans tous les cas et marche aussi depuis un mobile.
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
  // `host` (et non `hostname`) inclut le port : on reste ainsi sur la meme origine,
  // que la page soit servie sur :5173 en direct ou sur 443 derriere le reverse proxy.
  const { protocol, host } = window.location;
  const wsProtocol = protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${host}/ws`;
};
