// Menu principal (roue dentée) : plein écran, tuiles Patch, Devices (Network), Setup
// (Settings), Backup (export/import JSON des vues, groupes, slots), Help, About.
import { useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { exportLocal, importLocal } from "../../lib/local-store";
import type { WindowKind } from "../../state/workspace";
import { closeOverlay } from "../../state/workspace";
import { openWindow } from "../../windows/registry";
import { IconDisplay, IconDownload, IconGear, IconInfo, IconNetwork, IconUpload, IconViews, IconWindow } from "../icons";
import { toast } from "../Toasts";
import { OverlayFrame } from "./OverlayFrame";

// Sauvegarde = clés connues de lib/local-store (vues, groupes, slots, presets, layout, historique).
function exportBackup(): void {
  const payload = { app: "LightBridgeDMX", kind: "ma3-ui-backup", exportedAt: new Date().toISOString(), data: exportLocal() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `lightbridge-ui-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Sauvegarde exportée.", "ok");
}

async function importBackup(file: File): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== "object" || !("data" in parsed)) throw new Error("fichier inattendu");
    const data = (parsed as { data: unknown }).data;
    if (!data || typeof data !== "object") throw new Error("fichier inattendu");
    const count = importLocal(data as Record<string, unknown>);
    if (count === 0) throw new Error("aucune donnée reconnue");
    toast(`Sauvegarde importée (${count} clés) — rechargement…`, "ok");
    window.setTimeout(() => window.location.reload(), 800);
  } catch (err) {
    toast(`Import impossible : ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

type Tile = { key: string; label: string; sub: string; icon: ReactNode; onClick: () => void };

export function MainMenu() {
  const [panel, setPanel] = useState<"none" | "backup" | "about">("none");
  const fileInput = useRef<HTMLInputElement>(null);

  const open = (kind: WindowKind) => {
    openWindow(kind);
    closeOverlay();
  };

  const tiles: Tile[] = [
    { key: "patch", label: "Patch", sub: "Projecteurs et adresses DMX", icon: <IconViews />, onClick: () => open("patch") },
    { key: "devices", label: "Devices", sub: "Network — lampes, prises, ponts", icon: <IconNetwork />, onClick: () => open("devices") },
    { key: "setup", label: "Setup", sub: "Settings — DMX, HomeKit, interface", icon: <IconGear />, onClick: () => open("setup") },
    { key: "backup", label: "Backup", sub: "Export / import des vues et pools", icon: <IconDownload />, onClick: () => setPanel("backup") },
    { key: "help", label: "Help", sub: "Commandes, raccourcis, gestes", icon: <IconWindow />, onClick: () => open("help") },
    { key: "about", label: "About", sub: "LightBridgeDMX", icon: <IconInfo />, onClick: () => setPanel("about") }
  ];

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void importBackup(file);
    e.target.value = "";
  };

  return (
    <OverlayFrame title="Menu" onClose={closeOverlay} full className="sh-menu">
      <div className="sh-menu__tiles">
        {tiles.map((t) => (
          <button key={t.key} type="button" className={`ma-btn sh-menu__tile${panel === t.key ? " ma-btn--active" : ""}`} onClick={t.onClick}>
            <span className="sh-menu__icon">{t.icon}</span>
            <span className="sh-menu__label">{t.label}</span>
            <span className="sh-menu__sub">{t.sub}</span>
          </button>
        ))}
      </div>

      {panel === "backup" ? (
        <div className="sh-menu__panel">
          <h3>Backup</h3>
          <p className="ma-dialog__text">
            Les vues, fenêtres, groupes, executors, références de presets et le layout vivent dans ce navigateur (localStorage). Exportez-les
            en JSON pour les transférer sur un autre poste ; l'import remplace les clés présentes puis recharge l'interface.
          </p>
          <div className="ma-row">
            <button type="button" className="ma-btn" onClick={exportBackup}>
              <IconDownload /> Export JSON
            </button>
            <button type="button" className="ma-btn" onClick={() => fileInput.current?.click()}>
              <IconUpload /> Import JSON
            </button>
            <input ref={fileInput} type="file" accept="application/json,.json" className="ma-sr-only" onChange={onFile} aria-label="Fichier de sauvegarde" />
          </div>
        </div>
      ) : null}

      {panel === "about" ? (
        <div className="sh-menu__panel">
          <h3>About</h3>
          <p className="ma-dialog__text">
            <strong>LightBridgeDMX</strong> — pont DMX512 ↔ Apple HomeKit avec tableau de bord. Interface « grandMA3 onPC » : les termes du
            pupitre (Fixture, Dimmer, Store, Go…) sont ceux de MA Lighting ; ce logiciel n'est pas affilié à MA Lighting.
          </p>
          <p className="ma-dialog__text">
            Chaîne de sortie : backend Fastify → Art-Net → QLC+ → Enttec Open DMX → DMX512. Les projecteurs de la chambre sont verrouillés par
            construction.
          </p>
          <p className="ma-dialog__text ma-row">
            <IconDisplay /> Display 1 · échelle réglable dans Setup → Interface
          </p>
        </div>
      ) : null}
    </OverlayFrame>
  );
}
