// Exécution d'une commande typée (parse.ts) via les stores. Renvoie toujours un
// { ok, message } en français, affiché 4 s dans la ligne de commande.
import { api } from "../api";
import { ATTRIBUTES, formatValue } from "../attributes";
import { byFid, currentPatch } from "../patch";
import { setRunning } from "../../state/app";
import { writeChannels } from "../../state/dmx-writer";
import {
  applyPreset,
  deleteExecutor,
  deleteGroup,
  deletePreset,
  goExecutor,
  groupAt,
  labelExecutor,
  labelGroup,
  offExecutor,
  presetLabel,
  recallGroup,
  setExecutorLevel,
  storeExecutor,
  storeGroup,
  storePreset
} from "../../state/playback";
import {
  clear,
  clearAll,
  programmerStore,
  select,
  selectAll,
  setAttribute,
  setBlackout,
  toggleHighlight
} from "../../state/programmer";
import { addWindow, findWindow, raiseWindow, showView, storeView, VIEW_COUNT } from "../../state/workspace";
import type { AttrSet, Command } from "./parse";
import { parseCommand } from "./parse";

export type CommandResult = { ok: boolean; message: string };

const ok = (message: string): CommandResult => ({ ok: true, message });
const fail = (message: string): CommandResult => ({ ok: false, message });
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n > 1 ? many : one}`;

// Pose un attribut (avec fan éventuel) sur la sélection courante.
const applyAttr = (set: AttrSet): CommandResult => {
  const ids = programmerStore.get().selection;
  if (!ids.length) return fail("Aucune sélection — sélectionnez des projecteurs d'abord (ex. Fixture 1 Thru 3)");
  const info = ATTRIBUTES[set.attr];
  const readout = programmerStore.get().readout;
  if (set.fanTo === undefined || ids.length < 2) {
    const n = setAttribute(set.attr, set.value);
    if (!n) return fail(`${info.label} : aucun canal correspondant sur la sélection`);
    return ok(`${info.label} At ${formatValue(set.value, set.attr, readout)} · ${plural(n, "canal", "canaux")}`);
  }
  let total = 0;
  ids.forEach((id, i) => {
    const t = i / (ids.length - 1);
    const value = Math.round(set.value + ((set.fanTo ?? set.value) - set.value) * t);
    total += setAttribute(set.attr, value, { ids: [id] });
  });
  if (!total) return fail(`${info.label} : aucun canal correspondant sur la sélection`);
  return ok(
    `${info.label} fan ${formatValue(set.value, set.attr, readout)} → ${formatValue(set.fanTo, set.attr, readout)} · ${plural(total, "canal", "canaux")}`
  );
};

// Résout des FID en ids, en signalant les inconnus et les verrouillés.
const resolveFids = (fids: number[], openEnd: boolean): { ids: string[]; unknown: number[]; locked: string[] } => {
  const patch = currentPatch();
  const ids: string[] = [];
  const unknown: number[] = [];
  const locked: string[] = [];
  const wanted = openEnd && fids.length ? [...fids, ...patch.filter((f) => f.fid > fids[fids.length - 1]).map((f) => f.fid)] : fids;
  for (const fid of wanted) {
    const f = byFid(patch, fid);
    if (!f) {
      unknown.push(fid);
      continue;
    }
    if (f.locked) {
      locked.push(`${f.name} (${f.locked})`);
      continue;
    }
    if (!ids.includes(f.id)) ids.push(f.id);
  }
  return { ids, unknown, locked };
};

const selectionMessage = (count: number, unknown: number[], locked: string[]): string => {
  const parts = [plural(count, "projecteur sélectionné", "projecteurs sélectionnés")];
  if (unknown.length) parts.push(`inconnu(s) : ${unknown.join(", ")}`);
  if (locked.length) parts.push(`verrouillé(s) : ${locked.join(", ")}`);
  return parts.join(" · ");
};

/** Applique une commande via les stores. Ne lève jamais : les erreurs deviennent { ok: false }. */
export async function executeCommand(cmd: Command): Promise<CommandResult> {
  try {
    switch (cmd.kind) {
      case "error":
        return fail(cmd.message);

      case "help": {
        const existing = findWindow("help");
        if (existing) raiseWindow(existing.id);
        else addWindow("help");
        return ok("Fenêtre Help ouverte");
      }

      case "select": {
        const { ids, unknown, locked } = resolveFids(cmd.fids, cmd.openEnd ?? false);
        select(ids, "replace");
        if (!ids.length) return fail(selectionMessage(0, unknown, locked));
        if (cmd.then) {
          const applied = applyAttr(cmd.then);
          return applied.ok ? ok(`${selectionMessage(ids.length, unknown, locked)} · ${applied.message}`) : applied;
        }
        return ok(selectionMessage(ids.length, unknown, locked));
      }

      case "selectAll": {
        selectAll();
        const count = programmerStore.get().selection.length;
        if (!count) return fail("Aucun projecteur pilotable dans le patch");
        if (cmd.then) {
          const applied = applyAttr(cmd.then);
          return applied.ok ? ok(`${plural(count, "projecteur sélectionné", "projecteurs sélectionnés")} · ${applied.message}`) : applied;
        }
        return ok(plural(count, "projecteur sélectionné", "projecteurs sélectionnés"));
      }

      case "attr":
        return applyAttr({ attr: cmd.attr, value: cmd.value, fanTo: cmd.fanTo });

      case "channel": {
        const entries = cmd.channels.map((ch): [number, number] => [ch, cmd.value]);
        const written = writeChannels(entries, { programmer: true });
        const refused = entries.length - written;
        if (!written) return fail(`Dmx : ${plural(refused, "canal verrouillé", "canaux verrouillés")}, rien n'a été écrit`);
        return ok(`Dmx At ${cmd.value} · ${plural(written, "canal écrit", "canaux écrits")}${refused ? ` (${refused} verrouillé(s) ignoré(s))` : ""}`);
      }

      case "clear": {
        const done = clear();
        if (done === "selection") return ok("Clear : sélection vidée");
        if (done === "active") return ok("Clear : valeurs actives oubliées (le plateau ne bouge pas)");
        return ok("Clear : rien à vider");
      }

      case "clearAll":
        clearAll();
        return ok("ClearAll : sélection et valeurs actives vidées");

      case "group": {
        const r = recallGroup(cmd.slot);
        return r.ok ? ok(r.message) : fail(r.message);
      }
      case "storeGroup": {
        const r = storeGroup(cmd.slot, cmd.name);
        return r.ok ? ok(r.message) : fail(r.message);
      }
      case "deleteGroup": {
        const group = groupAt(cmd.slot);
        if (!group) return fail(`Group ${cmd.slot} déjà vide`);
        deleteGroup(cmd.slot);
        return ok(`Group ${cmd.slot} « ${group.name} » supprimé`);
      }
      case "labelGroup": {
        if (!groupAt(cmd.slot)) return fail(`Group ${cmd.slot} vide`);
        labelGroup(cmd.slot, cmd.name);
        return ok(`Group ${cmd.slot} renommé « ${cmd.name} »`);
      }

      case "preset": {
        const r = await applyPreset(cmd.pool, cmd.slot);
        return r.ok ? ok(r.message) : fail(r.message);
      }
      case "storePreset": {
        const r = await storePreset(cmd.pool, cmd.slot, cmd.name);
        return r.ok ? ok(r.message) : fail(r.message);
      }
      case "deletePreset": {
        const r = await deletePreset(cmd.pool, cmd.slot);
        return r.ok ? ok(r.message) : fail(`${presetLabel(cmd.pool, cmd.slot)} : ${r.message}`);
      }

      case "storeExecutor": {
        const r = await storeExecutor(cmd.slot, cmd.name);
        return r.ok ? ok(r.message) : fail(r.message);
      }
      case "go": {
        const r = await goExecutor(cmd.slot);
        return r.ok ? ok(r.message) : fail(r.message);
      }
      case "off": {
        const r = offExecutor(cmd.slot);
        return r.ok ? ok(r.message) : fail(r.message);
      }
      case "deleteExecutor": {
        const r = await deleteExecutor(cmd.slot);
        return r.ok ? ok(r.message) : fail(r.message);
      }
      case "labelExecutor": {
        const r = await labelExecutor(cmd.slot, cmd.name);
        return r.ok ? ok(r.message) : fail(r.message);
      }
      case "executorLevel": {
        setExecutorLevel(cmd.slot, cmd.level);
        return ok(`Executor ${cmd.slot} At ${Math.round(cmd.level * 100)} %`);
      }

      case "phaserOff": {
        const { running } = await api.effects.stopAll();
        setRunning(running ?? []);
        return ok("Phaser Off : tous les effets arrêtés");
      }

      case "blackout":
        setBlackout(cmd.on);
        return ok(cmd.on ? "Blackout" : "Blackout Off");

      case "view":
        if (cmd.index < 0 || cmd.index >= VIEW_COUNT) return fail(`View : numéro entre 1 et ${VIEW_COUNT}`);
        showView(cmd.index);
        return ok(`View ${cmd.index + 1}`);

      case "storeView":
        if (cmd.index < 0 || cmd.index >= VIEW_COUNT) return fail(`Store View : numéro entre 1 et ${VIEW_COUNT}`);
        storeView(cmd.index, cmd.name ?? `View ${cmd.index + 1}`);
        return ok(`View ${cmd.index + 1} mémorisée${cmd.name ? ` « ${cmd.name} »` : ""}`);

      case "highlight":
        return ok(toggleHighlight() ? "Highlight On" : "Highlight Off");

      default:
        return fail("Commande non prise en charge");
    }
  } catch (err) {
    return fail(`Erreur : ${errorText(err)}`);
  }
}

/** Raccourci pour la ligne de commande : analyse puis exécute. */
export async function runCommandLine(text: string): Promise<CommandResult> {
  return executeCommand(parseCommand(text));
}
