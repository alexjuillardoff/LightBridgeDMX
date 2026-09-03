// Tests Vitest des utilitaires HomeKit (homekit-utils).
// Verifie deux choses : les conversions de couleur HSB <-> RGB, et la resolution
// des canaux RGB d'un projecteur (par capability ou via la config explicite),
// ainsi que le tri des projecteurs exposables en ampoules HomeKit.
import { describe, expect, it } from "vitest";
import { Fixture, SmartLight } from "@lightbridgedmx/shared";
import {
  collectHomeKitChannelFixtures,
  collectHomeKitLights,
  collectHomeKitSmartLights,
  findFacadeFixture,
  hapName,
  hsbToRgb,
  resolveRgbChannels,
  rgbToHsb
} from "./homekit-utils";

// Projecteur de reference reutilise dans plusieurs tests : un RGB simple a
// l'adresse 1, avec ses trois canaux r/g/b sur les slots 1, 2 et 3.
const baseFixture: Fixture = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "RGB Fixture",
  address: 1,
  universe: 0,
  createdAt: "2024-01-01T00:00:00.000Z",
  channels: [
    { channel: 1, capability: "r" },
    { channel: 2, capability: "g" },
    { channel: 3, capability: "b" }
  ]
};

// ----- Conversions de couleur HSB <-> RGB -----
describe("color conversion", () => {
  // Les trois primaires HSB (rouge 0deg, vert 120deg, bleu 240deg) a saturation
  // et luminosite max doivent donner exactement leurs equivalents RGB purs.
  it("converts HSB primaries to RGB", () => {
    expect(hsbToRgb({ hue: 0, saturation: 100, brightness: 100 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsbToRgb({ hue: 120, saturation: 100, brightness: 100 })).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsbToRgb({ hue: 240, saturation: 100, brightness: 100 })).toEqual({ r: 0, g: 0, b: 255 });
  });

  // Sens inverse : on extrait le HSB d'une couleur RGB. Le blanc pur a une
  // saturation nulle. Pour une couleur mixte, on verifie l'aller-retour
  // (RGB -> HSB -> RGB) en gardant l'ordre des composantes (bleu dominant).
  it("extracts HSB from RGB", () => {
    expect(rgbToHsb({ r: 255, g: 0, b: 0 })).toEqual({ hue: 0, saturation: 100, brightness: 100 });
    expect(rgbToHsb({ r: 255, g: 255, b: 255 })).toEqual({ hue: 0, saturation: 0, brightness: 100 });
    const mixed = rgbToHsb({ r: 64, g: 128, b: 255 });
    const back = hsbToRgb(mixed);
    expect(back.r).toBeGreaterThan(50);
    expect(back.b).toBeGreaterThan(back.r);
  });
});

// ----- Resolution des canaux DMX d'un projecteur RGB -----
describe("DMX channel resolution", () => {
  // Sans config explicite, le mapping RGB est deduit des capabilities des canaux.
  // source: "capability" indique cette origine. Adresse 1 => canaux 1/2/3.
  it("infers RGB mapping from capabilities", () => {
    const mapping = resolveRgbChannels(baseFixture);
    expect(mapping).toEqual({ r: 1, g: 2, b: 3, universe: 0, source: "capability", address: 1 });
  });

  // Si la config HomeKit fournit des dmxChannels explicites, ils priment.
  // Ces offsets sont relatifs a l'adresse de depart : adresse 10 + offset 2/3/5
  // => canaux absolus 11/12/14. source: "config" marque cette priorite.
  it("uses explicit HomeKit dmxChannels when provided", () => {
    const fixture: Fixture = {
      ...baseFixture,
      address: 10,
      homekit: { dmxChannels: { r: 2, g: 3, b: 5 } }
    };
    const mapping = resolveRgbChannels(fixture);
    expect(mapping).toEqual({ r: 11, g: 12, b: 14, universe: 0, source: "config", address: 10 });
  });

  // Un projecteur sans canaux RGB (ici un simple variateur "intensity") ne peut
  // pas devenir une ampoule HomeKit : il doit etre ecarte et liste dans "skipped".
  it("skips fixtures that are not RGB-capable", () => {
    const fixtures: Fixture[] = [
      baseFixture,
      {
        ...baseFixture,
        id: "00000000-0000-0000-0000-000000000002",
        channels: [{ channel: 1, capability: "intensity" }]
      }
    ];
    const { lights, skipped } = collectHomeKitLights(fixtures);
    expect(lights).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ fixtureId: fixtures[1].id });
  });
});

// HAP n'accepte qu'alphanumerique, espace et apostrophe, et exige de commencer
// et finir par une lettre ou un chiffre. Un nom hors regles fait avertir
// hap-nodejs et peut rendre l'accessoire muet dans l'app Maison.
describe("hapName", () => {
  it("laisse intact un nom deja valide", () => {
    expect(hapName("Par 56 Lava")).toBe("Par 56 Lava");
    expect(hapName("L'entree")).toBe("L'entree");
  });

  it("remplace la ponctuation par des espaces et normalise", () => {
    // Cas reel de la bibliotheque QXF, qui declenchait l'avertissement HAP.
    expect(hapName("Showtec LED Par 56 (6 Channel)")).toBe("Showtec LED Par 56 6 Channel");
    expect(hapName("Stairville MH-X20 (11 Ch)")).toBe("Stairville MH X20 11 Ch");
  });

  it("retire les accents plutot que le caractere entier", () => {
    expect(hapName("Par 56 Café")).toBe("Par 56 Cafe");
    expect(hapName("Éclairage arrière")).toBe("Eclairage arriere");
  });

  it("force un debut et une fin alphanumeriques", () => {
    expect(hapName("  #1 Salon !!")).toBe("1 Salon");
  });

  it("ne renvoie jamais un nom vide", () => {
    expect(hapName("###")).toBe("Projecteur");
  });
});

// Une lampe connectee pilotee en DMX a deux faces : la lampe, et un projecteur
// bidon qui lui sert de prise en main depuis le pupitre. L'app Maison ne doit
// en voir qu'une — une ampoule normale, sous le nom du projecteur.
describe("facade DMX d'une lampe connectee", () => {
  const facade: Fixture = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Lampe Salon",
    address: 40,
    universe: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    channels: [
      { channel: 1, capability: "intensity" },
      { channel: 2, capability: "r" },
      { channel: 3, capability: "g" },
      { channel: 4, capability: "b" }
    ]
  };
  const light = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Nanoleaf A19 26N3",
    backend: "homekit-thread",
    config: { type: "homekit-thread", alias: "a19", deviceName: "Nanoleaf A19 26N3" },
    dmxMirror: { universe: 0, briChannel: 40, rChannel: 41, gChannel: 42, bChannel: 43 },
    createdAt: "2026-01-01T00:00:00.000Z"
  } as unknown as SmartLight;

  it("retrouve la facade depuis les canaux absolus du miroir", () => {
    expect(findFacadeFixture(light, [facade])?.id).toBe(facade.id);
  });

  it("ne confond pas deux univers", () => {
    const ailleurs = { ...facade, universe: 1 };
    expect(findFacadeFixture(light, [ailleurs])).toBeUndefined();
  });

  it("expose la lampe sous le nom du projecteur, pas celui de l'appareil", () => {
    const { exposed } = collectHomeKitSmartLights([light], [facade]);
    expect(exposed).toHaveLength(1);
    expect(exposed[0].name).toBe("Lampe Salon");
  });

  it("n'expose rien quand la case HomeKit du projecteur est decochee", () => {
    const off = { ...facade, homekit: { enabled: false } };
    const { exposed, skipped } = collectHomeKitSmartLights([light], [off]);
    expect(exposed).toHaveLength(0);
    expect(skipped[0].id).toBe(light.id);
  });

  it("sort la facade du flux canal-par-canal : jamais quatre ampoules DMX", () => {
    const { channelFixtures } = collectHomeKitChannelFixtures([facade], [light]);
    expect(channelFixtures).toHaveLength(0);
    // Sans la lampe, ce meme projecteur redevient un projecteur ordinaire.
    expect(collectHomeKitChannelFixtures([facade], []).channelFixtures).toHaveLength(1);
  });

  it("une lampe sans facade se represente elle-meme", () => {
    const orpheline = { ...light, dmxMirror: null } as unknown as SmartLight;
    const { exposed } = collectHomeKitSmartLights([orpheline], [facade]);
    expect(exposed[0].name).toBe("Nanoleaf A19 26N3");
  });
});
