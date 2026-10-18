// Le writer avec un réseau simulé (fetch mocké) et des minuteurs factices :
// garde, écho local, regroupement 40 ms, marquage programmer, Grand Master.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../lib/test-fixtures";
import { appStore } from "./app";
import { flushNow, writeChannels, writerStats } from "./dmx-writer";
import { masterSnapshotActive, programmerStore, setBlackout, setGrandMaster } from "./programmer";
import { applyTick, getValues } from "./universe";

const par = makeFixture({ name: "PAR", address: 1, caps: ["r", "g", "b"] });
const lyre = makeFixture({ name: "Lyre", address: 10, caps: ["pan", "tilt", "intensity"] });
const chambre = makeFixture({ name: "PAR chambre", address: 20, caps: ["r", "g", "b"], room: "chambre" });

type Call = { url: string; body: Record<string, number> };
const calls: Call[] = [];

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const body = init?.body ? (JSON.parse(String(init.body)) as { values: Record<string, number> }) : { values: {} };
  calls.push({ url: String(input), body: body.values });
  return { ok: true, status: 200, json: async () => ({ ok: true, count: Object.keys(body.values).length }), text: async () => "" } as Response;
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  calls.length = 0;
  appStore.set((prev) => ({ ...prev, fixtures: [par, lyre, chambre] }));
  programmerStore.set((prev) => ({ ...prev, active: {}, grandMaster: 100, blackout: false }));
  applyTick({ fps: 30, universe: 0, values: new Array(512).fill(0), timestamp: "2026-01-01T00:00:00.000Z" });
});

afterEach(async () => {
  await flushNow();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("dmx-writer", () => {
  it("refuse la chambre, borne les valeurs, écho local immédiat", () => {
    const written = writeChannels([[1, 300], [2, -5], [20, 255], [999, 1]]);
    expect(written).toBe(2);
    expect(getValues()[0]).toBe(255);
    expect(getValues()[1]).toBe(0);
    expect(getValues()[19]).toBe(0);
  });

  it("envoie le premier lot tout de suite, puis regroupe toutes les 40 ms, puis s'arrête", async () => {
    writeChannels([[1, 10], [2, 20]]);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/universe");
    expect(calls[0].body).toEqual({ "1": 10, "2": 20 });

    writeChannels([[1, 11]]);
    writeChannels([[1, 12], [3, 30]]);
    expect(calls.length).toBe(1); // rien tant que le minuteur n'a pas tourné
    await vi.advanceTimersByTimeAsync(40);
    expect(calls.length).toBe(2);
    expect(calls[1].body).toEqual({ "1": 12, "3": 30 }); // dernière valeur seulement

    await vi.advanceTimersByTimeAsync(40);
    expect(calls.length).toBe(2); // tampon vide → minuteur arrêté
    expect(writerStats().timerActive).toBe(false);
  });

  it("marque les valeurs actives du programmer sur demande", () => {
    writeChannels([[1, 100]], { programmer: true });
    writeChannels([[2, 50]]);
    expect(programmerStore.get().active).toEqual({ 1: 100 });
  });

  it("Grand Master : photo, sortie atténuée, rejeu au retour à 100 %", async () => {
    writeChannels([[1, 200], [10, 100], [12, 200]]); // r PAR, pan lyre, intensity lyre
    await flushNow();
    setGrandMaster(50);
    expect(masterSnapshotActive()).toBe(true);
    expect(getValues()[0]).toBe(100); // r atténué
    expect(getValues()[9]).toBe(100); // pan intact
    expect(getValues()[11]).toBe(100); // intensity atténuée

    // Une écriture pendant GM 50 sort atténuée mais met la photo à jour.
    writeChannels([[1, 100]], { programmer: true });
    expect(getValues()[0]).toBe(50);
    expect(programmerStore.get().active[1]).toBe(100);

    setGrandMaster(100);
    expect(masterSnapshotActive()).toBe(false);
    expect(getValues()[0]).toBe(100);
    expect(getValues()[11]).toBe(200);
    expect(getValues()[19]).toBe(0); // la chambre n'a jamais bougé
  });

  it("Blackout met les canaux DIMMABLE à 0 et les rend ensuite", async () => {
    writeChannels([[3, 255], [11, 77]]);
    await flushNow();
    setBlackout(true);
    expect(getValues()[2]).toBe(0);
    expect(getValues()[10]).toBe(77); // tilt intact
    setBlackout(false);
    expect(getValues()[2]).toBe(255);
  });
});
