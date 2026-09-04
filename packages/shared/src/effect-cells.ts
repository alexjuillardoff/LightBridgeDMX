// =============================================================================
// Resolution des CELLULES d'une selection.
//
// C'est la piece qui fait qu'un effet ne connait plus la difference entre « un
// PAR » et « un bandeau de 50 zones » : les deux se ramenent a une liste de
// cellules, chacune portant les canaux DMX absolus de ses attributs.
//
//   PAR 56 (6 canaux, capabilities intensity/r/g/b)  -> 1 cellule
//   Lyre MH-X20 (pan/tilt/dimmer)                    -> 1 cellule
//   Bandeau LED (facade 50 zones x RGB + master)     -> 50 cellules
//
// La phase de l'effet se repartit ensuite sur cette liste a plat, dans l'ordre de
// selection : selectionner la lyre puis le bandeau met la lyre en phase 0 et etale
// le reste du cycle sur les 50 zones.
//
// Ce module vit dans le package PARTAGE, et pas cote backend : l'apercu de la
// fenetre Effets doit developper la selection exactement comme le moteur le fera,
// sinon il annonce un chenillard sur 3 pas la ou le bandeau en jouera 50.
// =============================================================================
import type {
  EffectAttribute,
  Fixture,
  Point3D,
  SmartLight,
  SmartLightZoneLayout
} from "./index";

/** Une cellule pilotable : ses canaux DMX absolus, par attribut. */
export type EffectCell = {
  fixtureId: string;
  /** Rang de la cellule DANS son projecteur (0 pour un projecteur simple). */
  cellIndex: number;
  /** Canal DMX absolu (1-512) pour chaque attribut disponible sur cette cellule.
   *  Un attribut absent signifie que la cellule ne sait pas le jouer — une ligne
   *  d'effet qui le vise sera simplement sans effet sur elle. */
  channels: Partial<Record<EffectAttribute, number>>;
  /** Position 3D, quand on la connait (zones d'un bandeau ayant un layout).
   *  Sert a la distribution spatiale ; absente pour un projecteur classique. */
  position?: Point3D;
  /** Section nommee du layout a laquelle appartient la cellule, s'il y en a une. */
  side?: string;
};

/** Traduction capability du patch -> attribut d'effet. Volontairement etroite :
 *  seuls les attributs qu'un effet sait moduler y figurent. */
const CAPABILITY_TO_ATTRIBUTE: Record<string, EffectAttribute> = {
  intensity: "dimmer",
  r: "red",
  g: "green",
  b: "blue",
  pan: "pan",
  tilt: "tilt"
};

/**
 * Developpe une selection de projecteurs en cellules.
 *
 * L'ordre de sortie suit `fixtureIds` — l'ordre de selection du programmeur — et
 * les cellules d'un meme projecteur se suivent. Un id inconnu est ignore en
 * silence : une selection peut contenir un projecteur supprime entre-temps.
 */
export function resolveCells(
  fixtureIds: string[],
  fixtures: Fixture[],
  smartLights: SmartLight[]
): EffectCell[] {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  // Index inverse facade DMX -> lampe connectee, pour reconnaitre les multi-cellules.
  const stripByFixtureId = new Map<string, SmartLight>();
  for (const light of smartLights) {
    const fid = light.dmxMirror?.zones?.fixtureId;
    if (fid) stripByFixtureId.set(fid, light);
  }

  const cells: EffectCell[] = [];
  for (const id of fixtureIds) {
    const fixture = byId.get(id);
    if (!fixture) continue;

    const strip = stripByFixtureId.get(id);
    if (strip?.dmxMirror?.zones) {
      cells.push(...zoneCells(fixture.id, strip));
      continue;
    }
    const simple = simpleCell(fixture);
    if (simple) cells.push(simple);
  }
  return cells;
}

/** Cellule unique d'un projecteur classique : un canal par capability reconnue.
 *  Renvoie null si le projecteur n'expose aucun attribut modulable — un effet n'a
 *  rien a y faire, et le compter fausserait la repartition de phase. */
function simpleCell(fixture: Fixture): EffectCell | null {
  const channels: Partial<Record<EffectAttribute, number>> = {};
  for (const ch of fixture.channels) {
    const attr = CAPABILITY_TO_ATTRIBUTE[ch.capability];
    // Premier canal gagnant : un projecteur qui declare deux fois la meme
    // capability (rare, mais les profils QXF le font) garde le premier.
    if (attr && channels[attr] === undefined) {
      channels[attr] = fixture.address + ch.channel - 1;
    }
  }
  if (Object.keys(channels).length === 0) return null;
  return { fixtureId: fixture.id, cellIndex: 0, channels };
}

/** Cellules d'un bandeau expose en facade DMX : une par zone, 3 canaux R/G/B.
 *
 *  Pas de canal `dimmer` par cellule, et c'est deliberé : le dimmer master de la
 *  facade est UN canal pour tout le bandeau, pas un par zone. Une ligne "dimmer"
 *  d'effet tombera donc sur une cellule sans canal d'intensite, et le runner la
 *  traduira en fondu de couleur — ce qui est le comportement voulu sur un ruban RGB.
 */
function zoneCells(fixtureId: string, strip: SmartLight): EffectCell[] {
  const cfg = strip.dmxMirror!.zones!;
  const layout = strip.zoneLayout;
  const spare = new Set(layout?.spareZones ?? []);
  const cells: EffectCell[] = [];

  for (let i = 0; i < cfg.zoneCount; i++) {
    // Zones spare (LED non cablee) : presentes dans le protocole, absentes du mur.
    // Les exclure ici plutot que de les eteindre a la fin evite qu'elles occupent
    // une tranche de phase pour rien.
    if (spare.has(i)) continue;
    const base = cfg.startChannel + i * 3;
    const seg = layout?.segments[i];
    cells.push({
      fixtureId,
      cellIndex: i,
      channels: { red: base, green: base + 1, blue: base + 2 },
      position: seg ? midpoint(seg.start, seg.end) : undefined,
      side: sideOfZone(layout, i)
    });
  }
  return cells;
}

/** Milieu d'un segment de zone — le point qui represente la zone dans l'espace. */
function midpoint(a: Point3D, b: Point3D): Point3D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/** Section nommee (`sides`) contenant la zone d'index donne, si le layout en declare. */
function sideOfZone(layout: SmartLightZoneLayout | null | undefined, index: number): string | undefined {
  if (!layout?.sides) return undefined;
  for (const side of layout.sides) {
    if (index >= side.zoneStart && index <= side.zoneEnd) return side.label;
  }
  return undefined;
}
