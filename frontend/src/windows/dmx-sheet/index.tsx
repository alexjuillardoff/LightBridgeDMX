// Fenêtre « DMX Sheet » — STUB du chrome (phase 1), remplacé par l'agent de la fenêtre.
import type { WindowModule } from "../types";

function DmxSheetWindow() {
  return <div className="ma-empty">Fenêtre en construction — DMX Sheet</div>;
}

const mod: WindowModule = {
  kind: "dmxSheet",
  title: "DMX Sheet",
  category: "Data",
  defaultSize: { w: 24, h: 8 },
  Component: DmxSheetWindow
};

export default mod;
