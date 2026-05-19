import type { FastifyBaseLogger } from "fastify";
import { Bonjour } from "bonjour-service";
import type { NanoleafDiscovered } from "@lightbridgedmx/shared";

/** Scan the LAN for Nanoleaf devices via mDNS service `_nanoleafapi._tcp`.
 *  Caller provides a timeout; we collect everything that announces during the window. */
export async function discoverNanoleaf(
  timeoutMs: number,
  logger: FastifyBaseLogger
): Promise<NanoleafDiscovered[]> {
  const bonjour = new Bonjour();
  const found = new Map<string, NanoleafDiscovered>();

  const browser = bonjour.find({ type: "nanoleafapi", protocol: "tcp" }, (service) => {
    // Each service announces with addresses (IPv4 + IPv6) — keep IPv4.
    const ipv4 = (service.addresses ?? []).find((a) => !a.includes(":"));
    if (!ipv4) return;
    const key = `${ipv4}:${service.port}`;
    if (found.has(key)) return;
    const txt = (service.txt ?? {}) as Record<string, string>;
    found.set(key, {
      host: ipv4,
      port: service.port,
      name: service.name,
      model: txt.md
    });
    logger.info({ host: ipv4, port: service.port, name: service.name }, "Discovered Nanoleaf");
  });

  await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  browser.stop();
  bonjour.destroy();
  return [...found.values()];
}
