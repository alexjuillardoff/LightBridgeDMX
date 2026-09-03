// Scan mDNS generique du reseau local.
//
// La decouverte Nanoleaf (services/smart-lights/discovery.ts) ne regarde qu'un
// seul type de service. Ici on balaie plusieurs types en une passe pour alimenter
// l'inventaire unifie de l'ecran "Appareils" — y compris des services que
// LightBridge ne sait PAS piloter (HomeKit tiers, Matter/Thread), justement pour
// pouvoir expliquer a l'utilisateur pourquoi tel appareil n'apparait pas ailleurs.
import type { FastifyBaseLogger } from "fastify";
import { Bonjour } from "bonjour-service";

/** Types de services mDNS balayes a chaque scan.
 *  `id` est la cle utilisee dans l'inventaire : elle doit rester distincte pour
 *  `_hap._tcp` (HomeKit sur IP) et `_hap._udp` (HomeKit sur Thread), qui portent
 *  le meme nom de service mais decrivent des appareils tres differents. */
const SERVICE_TYPES = [
  { id: "nanoleafapi", type: "nanoleafapi", protocol: "tcp" as const },
  { id: "hap", type: "hap", protocol: "tcp" as const },
  // HomeKit sur Thread : transport CoAP/UDP:5683. C'est la ou vivent les ampoules
  // Nanoleaf Essentials — invisibles de tout scan IPv4.
  { id: "hap-thread", type: "hap", protocol: "udp" as const },
  { id: "matter", type: "matter", protocol: "tcp" as const },
  { id: "meshcop", type: "meshcop", protocol: "udp" as const }
];

/** Un service mDNS brut, normalise : c'est la matiere premiere de l'inventaire. */
export type MdnsDevice = {
  /** Cle de service : "nanoleafapi", "hap", "hap-thread", "matter", "meshcop". */
  serviceType: string;
  name: string;
  /** Premiere adresse IPv4 annoncee, si l'appareil en a une.
   *  Les noeuds Thread n'en ont pas : ils ne vivent qu'en IPv6 sur le maillage. */
  host?: string;
  /** Adresse IPv6 — seule adresse des appareils Thread (prefixe ULA fd../64). */
  host6?: string;
  port?: number;
  txt: Record<string, string>;
};

/**
 * Garde en cache le resultat du dernier scan mDNS.
 *
 * Un scan coute plusieurs secondes d'attente (on ecoute des annonces qui arrivent
 * quand elles veulent) : on ne veut pas le refaire a chaque affichage de la page.
 * GET /api/devices sert donc le cache, et POST /api/devices/scan le rafraichit.
 */
export class NetworkScanner {
  private readonly logger: FastifyBaseLogger;
  private cache: MdnsDevice[] = [];
  private scannedAt: string | null = null;
  /** Scan en cours, s'il y en a un : deux appels concurrents partagent la meme passe
   *  plutot que d'ouvrir deux jeux de sockets mDNS sur les memes services. */
  private inflight: Promise<MdnsDevice[]> | null = null;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger.child({ service: "network-scan" });
  }

  /** Dernier resultat connu, sans declencher de scan. */
  getCache(): { devices: MdnsDevice[]; scannedAt: string | null } {
    return { devices: this.cache, scannedAt: this.scannedAt };
  }

  /** Lance un scan (ou rejoint celui deja en cours) et met le cache a jour. */
  async scan(timeoutMs = 6000): Promise<MdnsDevice[]> {
    if (this.inflight) return this.inflight;
    this.inflight = this.runScan(timeoutMs).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async runScan(timeoutMs: number): Promise<MdnsDevice[]> {
    const bonjour = new Bonjour();
    // Indexe par "type/nom" : un meme appareil s'annonce sur plusieurs interfaces
    // (Wi-Fi + Ethernet) et on ne veut pas le compter deux fois.
    const found = new Map<string, MdnsDevice>();

    const browsers = SERVICE_TYPES.map((svc) =>
      bonjour.find({ type: svc.type, protocol: svc.protocol }, (service) => {
        const addresses = service.addresses ?? [];
        const ipv4 = addresses.find((a) => !a.includes(":"));
        // On ignore les adresses lien-local (fe80::) : elles ne sont pas routables
        // et n'apprennent rien sur l'emplacement reel de l'appareil.
        const ipv6 = addresses.find((a) => a.includes(":") && !a.toLowerCase().startsWith("fe80"));
        const key = `${svc.id}/${service.name}`;
        const existing = found.get(key);
        // Une annonce ulterieure peut porter l'adresse que la premiere n'avait pas :
        // on complete l'entree au lieu de la jeter.
        if (existing) {
          if (!existing.host && ipv4) existing.host = ipv4;
          if (!existing.host6 && ipv6) existing.host6 = ipv6;
          return;
        }
        found.set(key, {
          serviceType: svc.id,
          name: service.name,
          host: ipv4,
          host6: ipv6,
          port: service.port,
          txt: (service.txt ?? {}) as Record<string, string>
        });
      })
    );

    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    for (const b of browsers) b.stop();
    bonjour.destroy();

    this.cache = [...found.values()];
    this.scannedAt = new Date().toISOString();
    this.logger.info({ count: this.cache.length }, "Scan mDNS termine");
    return this.cache;
  }
}
