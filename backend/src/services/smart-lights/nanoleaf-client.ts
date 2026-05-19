import type { FastifyBaseLogger } from "fastify";

export type NanoleafState = {
  on: boolean;
  hue: number;        // 0–360
  sat: number;        // 0–100
  brightness: number; // 0–100
  ct?: number;        // Kelvin
  colorMode?: "hs" | "ct" | "effect";
  currentEffect?: string;
  reachable: boolean;
};

export type NanoleafInfo = {
  name: string;
  serialNo?: string;
  model?: string;
  firmwareVersion?: string;
  state: NanoleafState;
};

export class NanoleafApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * Minimal Nanoleaf OpenAPI client (HTTP, port 16021).
 * Spec: https://forum.nanoleaf.me/docs/openapi
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
    this.base = `http://${opts.host}:${opts.port ?? 16021}`;
    this.token = opts.token;
    this.logger = opts.logger.child({ service: "nanoleaf-client", host: opts.host });
  }

  /** Attempt pairing. The user must put the device into pairing mode first
   *  (hold power button ~5–7 s until LED pulses). Returns the auth token. */
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
    if (res.status === 403) {
      throw new NanoleafApiError(
        "Device is not in pairing mode. Hold the power button ~5–7s until the LED pulses, then retry.",
        403
      );
    }
    throw new NanoleafApiError(`Pairing failed (HTTP ${res.status})`, res.status);
  }

  private requireToken(): string {
    if (!this.token) throw new NanoleafApiError("Missing auth token — pair first", 401);
    return this.token;
  }

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
    let currentEffect: string | undefined;
    try {
      const effectRes = await fetch(`${this.base}/api/v1/${token}/effects/select`);
      if (effectRes.ok) {
        const raw = (await effectRes.json()) as string | null;
        if (raw && typeof raw === "string") currentEffect = raw;
      }
    } catch {
      // non-fatal
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

  async listEffects(): Promise<string[]> {
    const token = this.requireToken();
    const res = await fetch(`${this.base}/api/v1/${token}/effects/effectsList`);
    if (!res.ok) throw new NanoleafApiError(`GET /effects/effectsList failed (HTTP ${res.status})`, res.status);
    const arr = (await res.json()) as string[];
    // The device sometimes returns duplicates — dedupe.
    return [...new Set(arr)];
  }

  async selectEffect(name: string): Promise<void> {
    const token = this.requireToken();
    const res = await fetch(`${this.base}/api/v1/${token}/effects`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ select: name })
    });
    if (!res.ok && res.status !== 204) {
      throw new NanoleafApiError(`PUT /effects (select) failed (HTTP ${res.status})`, res.status);
    }
  }

  /** Switch the device into UDP streaming (extControl v2) mode. After this returns,
   *  UDP frames sent to host:60222 will drive the LEDs. The mode persists until
   *  another PUT /state or PUT /effects is sent. */
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

  /** Single PUT /state — coalesces every dimension provided into one round-trip.
   *  Setting hue/sat switches the device into "hs" color mode; setting ct switches to "ct";
   *  either halts the currently selected effect. */
  async setState(
    patch: Partial<Pick<NanoleafState, "on" | "hue" | "sat" | "brightness" | "ct">>,
    transitionMs = 0
  ): Promise<void> {
    const token = this.requireToken();
    const body: Record<string, unknown> = {};
    if (patch.on !== undefined) body.on = { value: patch.on };
    if (patch.brightness !== undefined) {
      body.brightness = { value: Math.round(patch.brightness), duration: Math.max(0, Math.round(transitionMs / 1000)) };
    }
    if (patch.hue !== undefined) body.hue = { value: Math.round(patch.hue) };
    if (patch.sat !== undefined) body.sat = { value: Math.round(patch.sat) };
    if (patch.ct !== undefined) body.ct = { value: Math.round(patch.ct) };

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

  /** Convenience: write an RGB color (the strip applies it as one solid color). */
  async setRgb(rgb: { r: number; g: number; b: number }, brightness?: number): Promise<void> {
    const { h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b);
    await this.setState({
      hue: h,
      sat: s,
      // If caller provided an explicit brightness, prefer it (master dimmer); otherwise use V from RGB.
      brightness: brightness ?? v
    });
  }
}

/** RGB 0–255 → HSV with H in degrees [0,360], S/V in [0,100]. */
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
