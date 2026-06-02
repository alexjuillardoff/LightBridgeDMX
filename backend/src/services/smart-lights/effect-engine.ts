// Moteur d'effets (EffectEngine) des lampes connectees (smart lights).
// Role : a chaque tick du flux (streaming UDP), calculer la couleur RGB de
// chaque zone d'un bandeau LED (strip) en fonction de l'effet choisi et du temps.
// C'est de la math pure, sans effet de bord : le SmartLightService l'appelle a
// ~30 Hz puis envoie le resultat a la lampe. Les helpers vectoriels en bas du
// fichier servent aux effets sensibles a la position (position-aware).

import type {
  Point3D,
  RgbColor,
  SmartLightEffectConfig,
  SmartLightZoneLayout
} from "@lightbridgedmx/shared";

type ZoneSegment = SmartLightZoneLayout["segments"][number];

// Une trame (frame) RGB : une couleur par zone du bandeau, dans l'ordre des zones.
export type RgbFrame = RgbColor[];

/**
 * Fonction pure : a partir de (config d'effet, disposition des zones, temps courant),
 * renvoie une couleur RGB par zone. Appelee toutes les ~33 ms par la boucle de
 * streaming du SmartLightService.
 *
 * Tous les effets respectent le champ optionnel `brightness` de chaque type d'effet
 * comme multiplicateur global d'intensite (0 a 100 %).
 *
 * Les effets sensibles a la position (gradient, wave) utilisent le milieu de chaque
 * segment de zone, projete sur le vecteur de direction 3D configure. La direction
 * est normalisee automatiquement.
 */
export function evaluateEffect(
  effect: SmartLightEffectConfig,
  layout: SmartLightZoneLayout,
  timeSeconds: number
): RgbFrame {
  const zoneCount = layout.segments.length;
  // Zones spare (LED non cablee) : presentes dans le protocole mais sans LED
  // physique. On les memorise pour les forcer en noir a la toute fin.
  const spare = new Set(layout.spareZones ?? []);
  const out: RgbFrame = new Array(zoneCount);

  const BLACK: RgbColor = { r: 0, g: 0, b: 0 };
  // finalize() : a appeler avant chaque return d'effet. Eteint les zones spare
  // pour qu'aucune couleur d'effet ne les "traverse".
  const finalize = (): RgbFrame => {
    for (const idx of spare) {
      if (idx >= 0 && idx < zoneCount) out[idx] = BLACK;
    }
    return out;
  };

  // Chaque branche calcule la trame pour un type d'effet. Les ids d'effets
  // (static, solid, gradient, chase, wave) restent en anglais (cles du schema Zod).
  switch (effect.kind) {
    // static : chaque zone prend sa couleur fixe depuis la palette. Une zone
    // sans couleur dans la palette reste noire.
    case "static": {
      const bri = (effect.brightness ?? 100) / 100;
      for (let i = 0; i < zoneCount; i++) {
        const c = effect.palette[i];
        out[i] = c ? scale(c, bri) : { r: 0, g: 0, b: 0 };
      }
      return finalize();
    }

    // solid : une seule couleur sur toutes les zones.
    case "solid": {
      const c = scale(effect.color, (effect.brightness ?? 100) / 100);
      for (let i = 0; i < zoneCount; i++) out[i] = c;
      return finalize();
    }

    // gradient : degrade (from -> to) le long d'un axe 3D, qui peut defiler.
    case "gradient": {
      const dir = normalize(effect.direction ?? { x: 1, y: 0, z: 0 });
      const bri = (effect.brightness ?? 100) / 100;
      // Decalage qui fait glisser le degrade dans le temps (scrollSpeed).
      const scrollOffset = (effect.scrollSpeed ?? 0) * timeSeconds;

      // On projette le milieu de chaque zone sur la direction, et on note le
      // min/max pour ensuite ramener ces projections dans la plage 0..1.
      const projections = new Array(zoneCount);
      let pmin = Infinity, pmax = -Infinity;
      for (let i = 0; i < zoneCount; i++) {
        const m = midpoint(layout.segments[i]);
        const p = dot(m, dir);
        projections[i] = p;
        if (p < pmin) pmin = p;
        if (p > pmax) pmax = p;
      }
      // Garde-fou : evite une division par zero si toutes les zones se projettent
      // au meme endroit (span minuscule).
      const span = Math.max(pmax - pmin, 1e-6);

      for (let i = 0; i < zoneCount; i++) {
        // Position normalisee 0..1 le long de l'axe, plus le defilement, ramenee
        // dans [0,1[ par modulo (le +1 corrige un eventuel resultat negatif).
        const t = ((projections[i] - pmin) / span + scrollOffset) % 1;
        const tt = t < 0 ? t + 1 : t;
        out[i] = scale(lerpRgb(effect.from, effect.to, tt), bri);
      }
      return finalize();
    }

    // chase : une "tete" coloree (chenillard) se deplace de zone en zone sur un
    // fond. La position avance avec le temps ; bounce la fait faire des allers-retours.
    case "chase": {
      const bri = (effect.brightness ?? 100) / 100;
      const head = effect.color;
      const bg = effect.bgColor ?? { r: 0, g: 0, b: 0 };
      const width = Math.max(1, effect.width);
      // Periode = zones + largeur, pour que la tete sorte completement d'un cote
      // avant de reapparaitre de l'autre (boucle sans saut visible).
      const period = zoneCount + width;
      let pos = (effect.speed * timeSeconds) % period;
      if (pos < 0) pos += period;

      if (effect.bounce) {
        // Onde triangulaire : la position fait 0..zoneCount..0 au lieu de boucler.
        const dbl = pos * 2;
        const triPeriod = zoneCount * 2;
        pos = dbl % triPeriod;
        if (pos > zoneCount) pos = triPeriod - pos;
      }

      for (let i = 0; i < zoneCount; i++) {
        const d = Math.abs(i - pos);
        if (d < width / 2) {
          // Attenuation (falloff) lineaire vers les bords de la tete : plus on
          // s'eloigne du centre, plus on tend vers la couleur de fond.
          const k = 1 - (d / (width / 2));
          out[i] = scale(lerpRgb(bg, head, k), bri);
        } else {
          out[i] = scale(bg, bri);
        }
      }
      return finalize();
    }

    // wave : onde (wave) sinusoidale coloree qui se propage le long d'un axe 3D.
    // Chaque zone oscille entre les couleurs from et to selon sa phase.
    case "wave": {
      const dir = normalize(effect.direction ?? { x: 1, y: 0, z: 0 });
      const bri = (effect.brightness ?? 100) / 100;
      const wl = Math.max(0.01, effect.wavelength);
      const speed = effect.speed;

      for (let i = 0; i < zoneCount; i++) {
        const m = midpoint(layout.segments[i]);
        const p = dot(m, dir);
        // Phase = position le long de l'axe (en longueurs d'onde) + avance temporelle.
        const phase = (p / wl + speed * timeSeconds) * 2 * Math.PI;
        // sin va de -1 a 1 ; on le ramene a 0..1 pour s'en servir comme melange.
        const t = (Math.sin(phase) + 1) / 2;
        out[i] = scale(lerpRgb(effect.from, effect.to, t), bri);
      }
      return finalize();
    }
  }
}


/** Re-export depuis shared pour que les appelants importent le moteur et les
 * constructeurs de disposition (layout) depuis un seul et meme endroit. */
export { buildLinearLayout as defaultLinearLayout, buildUShapeLayout } from "@lightbridgedmx/shared";

// ----- helpers vectoriels -----

// Renvoie le point milieu d'un segment de zone (moyenne des extremites start/end).
function midpoint(seg: ZoneSegment): Point3D {
  return {
    x: (seg.start.x + seg.end.x) / 2,
    y: (seg.start.y + seg.end.y) / 2,
    z: (seg.start.z + seg.end.z) / 2
  };
}

// Normalise un vecteur (longueur ramenee a 1) pour ne garder que sa direction.
// Si le vecteur est quasi nul, on retombe sur l'axe X par defaut pour eviter
// une division par zero.
function normalize(p: Point3D): Point3D {
  const len = Math.hypot(p.x, p.y, p.z);
  if (len < 1e-9) return { x: 1, y: 0, z: 0 };
  return { x: p.x / len, y: p.y / len, z: p.z / len };
}

// Produit scalaire : projette a sur b. Sert a mesurer ou se situe une zone le
// long de l'axe de direction d'un effet.
function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// Interpolation lineaire (lerp) entre deux couleurs RGB selon t (0 = a, 1 = b).
function lerpRgb(a: RgbColor, b: RgbColor, t: number): RgbColor {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t)
  };
}

// Multiplie une couleur par un facteur k (ex. l'intensite globale) et borne
// (clamp) chaque composante dans 0..255 pour rester dans la plage RGB valide.
function scale(c: RgbColor, k: number): RgbColor {
  return {
    r: Math.max(0, Math.min(255, Math.round(c.r * k))),
    g: Math.max(0, Math.min(255, Math.round(c.g * k))),
    b: Math.max(0, Math.min(255, Math.round(c.b * k)))
  };
}
