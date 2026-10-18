// Fenêtre « Color Picker » — STUB du chrome (phase 1), remplacé par l'agent de la fenêtre.
import type { WindowModule } from "../types";

function ColorPickerWindow() {
  return <div className="ma-empty">Fenêtre en construction — Color Picker</div>;
}

const mod: WindowModule = {
  kind: "colorPicker",
  title: "Color Picker",
  category: "Presets",
  defaultSize: { w: 8, h: 8 },
  Component: ColorPickerWindow
};

export default mod;
