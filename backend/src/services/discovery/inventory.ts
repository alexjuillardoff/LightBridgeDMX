// Construction de l'inventaire unifie des appareils.
//
// Agrege quatre sources heterogenes en une seule liste plate :
//   1. les projecteurs DMX (base SQLite)         -> pilotables
//   2. les lampes connectees appairees            -> pilotables
//   3. la prise Meross                            -> pilotable si configuree
//   4. le scan mDNS du reseau                     -> le reste, pilotable ou non
//
// Le parti pris : on liste AUSSI ce que LightBridge ne sait pas piloter, avec la
// raison. Sans ca, l'utilisateur qui cherche son ampoule Nanoleaf Essentials ne
// comprend pas pourquoi elle n'apparait nulle part — alors qu'elle est bien la,
// simplement injoignable depuis IPv4 parce qu'elle vit sur le maillage Thread.
import {
  DeviceCategory,
  DeviceInventoryEntry,
  Fixture,
  MerossStatus,
  SmartLight
} from "@lightbridgedmx/shared";
import type { MdnsDevice } from "./network-scan";

/** Derniere adresse DMX occupee par un projecteur (adresse de depart + plus grand
 *  offset de canal). Les canaux sont relatifs a l'adresse, d'ou le -1. */
const lastChannel = (fixture: Fixture): number =>
  fixture.address + Math.max(...fixture.channels.map((c) => c.channel)) - 1;

/** Un projecteur DMX. `reachable` reste null : le DMX512 est un flux sans voie de
 *  retour, on ne peut donc pas savoir si le projecteur est reellement branche. */
const fromFixture = (fixture: Fixture): DeviceInventoryEntry => ({
  id: fixture.id,
  name: fixture.name,
  category: "dmx",
  transport: "Art-Net → QLC+ → DMX512",
  controllable: true,
  address: `U${fixture.universe} · ch. ${fixture.address}–${lastChannel(fixture)}`,
  detail: `${fixture.channels.length} canaux`,
  reachable: null,
  room: fixture.room
});

/** Une lampe connectee appairee. Le detail annonce le chemin de sortie reellement
 *  utilise, puisque c'est ce qui determine la latence percue. */
const fromSmartLight = (light: SmartLight): DeviceInventoryEntry => {
  const streaming = light.streaming?.enabled === true;
  const zones = light.streaming?.zoneCount ?? 50;
  const host = light.config.type === "nanoleaf-http" ? light.config.host : undefined;
  return {
    id: light.id,
    name: light.name,
    category: "smart-light",
    transport: streaming ? "Nanoleaf HTTP + streaming UDP" : "Nanoleaf HTTP",
    controllable: true,
    address: host,
    detail: streaming ? `UDP ~30 Hz · ${zones} zones` : "HTTP · ~14 écritures/s",
    reachable: light.state?.reachable ?? null,
    room: light.room
  };
};

/** La prise Meross. Elle existe dans l'inventaire des qu'un hote est configure,
 *  meme desactivee — sinon on ne saurait pas expliquer son absence. */
const fromMeross = (status: MerossStatus): DeviceInventoryEntry | null => {
  if (!status.host.trim() && !status.enabled) return null;
  // `active` = enabled + hote + cle. On distingue les deux causes d'inactivite
  // pour que le message affiche dise quoi corriger.
  const reason = status.active
    ? undefined
    : !status.enabled
      ? "Désactivée dans les réglages"
      : "Hôte ou clé manquants dans la configuration";
  return {
    id: "meross-plug",
    name: "Prise Meross",
    category: "plug",
    transport: "API locale Meross (LAN)",
    controllable: status.active,
    reason,
    address: status.host || undefined,
    detail: status.on === null ? "état inconnu" : status.on ? "allumée" : "éteinte",
    reachable: status.reachable
  };
};

/** Regroupe les noeuds Matter par fabric (le nom mDNS est "<fabricId>-<nodeId>").
 *  Les lister un par un donnerait des dizaines de lignes en hexadecimal illisible :
 *  une ligne par fabric porte la meme information utile. */
const fromMatterFabrics = (devices: MdnsDevice[]): DeviceInventoryEntry[] => {
  const byFabric = new Map<string, number>();
  for (const d of devices) {
    const fabric = d.name.split("-")[0] ?? d.name;
    byFabric.set(fabric, (byFabric.get(fabric) ?? 0) + 1);
  }
  return [...byFabric.entries()].map(([fabric, count]) => ({
    id: `matter:${fabric}`,
    name: `Fabric Matter ${fabric.slice(0, 8)}…`,
    category: "unknown" as const,
    transport: "Matter over Thread",
    controllable: false,
    reason:
      "Matter/Thread — LightBridge n'est pas un contrôleur Matter. Les nœuds ne sont pas " +
      "identifiables depuis IPv4 : leur nom et leur marque restent invisibles hors de la fabric.",
    detail: `${count} nœud${count > 1 ? "s" : ""}`,
    reachable: null
  }));
};

/** Categories d'accessoires HAP (champ TXT `ci`) qu'on sait nommer.
 *  Liste volontairement partielle : seules celles qu'on croise reellement ici. */
const HAP_CATEGORIES: Record<string, { label: string; category: DeviceCategory }> = {
  "2": { label: "pont", category: "bridge" },
  "5": { label: "ampoule", category: "smart-light" },
  "7": { label: "prise", category: "plug" },
  "8": { label: "interrupteur", category: "plug" },
  "10": { label: "capteur", category: "unknown" }
};

/**
 * Traduit une annonce `_hap._udp` — HomeKit sur Thread — en ligne d'inventaire.
 *
 * C'est ici que vivent les ampoules Nanoleaf Essentials (modele NL45) : elles ne
 * parlent ni HTTP ni Matter, mais HAP sur CoAP/UDP:5683, au bout du maillage Thread.
 * Aucun scan IPv4 ne peut les voir — d'ou leur absence totale des autres vues.
 *
 * Le champ TXT `sf` (status flag) dit si l'accessoire est appairable : 1 = libre,
 * 0 = deja appaire a un controleur (typiquement la maison Apple de l'utilisateur).
 * Un accessoire HAP appaire ne peut pas etre repris par un second controleur sans
 * reinitialisation : c'est la vraie raison pour laquelle LightBridge ne peut pas
 * les piloter aujourd'hui, bien plus que le transport Thread lui-meme.
 */
const fromThreadDevice = (d: MdnsDevice): DeviceInventoryEntry => {
  const meta = HAP_CATEGORIES[d.txt.ci ?? ""] ?? { label: "accessoire", category: "unknown" as const };
  const paired = d.txt.sf === "0";
  const model = d.txt.md ? `modèle ${d.txt.md}` : undefined;

  return {
    id: `thread-hap:${d.name}`,
    name: d.name,
    category: meta.category,
    transport: "HomeKit sur Thread (HAP/CoAP)",
    controllable: false,
    reason: paired
      ? `${meta.label.charAt(0).toUpperCase()}${meta.label.slice(1)} HomeKit sur Thread, déjà appairée à une maison Apple. Un accessoire HAP appairé ne peut pas être repris par un second contrôleur sans réinitialisation, et LightBridge est un pont HomeKit, pas un contrôleur.`
      : `${meta.label.charAt(0).toUpperCase()}${meta.label.slice(1)} HomeKit sur Thread, non appairée. LightBridge ne sait pas encore parler HAP sur CoAP/Thread.`,
    // L'IPv6 du maillage est la seule adresse : la montrer evite de croire a un bug
    // quand la colonne adresse est vide partout ailleurs pour ces appareils.
    address: d.host6 ?? d.host,
    detail: model,
    reachable: null
  };
};

/** Prefixe des modeles de prises Meross ("MSS210-dee5"). Ces prises s'annoncent en
 *  HomeKit, mais LightBridge sait parler leur API locale : les ranger avec les
 *  accessoires HomeKit tiers serait trompeur. */
const MEROSS_MODEL = /^MSS\d/i;

/** Traduit une annonce `_hap._tcp` en ligne d'inventaire, avec la bonne raison. */
const fromHapDevice = (d: MdnsDevice, homekitName: string | null): DeviceInventoryEntry => {
  // hap-nodejs suffixe le displayName d'un hash 4 caracteres du MAC ("Bridge 02A3"),
  // donc l'annonce mDNS n'est jamais strictement egale au nom configure.
  const isOurs =
    homekitName !== null && (d.name === homekitName || d.name.startsWith(`${homekitName} `));
  const isMeross = MEROSS_MODEL.test(d.name);

  const reason = isOurs
    ? "C'est le pont exposé par LightBridge lui-même — il publie les projecteurs DMX vers l'app Maison."
    : isMeross
      ? "Prise Meross détectée. LightBridge sait piloter ce modèle, mais ne gère qu'une seule prise à la fois — celle configurée dans Réglages."
      : "Accessoire HomeKit tiers — LightBridge expose un pont HomeKit, il n'est pas contrôleur HomeKit et ne peut donc pas piloter les accessoires des autres.";

  return {
    id: `hap:${d.name}`,
    name: d.name,
    category: isMeross ? "plug" : "bridge",
    transport: isMeross ? "HomeKit (HAP) · API locale Meross disponible" : "HomeKit (HAP)",
    controllable: false,
    reason,
    address: d.host,
    reachable: d.host ? true : null
  };
};

/**
 * Assemble l'inventaire complet.
 *
 * Deduplication : un meme appareil physique s'annonce souvent sur plusieurs services
 * (un Nanoleaf Shapes apparait en `_nanoleafapi`, `_hap` ET `_meshcop`). On parcourt
 * donc les sources par ordre de richesse decroissante et on ignore une annonce dont
 * l'IP ou le nom a deja ete vu.
 */
export const buildInventory = (input: {
  fixtures: Fixture[];
  lights: SmartLight[];
  meross: MerossStatus;
  /** Nom du pont HomeKit expose par LightBridge, pour ne pas le presenter comme un tiers. */
  homekitName: string | null;
  mdns: MdnsDevice[];
}): DeviceInventoryEntry[] => {
  const entries: DeviceInventoryEntry[] = [];
  // Hotes deja pris par un appareil REELLEMENT pilote (lampe appairee, prise
  // configuree). Sert a ne pas re-lister en "detecte" ce qu'on pilote deja.
  const ownedHosts = new Set<string>();
  // Noms d'instance mDNS deja affiches. C'est la bonne cle de deduplication entre
  // services : un meme appareil s'annonce sous le MEME nom en `_nanoleafapi`,
  // `_hap` et `_meshcop` (un Shapes le fait sur les trois).
  //
  // NB : surtout PAS de deduplication par IP a l'interieur du mDNS. Plusieurs
  // accessoires HomeKit distincts partagent legitimement une machine — ce Mac
  // heberge a lui seul le pont LightBridge, Homebridge et un autre pont — et
  // dedupliquer par hote les faisait disparaitre tous sauf un.
  const seenNames = new Set<string>();

  const claimName = (name?: string) => {
    if (name) seenNames.add(name.toLowerCase());
  };
  const nameSeen = (name: string) => seenNames.has(name.toLowerCase());

  // 1. Projecteurs DMX. Aucune IP : pas de collision possible avec le mDNS.
  for (const fixture of input.fixtures) entries.push(fromFixture(fixture));

  // 2. Lampes appairees — elles priment sur toute annonce mDNS du meme appareil.
  for (const light of input.lights) {
    const entry = fromSmartLight(light);
    entries.push(entry);
    if (entry.address) ownedHosts.add(entry.address);
    claimName(light.name);
    if (light.config.type === "nanoleaf-http") claimName(light.config.deviceName);
  }

  // 3. Prise Meross configuree.
  const meross = fromMeross(input.meross);
  if (meross) {
    entries.push(meross);
    if (meross.address) ownedHosts.add(meross.address);
  }

  /** Une annonce mDNS est ignoree si on pilote deja cet hote, ou si un service
   *  precedent a deja publie ce nom. */
  const skip = (d: MdnsDevice) =>
    (d.host !== undefined && ownedHosts.has(d.host)) || nameSeen(d.name);

  // 4a. Nanoleaf vus sur le reseau mais pas encore appaires : pilotables apres appairage.
  for (const d of input.mdns.filter((m) => m.serviceType === "nanoleafapi")) {
    if (skip(d)) continue;
    entries.push({
      id: `nanoleaf:${d.host ?? d.name}`,
      name: d.name,
      category: "smart-light",
      transport: "Nanoleaf HTTP + streaming UDP",
      controllable: false,
      reason: "Détecté sur le réseau mais pas encore appairé à LightBridge",
      address: d.host,
      detail: d.txt.md ? `modèle ${d.txt.md}` : undefined,
      reachable: true,
      action: "pair",
      actionHost: d.host
    });
    claimName(d.name);
  }

  // 4b. Accessoires HomeKit.
  for (const d of input.mdns.filter((m) => m.serviceType === "hap")) {
    if (skip(d)) continue;
    entries.push(fromHapDevice(d, input.homekitName));
    claimName(d.name);
  }

  // 4b-bis. Accessoires HomeKit sur Thread (ampoules Nanoleaf Essentials & co).
  for (const d of input.mdns.filter((m) => m.serviceType === "hap-thread")) {
    if (skip(d)) continue;
    entries.push(fromThreadDevice(d));
    claimName(d.name);
  }

  // 4c. Routeurs de bordure Thread : ils relaient le maillage ou vivent les ampoules
  // Matter. Les montrer explique justement leur invisibilite en IPv4.
  for (const d of input.mdns.filter((m) => m.serviceType === "meshcop")) {
    if (skip(d)) continue;
    entries.push({
      id: `thread:${d.host ?? d.name}`,
      name: d.name,
      category: "bridge",
      transport: "Routeur de bordure Thread",
      controllable: false,
      reason:
        "Relaie le maillage Thread (ampoules Matter, capteurs). Ce n'est pas une source de lumière pilotable.",
      address: d.host,
      reachable: d.host ? true : null
    });
    claimName(d.name);
  }

  // 4d. Fabrics Matter, agregees.
  entries.push(...fromMatterFabrics(input.mdns.filter((m) => m.serviceType === "matter")));

  return entries;
};
