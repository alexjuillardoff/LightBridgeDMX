// Fenêtre « Layout » — STUB du chrome (phase 1), remplacé par l'agent de la fenêtre.
import type { WindowModule } from "../types";

function LayoutWindow() {
  return <div className="ma-empty">Fenêtre en construction — Layout</div>;
}

const mod: WindowModule = {
  kind: "layout",
  title: "Layout",
  category: "Common",
  defaultSize: { w: 12, h: 8 },
  Component: LayoutWindow
};

export default mod;
