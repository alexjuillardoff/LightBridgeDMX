// Decouverte (discovery mDNS) des lampes connectees (smart lights) Nanoleaf sur le reseau local.
// Ecoute les annonces mDNS du service `_nanoleafapi._tcp` pendant une fenetre de temps,
// puis renvoie la liste des appareils trouves (hote, port, nom, modele).
import type { FastifyBaseLogger } from "fastify";
import { Bonjour } from "bonjour-service";
import type { NanoleafDiscovered } from "@lightbridgedmx/shared";

/** Scanne le reseau local a la recherche de Nanoleaf via le service mDNS `_nanoleafapi._tcp`.
 *  L'appelant fournit un delai de scan ; on collecte tout ce qui s'annonce pendant cette fenetre.
 *  @param timeoutMs duree du scan en millisecondes
 *  @param logger logger Fastify pour tracer chaque appareil decouvert
 *  @returns liste des Nanoleaf joignables detectes (sans doublon) */
export async function discoverNanoleaf(
  timeoutMs: number,
  logger: FastifyBaseLogger
): Promise<NanoleafDiscovered[]> {
  const bonjour = new Bonjour();
  // Map indexee par "ip:port" pour eviter d'enregistrer deux fois le meme appareil.
  const found = new Map<string, NanoleafDiscovered>();

  const browser = bonjour.find({ type: "nanoleafapi", protocol: "tcp" }, (service) => {
    // Chaque service s'annonce avec plusieurs adresses (IPv4 + IPv6) : on ne garde que l'IPv4 (sans ":").
    const ipv4 = (service.addresses ?? []).find((a) => !a.includes(":"));
    if (!ipv4) return;
    const key = `${ipv4}:${service.port}`;
    if (found.has(key)) return;
    // L'enregistrement TXT du mDNS porte des metadonnees ; `md` = modele de l'appareil.
    const txt = (service.txt ?? {}) as Record<string, string>;
    found.set(key, {
      host: ipv4,
      port: service.port,
      name: service.name,
      model: txt.md
    });
    logger.info({ host: ipv4, port: service.port, name: service.name }, "Discovered Nanoleaf");
  });

  // On attend la fin de la fenetre de scan, puis on coupe l'ecoute et on libere les ressources reseau.
  await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  browser.stop();
  bonjour.destroy();
  return [...found.values()];
}
