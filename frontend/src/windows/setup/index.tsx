// Fenêtre « Setup » — STUB du chrome (phase 1), remplacé par l'agent de la fenêtre.
import type { WindowModule } from "../types";

function SetupWindow() {
  return <div className="ma-empty">Fenêtre en construction — Setup</div>;
}

const mod: WindowModule = {
  kind: "setup",
  title: "Setup",
  category: "More",
  defaultSize: { w: 12, h: 12 },
  Component: SetupWindow
};

export default mod;
