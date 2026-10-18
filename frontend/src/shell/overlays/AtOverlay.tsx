// Overlay « At » (bouton At ▽ de la control bar) : Full, Zero, Off, On, Default (pan/tilt
// à 50 %), Clear, Copy / Paste programmer (copie les valeurs actives, les colle sur une
// autre sélection).
import { useMemo, useState } from "react";
import { ATTRIBUTES, channelsForAttr } from "../../lib/attributes";
import type { AttrKey } from "../../lib/attributes";
import { absoluteChannel } from "../../lib/patch";
import { getValues } from "../../state/universe";
import { clear, forgetActive, markActive, setAttribute, useActiveChannels, useSelectedFixtures } from "../../state/programmer";
import { closeOverlay } from "../../state/workspace";
import { toast } from "../Toasts";
import { OverlayFrame } from "./OverlayFrame";

// Presse-papiers du programmer : attribut → valeur DMX (survit à la fermeture de l'overlay).
let clipboard: Partial<Record<AttrKey, number>> = {};

const CLEAR_MESSAGES = { selection: "Sélection vidée", active: "Valeurs du programmer oubliées", nothing: "Rien à vider" } as const;

export function AtOverlay() {
  const selected = useSelectedFixtures();
  const active = useActiveChannels();
  const [clipCount, setClipCount] = useState(Object.keys(clipboard).length);
  const none = selected.length === 0;

  // Tous les canaux absolus de la sélection (pour Off / On).
  const allChannels = useMemo(() => {
    const out = new Set<number>();
    for (const f of selected) for (const ch of f.channels) out.add(absoluteChannel(f, ch.channel));
    return out;
  }, [selected]);

  const need = () => {
    if (none) toast("Aucun projecteur sélectionné.", "warn");
    return none;
  };

  const full = () => {
    if (need()) return;
    toast(`Full : ${setAttribute("dimmer", 100, { unit: "percent" })} canal(aux)`, "ok");
  };
  const zero = () => {
    if (need()) return;
    toast(`Zero : ${setAttribute("dimmer", 0, { unit: "percent" })} canal(aux)`, "ok");
  };
  // Off : retire les canaux de la sélection du programmer (les valeurs restent sur scène).
  const off = () => {
    if (need()) return;
    const channels = [...allChannels].filter((ch) => active[ch] !== undefined);
    forgetActive(channels);
    toast(`Off : ${channels.length} valeur(s) retirée(s) du programmer`, "ok");
  };
  // On : marque les valeurs courantes de la sélection comme actives dans le programmer.
  const on = () => {
    if (need()) return;
    const values = getValues();
    markActive([...allChannels].map((ch) => [ch, values[ch - 1] ?? 0]));
    toast(`On : ${allChannels.size} canal(aux) dans le programmer`, "ok");
  };
  const defaults = () => {
    if (need()) return;
    const n = setAttribute("pan", 50, { unit: "percent" }) + setAttribute("tilt", 50, { unit: "percent" });
    toast(n > 0 ? "Default : pan / tilt à 50 %" : "Default : aucun pan / tilt dans la sélection", n > 0 ? "ok" : "warn");
  };
  const doClear = () => {
    const what = clear();
    toast(CLEAR_MESSAGES[what], what === "nothing" ? "info" : "ok");
  };
  const copy = () => {
    if (need()) return;
    const next: Partial<Record<AttrKey, number>> = {};
    for (const attr of Object.keys(ATTRIBUTES) as AttrKey[]) {
      let best: number | null = null;
      for (const f of selected) {
        for (const ch of channelsForAttr(f, attr)) {
          const v = active[ch];
          if (v !== undefined && (best === null || v > best)) best = v;
        }
      }
      if (best !== null) next[attr] = best;
    }
    clipboard = next;
    setClipCount(Object.keys(next).length);
    toast(Object.keys(next).length > 0 ? `Copié : ${Object.keys(next).length} attribut(s)` : "Rien d'actif à copier", Object.keys(next).length > 0 ? "ok" : "warn");
  };
  const paste = () => {
    if (need()) return;
    let n = 0;
    for (const [attr, v] of Object.entries(clipboard) as Array<[AttrKey, number]>) n += setAttribute(attr, v, { unit: "dmx" });
    toast(n > 0 ? `Collé : ${n} canal(aux)` : "Rien à coller sur cette sélection", n > 0 ? "ok" : "warn");
  };

  const activeCount = useMemo(() => [...allChannels].filter((ch) => active[ch] !== undefined).length, [allChannels, active]);

  return (
    <OverlayFrame title="At" onClose={closeOverlay} width={30}>
      <div className="ma-muted">
        {none ? "Aucune sélection" : `${selected.length} projecteur(s) sélectionné(s) · ${activeCount} canal(aux) actif(s)`}
      </div>
      <div className="sh-at">
        <button type="button" className="ma-btn" onClick={full}>Full</button>
        <button type="button" className="ma-btn" onClick={zero}>Zero</button>
        <button type="button" className="ma-btn" onClick={off}>Off</button>
        <button type="button" className="ma-btn" onClick={on}>On</button>
        <button type="button" className="ma-btn" onClick={defaults}>Default</button>
        <button type="button" className="ma-btn" onClick={doClear}>Clear</button>
        <button type="button" className="ma-btn" onClick={copy}>Copy</button>
        <button type="button" className="ma-btn" onClick={paste} disabled={clipCount === 0}>
          {clipCount > 0 ? `Paste (${clipCount})` : "Paste"}
        </button>
      </div>
      <p className="ma-dialog__text">
        Off retire les valeurs de la sélection du programmer sans toucher à la scène ; On les y remet ; Copy / Paste transportent les valeurs
        actives vers une autre sélection.
      </p>
    </OverlayFrame>
  );
}
