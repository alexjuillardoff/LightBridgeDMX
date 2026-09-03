// Tests du suivi d'auteur des ecritures DMX. C'est ce qui permet a un ecrivain
// periodique — le moteur d'effets, qui repeint son bloc 30 fois par seconde — de
// distinguer ses propres valeurs d'une commande venue du pupitre, et de rendre la
// main quand un fader, une scene ou un blackout lui passe dessus.
import { describe, expect, it } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import pino from "pino";
import { DmxService } from "./dmx";

// Le service n'attend qu'un logger : un pino muet suffit. Le cast evite d'exiger
// ici les extras que Fastify ajoute au sien (msgPrefix), dont rien ne se sert.
const silentLogger = pino({ level: "silent" }) as unknown as FastifyBaseLogger;
const service = () => new DmxService(silentLogger);
const EFFECT = "effect:strip";

describe("DmxService — auteur des ecritures", () => {
  it("reconnait un bloc entierement ecrit par le meme auteur", () => {
    const dmx = service();
    dmx.applyWrite({ address: 10, values: [1, 2, 3] }, EFFECT);
    expect(dmx.isBlockOwnedBy(10, 3, EFFECT)).toBe(true);
    expect(dmx.isBlockOwnedBy(10, 3, "effect:autre")).toBe(false);
  });

  it("un seul canal repris par quelqu'un d'autre suffit a perdre le bloc", () => {
    const dmx = service();
    dmx.applyWrite({ address: 10, values: [1, 2, 3] }, EFFECT);
    dmx.setChannel(11, 255); // un fader du pupitre, sans signature
    expect(dmx.isBlockOwnedBy(10, 3, EFFECT)).toBe(false);
  });

  it("detecte une ecriture etrangere posterieure a la notre", () => {
    const dmx = service();
    dmx.applyWrite({ address: 10, values: [1, 2, 3] }, EFFECT);
    const seq = dmx.writeSequence();
    expect(dmx.hasForeignWriteSince(10, 3, EFFECT, seq)).toBe(false);

    dmx.setChannel(12, 0); // « all out » sur un canal du bloc
    expect(dmx.hasForeignWriteSince(10, 3, EFFECT, seq)).toBe(true);
  });

  it("nos propres trames suivantes ne comptent pas comme etrangeres", () => {
    const dmx = service();
    dmx.applyWrite({ address: 10, values: [1, 2, 3] }, EFFECT);
    let seq = dmx.writeSequence();
    for (let i = 0; i < 5; i++) {
      dmx.applyWrite({ address: 10, values: [i, i, i] }, EFFECT);
      expect(dmx.hasForeignWriteSince(10, 3, EFFECT, seq)).toBe(false);
      seq = dmx.writeSequence();
    }
  });

  it("une ecriture etrangere hors du bloc surveille est ignoree", () => {
    const dmx = service();
    dmx.applyWrite({ address: 10, values: [1, 2, 3] }, EFFECT);
    const seq = dmx.writeSequence();
    dmx.setChannel(20, 255);
    expect(dmx.hasForeignWriteSince(10, 3, EFFECT, seq)).toBe(false);
  });

  it("une ecriture etrangere ANTERIEURE a la notre ne compte pas : on l'a recouverte", () => {
    const dmx = service();
    dmx.setChannel(11, 255);
    dmx.applyWrite({ address: 10, values: [1, 2, 3] }, EFFECT);
    expect(dmx.hasForeignWriteSince(10, 3, EFFECT, dmx.writeSequence())).toBe(false);
  });
});
