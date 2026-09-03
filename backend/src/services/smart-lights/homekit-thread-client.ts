// Client du sidecar HomeKit-sur-Thread.
//
// Les ampoules Nanoleaf Essentials parlent HAP sur CoAP, protocole dont la seule
// implementation exploitable est `aiohomekit`, en Python. Le backend ne leur parle
// donc jamais directement : il passe par `tools/homekit-thread/sidecar.py`, qui
// garde les connexions CoAP ouvertes et expose une API HTTP sur la boucle locale.
//
// Ce fichier est volontairement mince : toute la complexite HAP vit dans le sidecar.
import type { FastifyBaseLogger } from "fastify";

/** Etat d'une ampoule tel que le sidecar le renvoie. */
export type ThreadLightState = {
  alias: string;
  name?: string;
  reachable: boolean;
  on?: boolean;
  brightness?: number; // 0-100
  hue?: number;        // 0-360
  sat?: number;        // 0-100
};

/** Champs acceptes en ecriture. Tout est optionnel : on n'envoie que ce qui change. */
export type ThreadLightPatch = {
  on?: boolean;
  brightness?: number;
  hue?: number;
  sat?: number;
};

export class HomeKitThreadClient {
  private readonly base: string;
  private readonly alias: string;
  private readonly logger: FastifyBaseLogger;
  /** Delai maximal d'un echange. Thread est lent : mieux vaut abandonner une trame
   *  en retard que d'empiler les requetes sur un medium partage. */
  private readonly timeoutMs: number;

  constructor(opts: {
    alias: string;
    sidecarUrl?: string;
    logger: FastifyBaseLogger;
    timeoutMs?: number;
  }) {
    this.alias = opts.alias;
    this.base = (opts.sidecarUrl ?? "http://127.0.0.1:5056").replace(/\/+$/, "");
    this.logger = opts.logger.child({ service: "homekit-thread", alias: opts.alias });
    this.timeoutMs = opts.timeoutMs ?? 4000;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.base}${path}`, { ...init, signal: ctrl.signal });
      if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Etat courant de l'ampoule, tel que vu par le sidecar. */
  async getState(): Promise<ThreadLightState> {
    const lights = await this.request<ThreadLightState[]>("/lights");
    const mine = lights.find((l) => l.alias === this.alias);
    if (!mine) throw new Error(`alias ${this.alias} absent du sidecar`);
    return mine;
  }

  /** Ecrit les champs fournis. Le sidecar serialise les ecritures par ampoule. */
  async setState(patch: ThreadLightPatch): Promise<ThreadLightState> {
    return this.request<ThreadLightState>(`/lights/${encodeURIComponent(this.alias)}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
  }

  /** Le sidecar tourne-t-il ? Sert a distinguer "ampoule injoignable" de
   *  "passerelle arretee", deux pannes qui se reparent tres differemment. */
  async isUp(): Promise<boolean> {
    try {
      await this.request<{ status: string }>("/health");
      return true;
    } catch {
      return false;
    }
  }
}
