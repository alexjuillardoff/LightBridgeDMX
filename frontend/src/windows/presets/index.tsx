// Fenêtre « Presets » — STUB du chrome (phase 1), remplacé par l'agent de la fenêtre.
import type { WindowModule } from "../types";

function PresetsWindow() {
  return <div className="ma-empty">Fenêtre en construction — Presets</div>;
}

const mod: WindowModule = {
  kind: "presets",
  title: "Presets",
  category: "Presets",
  defaultSize: { w: 8, h: 7 },
  Component: PresetsWindow
};

export default mod;
