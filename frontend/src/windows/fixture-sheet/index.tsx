// Fenêtre « Fixture Sheet » — STUB du chrome (phase 1), remplacé par l'agent de la fenêtre.
import type { WindowModule } from "../types";

function FixtureSheetWindow() {
  return <div className="ma-empty">Fenêtre en construction — Fixture Sheet</div>;
}

const mod: WindowModule = {
  kind: "fixtureSheet",
  title: "Fixture Sheet",
  category: "Common",
  defaultSize: { w: 24, h: 8 },
  Component: FixtureSheetWindow
};

export default mod;
