// Fenêtre « Executors » — STUB du chrome (phase 1), remplacé par l'agent de la fenêtre.
import type { WindowModule } from "../types";

function ExecutorsWindow() {
  return <div className="ma-empty">Fenêtre en construction — Executors</div>;
}

const mod: WindowModule = {
  kind: "executors",
  title: "Executors",
  category: "Playback",
  defaultSize: { w: 12, h: 7 },
  Component: ExecutorsWindow
};

export default mod;
