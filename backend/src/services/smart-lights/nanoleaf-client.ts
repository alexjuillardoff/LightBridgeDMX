// Client HTTP minimal pour une lampe connectee (smart light) Nanoleaf.
// Parle l'API OpenAPI locale du panneau (port 16021) : appairage (pairing),
// lecture d'etat, choix d'effet, ecriture de couleur et passage en streaming UDP.
// C'est la couche bas niveau ; le SmartLightService s'en sert pour piloter la lampe.
import type { FastifyBaseLogger } from "fastify";

// Etat courant d'un panneau Nanoleaf tel qu'on l'expose au reste du backend.
export type NanoleafState = {
  on: boolean;
  hue: number;        // teinte, 0–360 degres
  sat: number;        // saturation, 0–100
  brightness: number; // luminosite, 0–100
  ct?: number;        // temperature de couleur en Kelvin (mode blanc)
  colorMode?: "hs" | "ct" | "effect"; // mode actif : teinte/sat, blanc, ou effet
  currentEffect?: string;             // nom de l'effet selectionne (si mode "effect")
  reachable: boolean; // true si la lampe a repondu (joignable sur le reseau)
};

// Identite + etat complet d'un panneau, renvoyes par getInfo().
export type NanoleafInfo = {
  name: string;
  serialNo?: string;
  model?: string;
  firmwareVersion?: string;
  state: NanoleafState;
};

// Erreur dediee aux appels Nanoleaf : porte le code HTTP renvoye par la lampe
// pour qu'un appelant puisse distinguer 403 (pas en appairage), 401 (sans token), etc.
export class NanoleafApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * Client minimal pour l'API OpenAPI Nanoleaf (HTTP, port 16021).
 * Spec : https://forum.nanoleaf.me/docs/openapi
 */
export class NanoleafClient {
  private readonly base: string;
  private readonly logger: FastifyBaseLogger;
  private readonly token: string | undefined;

  constructor(opts: {
    host: string;
    port?: number;
    token?: string;
    logger: FastifyBaseLogger;
  }) {
    // URL de base de l'API ; 16021 est le port HTTP standard des Nanoleaf.
    this.base = `http://${opts.host}:${opts.port ?? 16021}`;
    this.token = opts.token;
    this.logger = opts.logger.child({ service: "nanoleaf-client", host: opts.host });
  }

  /**
   * Tente l'appairage (pairing) avec le panneau et renvoie le token d'auth.
   * ATTENTION : l'utilisateur doit d'abord mettre la lampe en mode appairage
   * (maintenir le bouton power ~5–7 s jusqu'a ce que la LED clignote). Sans ca,
   * la lampe repond 403 et l'appel echoue.
   */
  static async pair(host: string, port = 16021, logger?: FastifyBaseLogger): Promise<string> {
    const url = `http://${host}:${port}/api/v1/new`;
    const res = await fetch(url, { method: "POST" });
    if (res.status === 200) {
      const body = (await res.json()) as { auth_token?: string };
      if (!body.auth_token) {
        throw new NanoleafApiError("Pairing succeeded but no auth_token returned", 200);
      }
      logger?.info({ host }, "Nanoleaf pairing successful");
      return body.auth_token;
    }
    // 403 = lampe pas en mode appairage : message explicite pour guider l'utilisateur.
    if (res.status === 403) {
      throw new NanoleafApiError(
        "Device is not in pairing mode. Hold the power button ~5–7s until the LED pulses, then retry.",
        403
      );
    }
    throw new NanoleafApiError(`Pairing failed (HTTP ${res.status})`, res.status);
  }

  // Garde-fou : tout appel authentifie passe par ici pour exiger un token.
  private requireToken(): string {
    if (!this.token) throw new NanoleafApiError("Missing auth token — pair first", 401);
    return this.token;
  }

  // Lit l'identite et l'etat complet du panneau (on/off, couleur, effet courant).
  async getInfo(): Promise<NanoleafInfo> {
    const token = this.requireToken();
    const res = await fetch(`${this.base}/api/v1/${token}/`);
    if (!res.ok) throw new NanoleafApiError(`GET / failed (HTTP ${res.status})`, res.status);
    type Range = { value: number; max?: number; min?: number };
    const body = (await res.json()) as {
      name?: string;
      serialNo?: string;
      model?: string;
      firmwareVersion?: string;
      state?: {
        on?: { value: boolean };
        brightness?: Range;
        hue?: Range;
        sat?: Range;
        ct?: Range;
        colorMode?: string;
      };
    };
    // L'effet selectionne se lit sur un endpoint separe. On l'interroge a part,
    // et un echec ici n'est pas bloquant : on renverra juste l'etat sans l'effet.
    let currentEffect: string | undefined;
    try {
      const effectRes = await fetch(`${this.base}/api/v1/${token}/effects/select`);
      if (effectRes.ok) {
        const raw = (await effectRes.json()) as string | null;
        if (raw && typeof raw === "string") currentEffect = raw;
      }
    } catch {
      // non bloquant
    }
    return {
      name: body.name ?? "Nanoleaf",
      serialNo: body.serialNo,
      model: body.model,
      firmwareVersion: body.firmwareVersion,
      state: {
        on: body.state?.on?.value ?? false,
        brightness: body.state?.brightness?.value ?? 0,
        hue: body.state?.hue?.value ?? 0,
        sat: body.state?.sat?.value ?? 0,
        ct: body.state?.ct?.value,
        colorMode: (body.state?.colorMode as "hs" | "ct" | "effect" | undefined) ?? undefined,
        currentEffect,
        reachable: true
      }
    };
  }

  // NB : plus de listEffects()/selectEffect() ici. Les effets embarques de l'appareil
  // ne sont plus pilotes par LightBridge — tout ce qui joue sur un bandeau est calcule
  // par le moteur d'effets local, et sort par la trame UDP. Le nom d'effet renvoye par
  // getInfo() reste lu, mais uniquement comme temoin du mode extControl.

  /**
   * Bascule la lampe en mode streaming UDP (extControl v2). Une fois cet appel
   * termine, les trames (frames) UDP envoyees vers host:60222 pilotent directement
   * les LEDs, en basse latence. NB : ce mode reste actif jusqu'au prochain
   * PUT /state ou PUT /effects, qui le coupe.
   */
  async enableExtControl(version: "v2" = "v2"): Promise<void> {
    const token = this.requireToken();
    const res = await fetch(`${this.base}/api/v1/${token}/effects`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        write: { command: "display", animType: "extControl", extControlVersion: version }
      })
    });
    if (!res.ok && res.status !== 204) {
      throw new NanoleafApiError(`PUT /effects (extControl) failed (HTTP ${res.status})`, res.status);
    }
  }

  /**
   * Un seul PUT /state : regroupe (coalesce) toutes les dimensions fournies en
   * un unique aller-retour reseau. NB : ecrire hue/sat fait passer la lampe en
   * mode couleur "hs", ecrire ct la fait passer en "ct" ; dans les deux cas
   * l'effet en cours est stoppe.
   */
  async setState(
    patch: Partial<Pick<NanoleafState, "on" | "hue" | "sat" | "brightness" | "ct">>,
    transitionMs = 0
  ): Promise<void> {
    const token = this.requireToken();
    // On ne met dans le corps (payload) que les champs reellement fournis.
    const body: Record<string, unknown> = {};
    if (patch.on !== undefined) body.on = { value: patch.on };
    if (patch.brightness !== undefined) {
      // L'API attend la duree de transition en secondes ; on convertit depuis les ms.
      body.brightness = { value: Math.round(patch.brightness), duration: Math.max(0, Math.round(transitionMs / 1000)) };
    }
    if (patch.hue !== undefined) body.hue = { value: Math.round(patch.hue) };
    if (patch.sat !== undefined) body.sat = { value: Math.round(patch.sat) };
    if (patch.ct !== undefined) body.ct = { value: Math.round(patch.ct) };

    // Rien a changer : on evite un appel reseau inutile.
    if (Object.keys(body).length === 0) return;

    const res = await fetch(`${this.base}/api/v1/${token}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok && res.status !== 204) {
      throw new NanoleafApiError(`PUT /state failed (HTTP ${res.status})`, res.status);
    }
  }

  /**
   * Raccourci : applique une couleur RGB. Le bandeau LED (strip) l'affiche en
   * une seule couleur unie. La lampe ne comprend que le HSB, d'ou la conversion.
   */
  async setRgb(rgb: { r: number; g: number; b: number }, brightness?: number): Promise<void> {
    const { h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b);
    await this.setState({
      hue: h,
      sat: s,
      // Si l'appelant fournit une luminosite explicite (variateur maitre), on la
      // privilegie ; sinon on prend le V (valeur) issu de la conversion RGB.
      brightness: brightness ?? v
    });
  }
}

/** Convertit un RGB 0–255 en HSV : H en degres [0,360], S et V en [0,100]. */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;
  return { h, s, v };
}
