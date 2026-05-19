import dgram from "node:dgram";
import type { FastifyBaseLogger } from "fastify";
import { NanoleafClient } from "./nanoleaf-client";

/** v2 extControl UDP frame:
 *    [panelCount:uint16 BE]
 *    [panelId:uint16 BE][R:u8][G:u8][B:u8][W:u8][transitionMs/100:uint16 BE]   × panelCount
 *
 * Discovered empirically on NL72K3 Lightstrip Essentials (50 zones, panel IDs 0–49):
 *   • unspecified panels stay black (per-frame replacement, no accumulation)
 *   • streaming requires sustained frames (~10 Hz minimum to keep mode active)
 *   • single-color "fill" = send same RGB for every panel
 */
export class NanoleafStreamer {
  private readonly host: string;
  private readonly port: number;
  private readonly logger: FastifyBaseLogger;
  private readonly client: NanoleafClient;
  private socket: dgram.Socket | null = null;
  private zoneCount: number;
  /** Last frame written — kept so the keepalive loop can repeat the last state. */
  private lastFrame: Buffer | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private enabled = false;
  /** Frames pushed since startup (for telemetry). */
  public framesSent = 0;
  /** Timestamp of last UDP send. */
  public lastSentAt = 0;

  constructor(opts: {
    host: string;
    port?: number;
    zoneCount: number;
    client: NanoleafClient;
    logger: FastifyBaseLogger;
  }) {
    this.host = opts.host;
    this.port = opts.port ?? 60222;
    this.zoneCount = opts.zoneCount;
    this.client = opts.client;
    this.logger = opts.logger.child({ service: "nanoleaf-streamer", host: opts.host });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setZoneCount(n: number): void {
    this.zoneCount = n;
  }

  /** Enable extControl on the device + open the UDP socket + start a 4 Hz keepalive
   *  that retransmits the last frame so the device doesn't auto-exit streaming. */
  async enable(): Promise<void> {
    if (this.enabled) return;
    await this.client.enableExtControl("v2");
    this.socket = dgram.createSocket("udp4");
    this.enabled = true;
    this.keepaliveTimer = setInterval(() => {
      if (this.lastFrame && Date.now() - this.lastSentAt > 250) {
        this.rawSend(this.lastFrame);
      }
    }, 250);
    this.logger.info({ host: this.host, port: this.port, zones: this.zoneCount }, "Nanoleaf streaming enabled");
  }

  /** Stop the keepalive + close the socket. Does NOT re-arm the device — call
   *  restoreEffect("Cozy Glow") or setState({on:false}) on the HTTP client first if
   *  you want the strip to return to a non-extControl state cleanly. */
  async disable(): Promise<void> {
    if (!this.enabled) return;
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.enabled = false;
    this.lastFrame = null;
    this.logger.info("Nanoleaf streaming disabled");
  }

  /** Send a uniform RGB color across every zone. Most common use case (DMX-mirror
   *  single color, UI slider drag). */
  sendUniform(rgb: { r: number; g: number; b: number; w?: number }): void {
    if (!this.enabled || !this.socket) return;
    const buf = Buffer.alloc(2 + this.zoneCount * 8);
    buf.writeUInt16BE(this.zoneCount, 0);
    let offset = 2;
    for (let i = 0; i < this.zoneCount; i++) {
      buf.writeUInt16BE(i, offset);
      buf[offset + 2] = clamp8(rgb.r);
      buf[offset + 3] = clamp8(rgb.g);
      buf[offset + 4] = clamp8(rgb.b);
      buf[offset + 5] = clamp8(rgb.w ?? 0);
      buf.writeUInt16BE(0, offset + 6); // transition = 0 (instant)
      offset += 8;
    }
    this.rawSend(buf);
  }

  /** Send a per-zone palette. Zones not in the payload are written as black. */
  sendZones(zones: Array<{ index: number; r: number; g: number; b: number; w?: number }>): void {
    if (!this.enabled || !this.socket) return;
    const colors = new Map<number, { r: number; g: number; b: number; w: number }>();
    for (const z of zones) {
      colors.set(z.index, { r: clamp8(z.r), g: clamp8(z.g), b: clamp8(z.b), w: clamp8(z.w ?? 0) });
    }
    const buf = Buffer.alloc(2 + this.zoneCount * 8);
    buf.writeUInt16BE(this.zoneCount, 0);
    let offset = 2;
    for (let i = 0; i < this.zoneCount; i++) {
      const c = colors.get(i) ?? { r: 0, g: 0, b: 0, w: 0 };
      buf.writeUInt16BE(i, offset);
      buf[offset + 2] = c.r;
      buf[offset + 3] = c.g;
      buf[offset + 4] = c.b;
      buf[offset + 5] = c.w;
      buf.writeUInt16BE(0, offset + 6);
      offset += 8;
    }
    this.rawSend(buf);
  }

  private rawSend(buf: Buffer): void {
    if (!this.socket) return;
    this.socket.send(buf, this.port, this.host, (err) => {
      if (err) this.logger.warn({ err }, "UDP send failed");
    });
    this.lastFrame = buf;
    this.lastSentAt = Date.now();
    this.framesSent++;
  }
}

const clamp8 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
};
