// Pont vers l'API pour les actions du chrome (overlays, encoder bar). Un seul endroit
// à adapter si les signatures de lib/api.ts évoluent ; les composants n'appellent
// jamais fetch directement (règle §2.8 du cahier des charges).
import type { RunningEffect } from "@lightbridgedmx/shared";
import { api } from "../lib/api";
import { pushLog } from "../state/app";
import { toast } from "./Toasts";

function report(action: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  pushLog({ level: "error", message: `${action} : ${message}`, timestamp: new Date().toISOString() });
  toast(`${action} : ${message}`, "error");
}

/** Redémarre les services launchd (backend, frontend, QLC+) via POST /api/system/restart. */
export async function restartSystem(): Promise<boolean> {
  try {
    await api.system.restart();
    toast("Redémarrage demandé — l'interface se rechargera toute seule.", "ok");
    return true;
  } catch (err) {
    report("Redémarrage", err);
    return false;
  }
}

/** Change le multiplicateur de vitesse (Rate) d'un phaser en cours : PUT /api/effects/:id. */
export async function setEffectRate(running: RunningEffect, rate: number): Promise<void> {
  try {
    await api.effects.update(running.id, { ...running.effect, rate });
  } catch (err) {
    report("Speed Master", err);
  }
}

/** Retouche un phaser en cours (speed, matricks…) sans le relancer. */
export async function updateEffect(running: RunningEffect, patch: Partial<RunningEffect["effect"]>): Promise<void> {
  try {
    await api.effects.update(running.id, { ...running.effect, ...patch });
  } catch (err) {
    report("Phaser", err);
  }
}

/** Arrête un phaser (DELETE /api/effects/:id). */
export async function stopEffect(id: string): Promise<void> {
  try {
    await api.effects.stop(id);
  } catch (err) {
    report("Off Phaser", err);
  }
}

/** Arrête tous les phasers (POST /api/effects/stop-all). */
export async function stopAllEffects(): Promise<void> {
  try {
    await api.effects.stopAll();
    toast("Tous les phasers sont arrêtés.", "ok");
  } catch (err) {
    report("Off All Phasers", err);
  }
}
