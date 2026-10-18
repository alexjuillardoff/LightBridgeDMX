// Fenêtre « Devices » — STUB du chrome (phase 1), remplacé par l'agent de la fenêtre.
import type { WindowModule } from "../types";

function DevicesWindow() {
  return <div className="ma-empty">Fenêtre en construction — Devices</div>;
}

const mod: WindowModule = {
  kind: "devices",
  title: "Devices",
  category: "Data",
  defaultSize: { w: 8, h: 12 },
  Component: DevicesWindow
};

export default mod;
