// Streamer (flux UDP) Nanoleaf : pousse des trames couleur en streaming UDP
// vers un bandeau LED (strip) Nanoleaf via le protocole extControl v2.
// Permet un rendu basse latence (~5-15 ms) par zone, plus rapide que le HTTP.
import dgram from "node:dgram";
import type { FastifyBaseLogger } from "fastify";
import { NanoleafClient } from "./nanoleaf-client";

/** Format de la trame (frame) UDP extControl v2 :
 *    [panelCount:uint16 BE]
 *    [panelId:uint16 BE][R:u8][G:u8][B:u8][W:u8][transitionMs/100:uint16 BE]   × panelCount
 *
 * Constate empiriquement sur NL72K3 Lightstrip Essentials (50 zones, IDs panneaux 0-49) :
 *   - les panneaux non specifies restent noirs (remplacement par trame, pas d'accumulation)
 *   - le streaming exige des trames soutenues (~10 Hz minimum pour garder le mode actif)
 *   - "remplissage" mono-couleur = envoyer le meme RGB a chaque panneau
 */
export class NanoleafStreamer {
  private readonly host: string;
  private readonly port: number;
  private readonly logger: FastifyBaseLogger;
  private readonly client: NanoleafClient;
  private socket: dgram.Socket | null = null;
  private zoneCount: number;
  /** Derniere trame envoyee — gardee pour que la boucle keepalive puisse repeter le dernier etat. */
  private lastFrame: Buffer | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private enabled = false;
  /** Nombre de trames envoyees depuis le demarrage (telemetrie). */
  public framesSent = 0;
  /** Horodatage du dernier envoi UDP. */
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

  /** Active extControl sur l'appareil + ouvre le socket UDP + lance un keepalive a 4 Hz
   *  qui retransmet la derniere trame pour eviter que l'appareil ne quitte le streaming tout seul. */
  async enable(): Promise<void> {
    if (this.enabled) return;
    await this.client.enableExtControl("v2");
    this.socket = dgram.createSocket("udp4");
    this.enabled = true;
    // Keepalive (maintien de session) : on reenvoie la derniere trame uniquement si
    // plus de 250 ms se sont ecoulees sans envoi, pour ne pas spammer quand l'UI pousse deja.
    this.keepaliveTimer = setInterval(() => {
      if (this.lastFrame && Date.now() - this.lastSentAt > 250) {
        this.rawSend(this.lastFrame);
      }
    }, 250);
    this.logger.info({ host: this.host, port: this.port, zones: this.zoneCount }, "Nanoleaf streaming enabled");
  }

  /** Arrete le keepalive + ferme le socket. Ne reinitialise PAS l'appareil : si tu veux
   *  que le bandeau (strip) revienne proprement a un etat hors extControl, appelle d'abord
   *  restoreEffect("Cozy Glow") ou setState({on:false}) sur le client HTTP. */
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

  /** Envoie une couleur RGB uniforme sur toutes les zones. Cas le plus courant
   *  (miroir DMX mono-couleur, glissement d'un curseur de l'UI). */
  sendUniform(rgb: { r: number; g: number; b: number; w?: number }): void {
    if (!this.enabled || !this.socket) return;
    // On construit la trame complete : 2 octets d'en-tete + 8 octets par zone.
    const buf = Buffer.alloc(2 + this.zoneCount * 8);
    buf.writeUInt16BE(this.zoneCount, 0);
    let offset = 2;
    for (let i = 0; i < this.zoneCount; i++) {
      buf.writeUInt16BE(i, offset);
      buf[offset + 2] = clamp8(rgb.r);
      buf[offset + 3] = clamp8(rgb.g);
      buf[offset + 4] = clamp8(rgb.b);
      buf[offset + 5] = clamp8(rgb.w ?? 0);
      buf.writeUInt16BE(0, offset + 6); // transition = 0 (changement instantane)
      offset += 8;
    }
    this.rawSend(buf);
  }

  /** Envoie une palette par zone. Les zones absentes du payload sont ecrites en noir. */
  sendZones(zones: Array<{ index: number; r: number; g: number; b: number; w?: number }>): void {
    if (!this.enabled || !this.socket) return;
    // On indexe les couleurs fournies par numero de zone pour un acces rapide ensuite.
    const colors = new Map<number, { r: number; g: number; b: number; w: number }>();
    for (const z of zones) {
      colors.set(z.index, { r: clamp8(z.r), g: clamp8(z.g), b: clamp8(z.b), w: clamp8(z.w ?? 0) });
    }
    const buf = Buffer.alloc(2 + this.zoneCount * 8);
    buf.writeUInt16BE(this.zoneCount, 0);
    let offset = 2;
    for (let i = 0; i < this.zoneCount; i++) {
      // Zone non fournie -> noir : le protocole ne conserve pas l'etat precedent entre trames.
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

  // Envoi UDP bas niveau : pousse la trame et met a jour la telemetrie + le keepalive.
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

// Borne (clamp) une valeur dans la plage 0-255 d'un canal et arrondit a l'entier.
// Renvoie 0 pour toute valeur non finie (NaN/Infinity) par securite.
const clamp8 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
};
