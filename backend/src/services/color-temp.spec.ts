// Tests des conversions de temperature de couleur (packages/shared).
//
// Trois unites se croisent dans la chaine, et les confondre donne un reglage qui
// marche a l'envers sans jamais lever d'erreur :
//   - LightBridge et l'UI raisonnent en KELVIN (2127 chaud -> 6535 froid) ;
//   - HomeKit/HAP raisonne en MIRED, echelle INVERSE (153 froid -> 470 chaud) ;
//   - le pupitre envoie du DMX 0-255.
// D'ou ces tests : ils verrouillent le sens de chaque echelle.
import { describe, expect, it } from "vitest";
import {
  COLOR_TEMP_MAX_K,
  COLOR_TEMP_MIN_K,
  clampKelvin,
  dmxToKelvin,
  kelvinToDmx,
  kelvinToMired,
  miredToKelvin
} from "@lightbridgedmx/shared";

describe("temperature de couleur", () => {
  it("inverse l'echelle entre Kelvin et mired", () => {
    // Le NL45 declare 153..470 mired : les bornes doivent tomber dessus.
    expect(kelvinToMired(COLOR_TEMP_MAX_K)).toBe(153); // le plus FROID
    expect(kelvinToMired(COLOR_TEMP_MIN_K)).toBe(470); // le plus CHAUD
    // Plus de Kelvin = moins de mired. C'est l'inversion a ne pas rater.
    expect(kelvinToMired(6000)).toBeLessThan(kelvinToMired(3000));
  });

  it("fait l'aller-retour sans deriver", () => {
    for (const k of [2200, 2700, 3000, 4000, 5000, 6500]) {
      expect(Math.abs(miredToKelvin(kelvinToMired(k)) - k)).toBeLessThanOrEqual(20);
    }
  });

  it("mappe le DMX du plus chaud au plus froid", () => {
    expect(dmxToKelvin(0)).toBe(COLOR_TEMP_MIN_K);
    expect(dmxToKelvin(255)).toBe(COLOR_TEMP_MAX_K);
    // Milieu de course : entre les deux, et strictement croissant.
    expect(dmxToKelvin(128)).toBeGreaterThan(dmxToKelvin(127));
    expect(dmxToKelvin(128)).toBeLessThan(COLOR_TEMP_MAX_K);
  });

  it("boucle DMX -> Kelvin -> DMX", () => {
    for (const v of [0, 1, 64, 128, 200, 255]) {
      expect(Math.abs(kelvinToDmx(dmxToKelvin(v)) - v)).toBeLessThanOrEqual(1);
    }
  });

  it("ecrete hors bornes plutot que de produire une valeur inapplicable", () => {
    expect(clampKelvin(1000)).toBe(COLOR_TEMP_MIN_K);
    expect(clampKelvin(9000)).toBe(COLOR_TEMP_MAX_K);
    // Une valeur aberrante ne doit pas sortir de la plage acceptee par HAP.
    expect(kelvinToMired(50)).toBeLessThanOrEqual(470);
    expect(miredToKelvin(0)).toBe(COLOR_TEMP_MAX_K);
  });
});
