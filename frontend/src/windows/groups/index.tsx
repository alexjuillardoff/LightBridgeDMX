// Fenêtre « Groups » — STUB du chrome (phase 1), remplacé par l'agent de la fenêtre.
import type { WindowModule } from "../types";

function GroupsWindow() {
  return <div className="ma-empty">Fenêtre en construction — Groups</div>;
}

const mod: WindowModule = {
  kind: "groups",
  title: "Groups",
  category: "Pools",
  defaultSize: { w: 8, h: 7 },
  Component: GroupsWindow
};

export default mod;
