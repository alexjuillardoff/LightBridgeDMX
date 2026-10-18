// Fenêtre « Phaser Editor » — STUB du chrome (phase 1), remplacé par l'agent de la fenêtre.
import type { WindowModule } from "../types";

function PhaserWindow() {
  return <div className="ma-empty">Fenêtre en construction — Phaser Editor</div>;
}

const mod: WindowModule = {
  kind: "phaser",
  title: "Phaser Editor",
  category: "Tools",
  defaultSize: { w: 14, h: 10 },
  Component: PhaserWindow
};

export default mod;
