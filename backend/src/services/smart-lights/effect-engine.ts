// Moteur d'effets (EffectEngine) des lampes connectees (smart lights).
// Role : a chaque tick du flux (streaming UDP), calculer la couleur RGB de
// chaque zone d'un bandeau LED (strip) en fonction de l'effet choisi et du temps.
// C'est de la math pure, sans effet de bord : le SmartLightService l'appelle a
// ~30 Hz puis envoie le resultat a la lampe. Les helpers vectoriels en bas du
// fichier servent aux effets sensibles a la position (position-aware).
// L'effet "ma" est le moteur parametrique facon grandMA2 (forme + phase repartie
// + MAtricks) : voir les helpers de la section "effets facon grandMA2" en bas.

import type {
  EffectMa,
  EffectMatricks,
  EffectSpatial,
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

    // ma : effet parametrique facon grandMA2. Une forme d'onde periodique est
    // evaluee par zone, decalee dans le temps par la phase repartie le long du
    // bandeau (c'est la phase, pas la forme, qui fait le chenillard ou la vague),
    // remise a l'echelle entre low et high, puis appliquee a la cible choisie
    // (intensite, fondu de couleurs, ou teinte).
    case "ma": {
      const bri = (effect.brightness ?? 100) / 100;

      // Rang de chaque zone parmi les zones ACTIVES (les spare ne comptent pas).
      // Sans cela, un bandeau de 38 LED declare sur 50 zones tasserait tout le
      // motif sur ses trois quarts avant, avec un trou fixe au bout.
      const rank = new Array<number>(zoneCount).fill(0);
      let activeCount = 0;
      for (let i = 0; i < zoneCount; i++) {
        if (spare.has(i)) continue;
        rank[i] = activeCount;
        activeCount++;
      }
      const n = Math.max(1, activeCount);

      // Avance temporelle en cycles : la vitesse est en BPM (60 BPM = 1 cycle/s).
      const dir = effect.direction === "backward" ? -1 : 1;
      const advance = (effect.speed / 60) * timeSeconds * dir;
      const phaseSpan = effect.phaseTo - effect.phaseFrom;

      // Distribution spatiale : la phase suit la position 3D des zones dans la piece
      // au lieu de leur rang sur le ruban. Calculee une fois pour toute la trame,
      // car elle demande de connaitre l'etendue (min/max) de toutes les zones actives.
      const spatialU = effect.spatial
        ? spatialPositions(layout, effect.spatial, spare, effect.matricks?.groups ?? 1)
        : null;

      for (let i = 0; i < zoneCount; i++) {
        // Position 0..1 de la zone dans la distribution de phase.
        const u = spatialU ? spatialU[i] : matricksPosition(rank[i], n, effect.matricks);
        const phaseDeg = effect.phaseFrom + phaseSpan * u;
        // La phase est un RETARD (comme sur le pupitre) : on la soustrait, ce qui
        // fait progresser l'effet de la premiere zone vers la derniere.
        const pos = advance - phaseDeg / 360;
        const v = formValue(effect, pos, rank[i]);
        // Remise a l'echelle low..high (low > high est permis : la forme s'inverse).
        const k = (effect.low + (effect.high - effect.low) * v) / 100;
        out[i] = scale(colorForTarget(effect, k), bri);
      }
      return finalize();
    }
  }
}

// ----- effets facon grandMA2 -----

/**
 * Valeur 0..1 de la forme d'onde a la position `pos` (en cycles, partie entiere =
 * numero de cycle, partie fractionnaire = avancement dans le cycle).
 * `zoneRank` ne sert qu'aux formes aleatoires, pour que chaque zone ait son
 * propre tirage tout en restant reproductible d'une trame a l'autre.
 */
function formValue(effect: EffectMa, pos: number, zoneRank: number): number {
  const cycle = Math.floor(pos);
  const x = pos - cycle; // avancement dans le cycle, toujours dans [0,1[

  switch (effect.form) {
    case "sin":
      return (Math.sin(2 * Math.PI * x) + 1) / 2;
    case "cos":
      return (Math.cos(2 * Math.PI * x) + 1) / 2;
    case "rampUp":
      return x;
    case "rampDown":
      return 1 - x;
    case "triangle":
      return 1 - Math.abs(2 * x - 1);
    case "pwm": {
      // Creneau : haut pendant `width` % du cycle. Attack/Decay adoucissent les fronts.
      const duty = Math.max(0.01, effect.width / 100);
      return x < duty ? envelope(x / duty, effect) : 0;
    }
    case "random": {
      // Un niveau tire par zone ET par cycle : il tient tout le cycle, puis change.
      // Le tirage depend du numero de cycle, donc il est identique sur deux trames
      // du meme cycle — indispensable, le moteur etant sans etat.
      const level = hash01(zoneRank, cycle, effect.seed ?? 1);
      const duty = Math.max(0.01, effect.width / 100);
      return x < duty ? level * envelope(x / duty, effect) : 0;
    }
  }
}

/** Enveloppe Attack/Decay appliquee a la portion haute d'une forme a fronts durs.
 *  `u` est l'avancement 0..1 DANS cette portion. attack/decay valent 0..100 % de
 *  cette portion : 0 = front franc, 100 = fondu sur toute la duree. */
function envelope(u: number, effect: EffectMa): number {
  const attack = (effect.attack ?? 0) / 100;
  const decay = (effect.decay ?? 0) / 100;
  let e = 1;
  if (attack > 0) e = Math.min(e, u / attack);
  if (decay > 0) e = Math.min(e, (1 - u) / decay);
  return Math.max(0, Math.min(1, e));
}

/**
 * Position 0..1 de CHAQUE zone d'apres sa place reelle dans la piece (layout 3D).
 * On mesure un scalaire par zone — projection sur un axe, ou distance a un point —
 * puis on ramene l'ensemble dans 0..1 par rapport a l'etendue mesuree. Deux zones
 * eloignees sur le ruban mais voisines dans la piece obtiennent donc la meme phase.
 *
 * Les zones spare sont exclues de la mesure de l'etendue (elles sont rangees dans un
 * coin fictif du layout et fausseraient min/max), et recoivent 0 : elles sont de toute
 * facon forcees en noir a la fin de l'evaluation.
 *
 * `groups` repete le motif N fois sur l'etendue, comme en distribution par rang.
 */
function spatialPositions(
  layout: SmartLightZoneLayout,
  spatial: EffectSpatial,
  spare: Set<number>,
  groups: number
): number[] {
  const zoneCount = layout.segments.length;
  const scalars = new Array<number>(zoneCount).fill(0);
  let min = Infinity;
  let max = -Infinity;

  const axis = normalize(spatial.direction ?? { x: 1, y: 0, z: 0 });
  const origin = spatial.origin ?? { x: 0, y: 0, z: 0 };

  for (let i = 0; i < zoneCount; i++) {
    if (spare.has(i)) continue;
    const m = midpoint(layout.segments[i]);
    const value =
      spatial.mode === "radial"
        ? Math.hypot(m.x - origin.x, m.y - origin.y, m.z - origin.z)
        : dot(m, axis);
    scalars[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  // Garde-fou : layout degenere (toutes les zones au meme endroit, ou que des spare).
  const span = Math.max(max - min, 1e-6);
  const reps = Math.max(1, Math.floor(groups));
  const out = new Array<number>(zoneCount).fill(0);
  for (let i = 0; i < zoneCount; i++) {
    if (spare.has(i)) continue;
    const u = ((scalars[i] - min) / span) * reps;
    // Sans repetition, on garde la valeur telle quelle : la zone la plus eloignee
    // doit atteindre 1 (et donc phaseTo), pas repartir a 0. Avec repetition, le
    // modulo est justement ce qui recree le motif a chaque tour.
    out[i] = reps === 1 ? u : u - Math.floor(u);
  }
  return out;
}

/** Position 0..1 d'une zone dans la distribution de phase, MAtricks appliques.
 *  Ordre : wings (pliage miroir) -> blocks (zones solidaires) -> groups (repetitions).
 *  `rank` est le rang de la zone parmi les zones actives, `n` leur nombre. */
function matricksPosition(rank: number, n: number, m: EffectMatricks | undefined): number {
  const wings = Math.max(1, Math.floor(m?.wings ?? 1));
  const blocks = Math.max(1, Math.floor(m?.blocks ?? 1));
  const groups = Math.max(1, Math.floor(m?.groups ?? 1));

  // Wings : on plie le bandeau en N ailes, une sur deux etant lue a l'envers.
  const wingLen = Math.max(1, Math.ceil(n / wings));
  const wingIndex = Math.floor(rank / wingLen);
  let k = rank % wingLen;
  if (wingIndex % 2 === 1) k = wingLen - 1 - k;

  // Blocks : N zones consecutives partagent la meme phase.
  const blockIndex = Math.floor(k / blocks);
  const blockCount = Math.max(1, Math.ceil(wingLen / blocks));

  // Groups : le motif complet se repete N fois sur la longueur de l'aile.
  const u = (blockIndex * groups) / blockCount;
  return u - Math.floor(u);
}

/** Traduit la valeur 0..1 de la forme en couleur, selon la cible de l'effet. */
function colorForTarget(effect: EffectMa, k: number): RgbColor {
  const t = Math.max(0, Math.min(1, k));
  switch (effect.target) {
    case "dimmer":
      return lerpRgb(effect.bgColor ?? { r: 0, g: 0, b: 0 }, effect.color ?? { r: 255, g: 255, b: 255 }, t);
    case "color":
      return lerpRgb(effect.color ?? { r: 0, g: 0, b: 0 }, effect.colorTo ?? { r: 255, g: 255, b: 255 }, t);
    case "hue": {
      const from = effect.hueFrom ?? 0;
      const to = effect.hueTo ?? 360;
      return hsvToRgb(from + (to - from) * t, effect.saturation ?? 100, 100);
    }
  }
}

/** Generateur pseudo-aleatoire deterministe : memes entrees -> meme sortie 0..1.
 *  Le moteur etant appele a 30 Hz sans etat, un Math.random() ferait clignoter
 *  n'importe quoi a chaque trame ; ici le tirage ne change qu'au cycle suivant. */
function hash01(a: number, b: number, seed: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 2246822519)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** HSV -> RGB. h en degres (non borne : on ramene dans 0..360), s et v en %. */
function hsvToRgb(h: number, s: number, v: number): RgbColor {
  const hh = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s / 100));
  const val = Math.max(0, Math.min(1, v / 100));
  const c = val * sat;
  const xx = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = val - c;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = xx; }
  else if (hh < 120) { r = xx; g = c; }
  else if (hh < 180) { g = c; b = xx; }
  else if (hh < 240) { g = xx; b = c; }
  else if (hh < 300) { r = xx; b = c; }
  else { r = c; b = xx; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
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
