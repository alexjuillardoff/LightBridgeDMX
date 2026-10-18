// Control bar verticale gauche : 11 boutons carrés séparés par de fines bandes noires
// (quatre emplacements vides comme sur la capture), bouton « At ▽ » plus haut en bas.
import type { ReactNode } from "react";
import { findWindow, openOverlay, raiseWindow, toggleBar, useWorkspace } from "../state/workspace";
import { openWindow } from "../windows/registry";
import {
  IconDisplay,
  IconEncoderBar,
  IconFaders,
  IconFunnel,
  IconGear,
  IconMasterFader,
  IconPower,
  IconSpecialMaster,
  IconViews,
  IconWing
} from "./icons";

type Item =
  | { kind: "gap"; key: string }
  | { kind: "btn"; key: string; icon: ReactNode; title: string; onClick: () => void; active?: boolean; flag?: boolean };

export function ControlBar() {
  const showEncoderBar = useWorkspace((s) => s.showEncoderBar);
  const wingBar = useWorkspace((s) => s.wingBar);

  const items: Item[] = [
    { kind: "btn", key: "power", icon: <IconPower />, title: "Shutdown / Reload", onClick: () => openOverlay("shutdown") },
    { kind: "gap", key: "g1" },
    { kind: "btn", key: "menu", icon: <IconGear />, title: "Menu", onClick: () => openOverlay("menu") },
    { kind: "gap", key: "g2" },
    { kind: "btn", key: "views", icon: <IconViews />, title: "Add Window", onClick: () => openOverlay("addWindow") },
    { kind: "btn", key: "cmd", icon: <IconFaders />, title: "Command Section", onClick: () => openOverlay("commandSection") },
    { kind: "btn", key: "special", icon: <IconSpecialMaster />, title: "Special Masters", onClick: () => openOverlay("specialMasters") },
    { kind: "btn", key: "master", icon: <IconMasterFader />, title: "Master Controls", onClick: () => openOverlay("masterControls") },
    {
      kind: "btn",
      key: "encoder",
      icon: <IconEncoderBar />,
      title: "Encoder Bar",
      onClick: () => toggleBar("encoder"),
      active: showEncoderBar
    },
    { kind: "gap", key: "g3" },
    { kind: "btn", key: "displays", icon: <IconDisplay />, title: "Displays", onClick: () => openOverlay("displays") },
    {
      kind: "btn",
      key: "help",
      icon: <span className="sh-cb__help">?</span>,
      title: "Help",
      onClick: () => {
        // Une seule fenêtre Help : on remonte celle qui existe, sinon on l'ajoute.
        const existing = findWindow("help");
        if (existing) raiseWindow(existing.id);
        else openWindow("help");
      },
      flag: true
    },
    { kind: "btn", key: "wing", icon: <IconWing />, title: "Command Wing Bar", onClick: () => toggleBar("wing"), active: wingBar }
  ];

  return (
    <nav className="sh-cb" aria-label="Control bar" data-neutral="">
      {items.map((it) =>
        it.kind === "gap" ? (
          <span key={it.key} className="sh-cb__gap" aria-hidden="true" />
        ) : (
          <button
            key={it.key}
            type="button"
            className={`sh-cb__btn${it.active ? " is-active" : ""}`}
            title={it.title}
            aria-label={it.title}
            aria-pressed={it.active === undefined ? undefined : it.active}
            onClick={it.onClick}
          >
            {it.icon}
            {it.flag ? <span className="sh-cb__flag" aria-hidden="true" /> : null}
          </button>
        )
      )}
      <span className="sh-cb__gap" aria-hidden="true" />
      <button type="button" className="sh-cb__btn sh-cb__at" title="At" aria-label="At" onClick={() => openOverlay("at")}>
        <span className="sh-cb__at-text">At</span>
        <IconFunnel />
      </button>
    </nav>
  );
}
