// Projecteurs « patchés » : la vue dérivée du patch dont toute l'interface se sert.
//
// Un Fixture du backend ne connaît ni son numéro de pupitre (FID), ni son
// encombrement, ni le verrou de la chambre. buildPatch() les calcule une fois,
// dans un ordre stable (univers, adresse), et les hooks mémoïsent le résultat
// sur l'identité de appStore.fixtures : tant que le patch ne change pas, tous
// les composants partagent les MÊMES objets PatchedFixture.
//
// Les index secondaires (par id, par canal, canaux dimmables, canaux verrouillés)
// sont cachés par WeakMap sur le tableau du patch : gratuit à relire, jamais périmé.
import type { Capability, Fixture, SmartLight } from "@lightbridgedmx/shared";
import { lockReason } from "./guard";
import { useStore } from "./store";
import { appStore } from "../state/app";

export type PatchedFixture = Fixture & {
  /** 1..n, ordre (universe, address) croissant — stable tant que le patch ne change pas. */
  fid: number;
  /** Nombre de canaux occupés depuis l'adresse (plus grand canal relatif). */
  span: number;
  /** Raison du verrou (lib/guard) ou null. */
  locked: string | null;
  /** Façade d'une lampe connectée (bloc DMX sans existence physique) — info seulement. */
  isFacade: boolean;
  /** Zones détectées (motif r,g,b répété ≥ 3 fois) sinon 0 → sous-projecteurs d'un bandeau. */
  subCount: number;
};

/** Capabilities qu'un master (GM, fader d'executor) a le droit d'atténuer.
 *  Pan, tilt, gobo, roue de couleurs… sont rejoués tels quels : un executor à 50 %
 *  baisse la lumière, il ne ramène pas la lyre à mi-course. */
export const DIMMABLE_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "intensity",
  "r",
  "g",
  "b",
  "w",
  "uv"
]);

/** Canal absolu dans l'univers (1-512) d'un canal relatif : address + relative - 1. */
export const absoluteChannel = (f: Fixture, relative: number): number => f.address + relative - 1;

/** Canaux absolus (1-512) d'un projecteur portant une capability donnée, dans l'ordre du profil. */
export const channelsFor = (f: Fixture, capability: Capability): number[] =>
  f.channels
    .filter((ch) => ch.capability === capability)
    .map((ch) => absoluteChannel(f, ch.channel))
    .filter((ch) => ch >= 1 && ch <= 512);

/** Encombrement : plus grand canal relatif (un profil 1/2/8 occupe 8 slots, pas 3). */
export const fixtureSpan = (f: Pick<Fixture, "channels">): number =>
  f.channels.reduce((max, ch) => Math.max(max, ch.channel), 0);

/** Canaux absolus du bloc contigu d'un projecteur (adresse → adresse + span - 1), bornés à l'univers. */
export const blockChannels = (f: Pick<Fixture, "address" | "channels">): number[] => {
  const span = fixtureSpan(f);
  const out: number[] = [];
  for (let i = 0; i < span; i += 1) {
    const ch = f.address + i;
    if (ch >= 1 && ch <= 512) out.push(ch);
  }
  return out;
};

/** Nombre de zones d'un bandeau : triplets (r,g,b) consécutifs depuis le premier canal.
 *  Moins de 3 triplets = un simple projecteur RGB, pas un bandeau → 0. */
export const detectZones = (f: Pick<Fixture, "channels">): number => {
  const sorted = [...f.channels].sort((a, b) => a.channel - b.channel);
  let count = 0;
  for (let i = 0; i + 2 < sorted.length; i += 3) {
    const [r, g, b] = [sorted[i], sorted[i + 1], sorted[i + 2]];
    if (r.capability !== "r" || g.capability !== "g" || b.capability !== "b") break;
    if (g.channel !== r.channel + 1 || b.channel !== r.channel + 2) break;
    count += 1;
  }
  return count >= 3 ? count : 0;
};

/** Ids des projecteurs qui servent de façade à une lampe connectée — même règle que
 *  le backend (services/facade-patch.ts) : lien explicite `zones.fixtureId`, sinon
 *  le projecteur qui possède tous les canaux du miroir uniforme. */
export const facadeIds = (fixtures: Fixture[], lights: SmartLight[]): Set<string> => {
  const ids = new Set<string>();
  for (const light of lights) {
    const mirror = light.dmxMirror;
    if (!mirror) continue;
    if (mirror.zones?.fixtureId && fixtures.some((f) => f.id === mirror.zones?.fixtureId)) {
      ids.add(mirror.zones.fixtureId);
      continue;
    }
    const universe = mirror.universe ?? 0;
    const wanted = [mirror.rChannel, mirror.gChannel, mirror.bChannel, mirror.briChannel].filter(
      (ch): ch is number => ch !== undefined
    );
    if (!wanted.length) continue;
    const owner = fixtures.find((f) => {
      if (f.universe !== universe) return false;
      const owned = new Set(f.channels.map((ch) => absoluteChannel(f, ch.channel)));
      return wanted.every((ch) => owned.has(ch));
    });
    if (owner) ids.add(owner.id);
  }
  return ids;
};

// Sans la liste des lampes (tests, premier rendu), on reconnaît une façade à sa
// forme : pas de profil QXF et soit un bandeau de zones, soit le bloc à 5 canaux
// d'une ampoule Thread (intensity, r, g, b, colorTemp).
const looksLikeFacade = (f: Fixture): boolean => {
  if (f.profile) return false;
  if (detectZones(f) >= 3) return true;
  const caps = f.channels.map((ch) => ch.capability).sort().join(",");
  return f.channels.length === 5 && caps === "b,colorTemp,g,intensity,r";
};

/** Construit le patch : tri (universe, address), FID, span, verrou, façade, zones. */
export function buildPatch(fixtures: Fixture[], smartLights: SmartLight[] = []): PatchedFixture[] {
  const facades = facadeIds(fixtures, smartLights);
  const sorted = [...fixtures].sort(
    (a, b) => a.universe - b.universe || a.address - b.address || a.name.localeCompare(b.name, "fr")
  );
  return sorted.map((f, index) => ({
    ...f,
    fid: index + 1,
    span: fixtureSpan(f),
    locked: lockReason(f),
    isFacade: facades.has(f.id) || looksLikeFacade(f),
    subCount: detectZones(f)
  }));
}

// ─── Cache du patch courant ─────────────────────────────────────────────────
// Mémoïsé sur l'identité de la liste de projecteurs et sur une clé dérivée des
// miroirs des lampes : une lampe qui change d'état (luminosité, joignabilité) ne
// rebâtit pas le patch, seule une façade qui apparaît ou disparaît le fait.
let lightsSeen: SmartLight[] | null = null;
let lightsKey = "";
const facadeKey = (lights: SmartLight[]): string => {
  if (lights === lightsSeen) return lightsKey;
  lightsSeen = lights;
  lightsKey = lights.map((l) => `${l.id}:${JSON.stringify(l.dmxMirror ?? null)}`).join("|");
  return lightsKey;
};

let patchCache: { fixtures: Fixture[]; key: string; patch: PatchedFixture[] } | null = null;

/** Patch mémoïsé pour une liste de projecteurs (même référence tant que rien ne change). */
export function getPatch(fixtures: Fixture[], smartLights: SmartLight[] = []): PatchedFixture[] {
  const key = facadeKey(smartLights);
  if (patchCache && patchCache.fixtures === fixtures && patchCache.key === key) return patchCache.patch;
  const patch = buildPatch(fixtures, smartLights);
  patchCache = { fixtures, key, patch };
  return patch;
}

/** Patch courant, lu sans abonnement (actions, writer, ligne de commande). */
export function currentPatch(): PatchedFixture[] {
  const state = appStore.get();
  return getPatch(state.fixtures, state.smartLights);
}

const selectPatch = (s: { fixtures: Fixture[]; smartLights: SmartLight[] }): PatchedFixture[] =>
  getPatch(s.fixtures, s.smartLights);

/** Hook : patch mémoïsé sur appStore.fixtures (et les façades des lampes). */
export function usePatch(): PatchedFixture[] {
  return useStore(appStore, selectPatch);
}

// Index par id, caché sur le tableau du patch.
const byIdCache = new WeakMap<PatchedFixture[], Map<string, PatchedFixture>>();
export function patchIndex(patch: PatchedFixture[]): Map<string, PatchedFixture> {
  let map = byIdCache.get(patch);
  if (!map) {
    map = new Map(patch.map((f) => [f.id, f]));
    byIdCache.set(patch, map);
  }
  return map;
}

const selectPatchById = (s: { fixtures: Fixture[]; smartLights: SmartLight[] }): Map<string, PatchedFixture> =>
  patchIndex(getPatch(s.fixtures, s.smartLights));

/** Hook : Map id → PatchedFixture, même référence tant que le patch ne change pas. */
export function usePatchById(): Map<string, PatchedFixture> {
  return useStore(appStore, selectPatchById);
}

/** Projecteur par numéro de pupitre (FID). Le patch est trié par FID : accès direct. */
export function byFid(patch: PatchedFixture[], fid: number): PatchedFixture | undefined {
  const direct = patch[fid - 1];
  if (direct && direct.fid === fid) return direct;
  return patch.find((f) => f.fid === fid);
}

// Propriétaire de chaque canal : bloc contigu de chaque projecteur (les trous d'un
// profil restent au projecteur). En cas de chevauchement, le premier du patch gagne.
const ownerCache = new WeakMap<PatchedFixture[], Map<number, PatchedFixture>>();
const ownerIndex = (patch: PatchedFixture[]): Map<number, PatchedFixture> => {
  let map = ownerCache.get(patch);
  if (!map) {
    map = new Map();
    for (const f of patch) {
      for (const ch of blockChannels(f)) {
        if (!map.has(ch)) map.set(ch, f);
      }
    }
    ownerCache.set(patch, map);
  }
  return map;
};

/** Projecteur propriétaire d'un canal absolu (1-512), ou undefined. */
export function fixtureOf(patch: PatchedFixture[], channel: number): PatchedFixture | undefined {
  return ownerIndex(patch).get(channel);
}

// Canaux atténuables par un master (capability DIMMABLE, projecteurs non verrouillés).
const dimmableCache = new WeakMap<PatchedFixture[], Set<number>>();
export function dimmableChannels(patch: PatchedFixture[]): Set<number> {
  let set = dimmableCache.get(patch);
  if (!set) {
    set = new Set();
    for (const f of patch) {
      if (f.locked) continue;
      for (const ch of f.channels) {
        if (!DIMMABLE_CAPABILITIES.has(ch.capability)) continue;
        const abs = absoluteChannel(f, ch.channel);
        if (abs >= 1 && abs <= 512) set.add(abs);
      }
    }
    dimmableCache.set(patch, set);
  }
  return set;
}

// Canaux que le writer doit refuser : tout le bloc des projecteurs verrouillés.
const lockedCache = new WeakMap<PatchedFixture[], Set<number>>();
export function lockedChannels(patch: PatchedFixture[]): Set<number> {
  let set = lockedCache.get(patch);
  if (!set) {
    set = new Set();
    for (const f of patch) {
      if (!f.locked) continue;
      blockChannels(f).forEach((ch) => set?.add(ch));
    }
    lockedCache.set(patch, set);
  }
  return set;
}

/** Libellé court du type (colonne FixtureType du patch) : « Fabricant Modèle / mode » ou « Generic n ch ». */
export const fixtureTypeLabel = (f: Fixture): string =>
  f.profile ? `${f.profile.manufacturer} ${f.profile.model} / ${f.profile.mode}` : `Generic ${fixtureSpan(f)} ch`;

/** Adresse au format pupitre : « 0.001 » = univers 0, canal 1. */
export const formatPatchAddress = (universe: number, address: number): string =>
  `${universe}.${String(address).padStart(3, "0")}`;
