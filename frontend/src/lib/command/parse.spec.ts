// Tests du parseur de la ligne de commande (syntaxe MA3, §4.12).
import { describe, expect, it } from "vitest";
import { parseCommand, parseValue, tokenize } from "./parse";

const pct = (p: number) => Math.round((p / 100) * 255);

describe("parseCommand — sélection", () => {
  it("Fixture 1 Thru 3 développe la plage", () => {
    expect(parseCommand("Fixture 1 Thru 3")).toEqual({ kind: "select", fids: [1, 2, 3] });
  });

  it("combine Thru, + et -", () => {
    expect(parseCommand("fixture 1 thru 5 + 8 - 2")).toEqual({ kind: "select", fids: [1, 3, 4, 5, 8] });
  });

  it("« 1 Thru 3 » seul = Fixture par défaut", () => {
    expect(parseCommand("1 Thru 3")).toEqual({ kind: "select", fids: [1, 2, 3] });
  });

  it("un simple numéro sélectionne ce projecteur", () => {
    expect(parseCommand("4")).toEqual({ kind: "select", fids: [4] });
  });

  it("Fixture Thru sélectionne tout", () => {
    expect(parseCommand("Fixture Thru")).toEqual({ kind: "selectAll" });
  });

  it("Fixture Thru At 50 sélectionne tout puis pose le dimmer", () => {
    expect(parseCommand("Fixture Thru At 50")).toEqual({ kind: "selectAll", then: { attr: "dimmer", value: pct(50), fanTo: undefined } });
  });

  it("« 3 Thru » ouvert marque openEnd", () => {
    expect(parseCommand("Fixture 3 Thru")).toEqual({ kind: "select", fids: [3], openEnd: true });
  });

  it("Fixture 2 At 75 sélectionne puis pose (75 % = 191)", () => {
    expect(parseCommand("Fixture 2 At 75")).toEqual({
      kind: "select",
      fids: [2],
      then: { attr: "dimmer", value: 191, fanTo: undefined }
    });
  });

  it("Fixture 1 + 2 Red 100 pose un attribut après la sélection", () => {
    expect(parseCommand("Fixture 1 + 2 Red 100")).toEqual({
      kind: "select",
      fids: [1, 2],
      then: { attr: "red", value: 255, fanTo: undefined }
    });
  });

  it("est insensible à la casse et aux accents, raccourcis FR acceptés", () => {
    expect(parseCommand("PROJECTEUR 1 À 50")).toEqual({
      kind: "select",
      fids: [1],
      then: { attr: "dimmer", value: pct(50), fanTo: undefined }
    });
  });

  it("ignore « Please » en fin de ligne", () => {
    expect(parseCommand("Fixture 1 Please")).toEqual({ kind: "select", fids: [1] });
    expect(parseCommand("At 50 please")).toEqual({ kind: "attr", attr: "dimmer", value: pct(50), fanTo: undefined });
  });
});

describe("parseCommand — valeurs et attributs", () => {
  it("At 50 pose le dimmer en %", () => {
    expect(parseCommand("At 50")).toEqual({ kind: "attr", attr: "dimmer", value: pct(50), fanTo: undefined });
  });

  it("At 50 Thru 100 = fan", () => {
    expect(parseCommand("At 50 Thru 100")).toEqual({ kind: "attr", attr: "dimmer", value: pct(50), fanTo: 255 });
  });

  it("Full / Out / Half / At 0", () => {
    expect(parseCommand("Full")).toEqual({ kind: "attr", attr: "dimmer", value: 255 });
    expect(parseCommand("Out")).toEqual({ kind: "attr", attr: "dimmer", value: 0 });
    expect(parseCommand("Half")).toEqual({ kind: "attr", attr: "dimmer", value: 128 });
    expect(parseCommand("At 0")).toEqual({ kind: "attr", attr: "dimmer", value: 0, fanTo: undefined });
  });

  it("Pan At 50 / Tilt 25 / Color At 10", () => {
    expect(parseCommand("Pan At 50")).toEqual({ kind: "attr", attr: "pan", value: pct(50), fanTo: undefined });
    expect(parseCommand("Tilt 25")).toEqual({ kind: "attr", attr: "tilt", value: pct(25), fanTo: undefined });
    expect(parseCommand("Color At 10")).toEqual({ kind: "attr", attr: "colorWheel", value: pct(10), fanTo: undefined });
  });

  it("suffixe d / dmx = valeur brute 0-255", () => {
    expect(parseCommand("Pan 51d")).toEqual({ kind: "attr", attr: "pan", value: 51, fanTo: undefined });
    expect(parseCommand("Red At 200dmx")).toEqual({ kind: "attr", attr: "red", value: 200, fanTo: undefined });
  });

  it("Attribute \"Pan\" At 50 (forme longue)", () => {
    expect(parseCommand('Attribute "Pan" At 50')).toEqual({ kind: "attr", attr: "pan", value: pct(50), fanTo: undefined });
  });

  it("raccourcis FR des attributs : Rouge, Vert, Bleu, Blanc", () => {
    expect(parseCommand("Rouge 100")).toMatchObject({ kind: "attr", attr: "red", value: 255 });
    expect(parseCommand("vert at 0")).toMatchObject({ kind: "attr", attr: "green", value: 0 });
    expect(parseCommand("Bleu 50")).toMatchObject({ kind: "attr", attr: "blue", value: pct(50) });
    expect(parseCommand("blanc full")).toMatchObject({ kind: "attr", attr: "white", value: 255 });
  });

  it("parseValue borne et convertit", () => {
    expect(parseValue("150")).toBe(255);
    expect(parseValue("300d")).toBe(255);
    expect(parseValue("12.5")).toBe(32);
    expect(parseValue("abc")).toBeNull();
    expect(parseValue("100%")).toBe(255);
  });
});

describe("parseCommand — canaux DMX", () => {
  it("Dmx 12 Thru 20 At 50", () => {
    expect(parseCommand("Dmx 12 Thru 20 At 50")).toEqual({
      kind: "channel",
      channels: [12, 13, 14, 15, 16, 17, 18, 19, 20],
      value: pct(50)
    });
  });

  it("Channel 12 At 50 et Ch 12 + 14 At Full", () => {
    expect(parseCommand("Channel 12 At 50")).toEqual({ kind: "channel", channels: [12], value: pct(50) });
    expect(parseCommand("Ch 12 + 14 At Full")).toEqual({ kind: "channel", channels: [12, 14], value: 255 });
  });

  it("refuse un canal hors univers", () => {
    expect(parseCommand("Dmx 600 At 50")).toMatchObject({ kind: "error" });
  });
});

describe("parseCommand — Clear, groupes, presets", () => {
  it("Clear / ClearAll / Clear All", () => {
    expect(parseCommand("Clear")).toEqual({ kind: "clear" });
    expect(parseCommand("ClearAll")).toEqual({ kind: "clearAll" });
    expect(parseCommand("clear all")).toEqual({ kind: "clearAll" });
  });

  it("Group 2 / Store Group 2 \"Salon\" / Delete / Label", () => {
    expect(parseCommand("Group 2")).toEqual({ kind: "group", slot: 2 });
    expect(parseCommand('Store Group 2 "Salon"')).toEqual({ kind: "storeGroup", slot: 2, name: "Salon" });
    expect(parseCommand("Store Group 3")).toEqual({ kind: "storeGroup", slot: 3, name: undefined });
    expect(parseCommand("Delete Group 2")).toEqual({ kind: "deleteGroup", slot: 2 });
    expect(parseCommand('Label Group 2 "Nom"')).toEqual({ kind: "labelGroup", slot: 2, name: "Nom" });
  });

  it("Preset 4.1 = pool Color (4), slot 1 ; Preset 1 = pool All", () => {
    expect(parseCommand("Preset 4.1")).toEqual({ kind: "preset", pool: "color", slot: 1 });
    expect(parseCommand("Preset 1")).toEqual({ kind: "preset", pool: "all", slot: 1 });
    expect(parseCommand("Preset 2.3")).toEqual({ kind: "preset", pool: "position", slot: 3 });
  });

  it("Store Preset 4.1 \"Bleu\" / Delete Preset 4.1 / pool par nom", () => {
    expect(parseCommand('Store Preset 4.1 "Bleu"')).toEqual({ kind: "storePreset", pool: "color", slot: 1, name: "Bleu" });
    expect(parseCommand("Delete Preset 4.1")).toEqual({ kind: "deletePreset", pool: "color", slot: 1 });
    expect(parseCommand("Preset Color 2")).toEqual({ kind: "preset", pool: "color", slot: 2 });
  });

  it("refuse un pool inconnu", () => {
    expect(parseCommand("Preset 9.1")).toMatchObject({ kind: "error" });
  });
});

describe("parseCommand — executors et playback", () => {
  it("Store Sequence 1 \"Look\" / Store Executor 1 / Store 1", () => {
    expect(parseCommand('Store Sequence 1 "Look"')).toEqual({ kind: "storeExecutor", slot: 1, name: "Look" });
    expect(parseCommand("Store Executor 1")).toEqual({ kind: "storeExecutor", slot: 1, name: undefined });
    expect(parseCommand("Store 1")).toEqual({ kind: "storeExecutor", slot: 1, name: undefined });
    expect(parseCommand("Store 2 Ambiance douce")).toEqual({ kind: "storeExecutor", slot: 2, name: "Ambiance douce" });
  });

  it("Go Sequence 1 / Go+ 1 / Go 3", () => {
    expect(parseCommand("Go Sequence 1")).toEqual({ kind: "go", slot: 1 });
    expect(parseCommand("Go+ 1")).toEqual({ kind: "go", slot: 1 });
    expect(parseCommand("go 3")).toEqual({ kind: "go", slot: 3 });
  });

  it("Off Sequence 1 / Off 1 ; Off seul = dimmer à 0", () => {
    expect(parseCommand("Off Sequence 1")).toEqual({ kind: "off", slot: 1 });
    expect(parseCommand("Off 1")).toEqual({ kind: "off", slot: 1 });
    expect(parseCommand("Off")).toEqual({ kind: "attr", attr: "dimmer", value: 0 });
  });

  it("Delete Sequence 1 / Label Sequence 1 \"Nom\"", () => {
    expect(parseCommand("Delete Sequence 1")).toEqual({ kind: "deleteExecutor", slot: 1 });
    expect(parseCommand('Label Sequence 1 "Nom"')).toEqual({ kind: "labelExecutor", slot: 1, name: "Nom" });
    expect(parseCommand("Label Sequence 1")).toMatchObject({ kind: "error" });
  });

  it("Executor 3 At 50 règle le niveau (0..1)", () => {
    const cmd = parseCommand("Executor 3 At 50");
    expect(cmd.kind).toBe("executorLevel");
    if (cmd.kind === "executorLevel") {
      expect(cmd.slot).toBe(3);
      expect(cmd.level).toBeCloseTo(0.5, 2);
    }
  });

  it("Phaser Off / Off Phaser", () => {
    expect(parseCommand("Phaser Off")).toEqual({ kind: "phaserOff" });
    expect(parseCommand("Off Phaser")).toEqual({ kind: "phaserOff" });
  });

  it("Blackout / Blackout Off", () => {
    expect(parseCommand("Blackout")).toEqual({ kind: "blackout", on: true });
    expect(parseCommand("Blackout Off")).toEqual({ kind: "blackout", on: false });
  });

  it("View 2 / Store View 3 \"Nom\" (index 0-basé)", () => {
    expect(parseCommand("View 2")).toEqual({ kind: "view", index: 1 });
    expect(parseCommand('Store View 3 "Nom"')).toEqual({ kind: "storeView", index: 2, name: "Nom" });
  });

  it("Highlight / Help", () => {
    expect(parseCommand("Highlight")).toEqual({ kind: "highlight" });
    expect(parseCommand("Help")).toEqual({ kind: "help" });
    expect(parseCommand("aide")).toEqual({ kind: "help" });
  });
});

describe("parseCommand — erreurs", () => {
  it("commande vide", () => {
    expect(parseCommand("   ")).toMatchObject({ kind: "error" });
  });

  it("Fixture sans numéro", () => {
    expect(parseCommand("Fixture")).toMatchObject({ kind: "error" });
  });

  it("At sans valeur", () => {
    expect(parseCommand("At")).toMatchObject({ kind: "error" });
    expect(parseCommand("At abc")).toMatchObject({ kind: "error" });
  });

  it("mot-clé inconnu", () => {
    const cmd = parseCommand("Foo 1");
    expect(cmd.kind).toBe("error");
    if (cmd.kind === "error") expect(cmd.message).toContain("Foo");
  });

  it("jeton inattendu après une sélection", () => {
    expect(parseCommand("Fixture 1 Thru 3 Foo")).toMatchObject({ kind: "error" });
  });

  it("Preset / Group / Go sans numéro", () => {
    expect(parseCommand("Preset")).toMatchObject({ kind: "error" });
    expect(parseCommand("Group")).toMatchObject({ kind: "error" });
    expect(parseCommand("Go")).toMatchObject({ kind: "error" });
  });
});

describe("tokenize", () => {
  it("isole les opérateurs et conserve les chaînes entre guillemets", () => {
    expect(tokenize('store 1 "Mon look" please').map((t) => t.raw)).toEqual(["store", "1", "Mon look"]);
    expect(tokenize("1+2-3").map((t) => t.raw)).toEqual(["1", "+", "2", "-", "3"]);
  });
});
