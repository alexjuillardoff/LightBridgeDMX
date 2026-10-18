// Fenêtre « Patch » — STUB du chrome (phase 1), remplacé par l'agent de la fenêtre.
import type { WindowModule } from "../types";

function PatchWindow() {
  return <div className="ma-empty">Fenêtre en construction — Patch</div>;
}

const mod: WindowModule = {
  kind: "patch",
  title: "Patch",
  category: "Data",
  defaultSize: { w: 16, h: 12 },
  Component: PatchWindow
};

export default mod;
