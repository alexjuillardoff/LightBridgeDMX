// Fabrique de projecteurs pour les tests (logique pure, sans réseau).
import type { Capability, Fixture } from "@lightbridgedmx/shared";

let seq = 0;

/** Projecteur minimal : capabilities dans l'ordre = canaux relatifs 1..n. */
export const makeFixture = (opts: {
  name: string;
  address: number;
  caps: Capability[];
  room?: string;
  id?: string;
  universe?: number;
  profile?: Fixture["profile"];
}): Fixture => {
  seq += 1;
  return {
    id: opts.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    name: opts.name,
    address: opts.address,
    universe: opts.universe ?? 0,
    channels: opts.caps.map((capability, i) => ({ channel: i + 1, capability })),
    createdAt: "2026-01-01T00:00:00.000Z",
    ...(opts.room ? { room: opts.room } : {}),
    ...(opts.profile ? { profile: opts.profile } : {})
  };
};

/** Bandeau de `zones` zones (r,g,b par zone) + dimmer master en queue. */
export const makeStrip = (name: string, address: number, zones: number): Fixture => {
  const caps: Capability[] = [];
  for (let i = 0; i < zones; i += 1) caps.push("r", "g", "b");
  caps.push("intensity");
  return makeFixture({ name, address, caps });
};
