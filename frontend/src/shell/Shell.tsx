// Grille générale de l'interface grandMA3 onPC :
//   ┌ control bar ┬ écran (fenêtres) ┬ view bar ┐
//   ├ command line (pleine largeur)             ┤
//   └ encoder bar / command wing bar            ┘
// Monte aussi les overlays, les toasts et les raccourcis clavier globaux.
import { useEffect } from "react";
import type { MouseEvent } from "react";
import { toggleBar, useWorkspace, workspaceStore } from "../state/workspace";
import { AddWindowDialog } from "./AddWindowDialog";
import { CommandLine, focusCommandLine } from "./CommandLine";
import { ControlBar } from "./ControlBar";
import { EncoderBar } from "./EncoderBar";
import { AtOverlay } from "./overlays/AtOverlay";
import { Calculator, isCalculatorPayload } from "./overlays/Calculator";
import { CmdHistory } from "./overlays/CmdHistory";
import { CommandSection } from "./overlays/CommandSection";
import { Displays } from "./overlays/Displays";
import { MainMenu } from "./overlays/MainMenu";
import { MasterControls } from "./overlays/MasterControls";
import { MessageCenter } from "./overlays/MessageCenter";
import { PlaybackControls } from "./overlays/PlaybackControls";
import { ShutdownMenu } from "./overlays/ShutdownMenu";
import { SpecialMasters } from "./overlays/SpecialMasters";
import { StoreView, isStoreViewPayload } from "./overlays/StoreView";
import { Screen } from "./Screen";
import { Toasts } from "./Toasts";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { ViewBar } from "./ViewBar";
import "./shell.css";

const COMPACT_QUERY = "(max-width: 900px)";

function isPoint(p: unknown): p is { x: number; y: number } {
  return typeof p === "object" && p !== null && typeof (p as { x: unknown }).x === "number" && typeof (p as { y: unknown }).y === "number";
}

/** Rend l'overlay courant du workspace. */
function OverlayHost() {
  const overlay = useWorkspace((s) => s.overlay);
  const payload = useWorkspace((s) => s.overlayPayload);
  switch (overlay) {
    case "shutdown":
      return <ShutdownMenu />;
    case "menu":
      return <MainMenu />;
    case "commandSection":
      return <CommandSection />;
    case "masterControls":
      return <MasterControls />;
    case "specialMasters":
      return <SpecialMasters />;
    case "playbackControls":
      return <PlaybackControls />;
    case "displays":
      return <Displays />;
    case "at":
      return <AtOverlay />;
    case "messages":
      return <MessageCenter />;
    case "cmdHistory":
      return <CmdHistory />;
    case "addWindow":
      return <AddWindowDialog at={isPoint(payload) ? payload : undefined} />;
    case "calculator":
      return isCalculatorPayload(payload) ? <Calculator payload={payload} /> : null;
    case "storeView":
      return isStoreViewPayload(payload) ? <StoreView index={payload.index} /> : null;
    default:
      return null;
  }
}

export function Shell() {
  const showControlBar = useWorkspace((s) => s.showControlBar);
  const showViewBar = useWorkspace((s) => s.showViewBar);
  const showEncoderBar = useWorkspace((s) => s.showEncoderBar);
  const uiScale = useWorkspace((s) => s.uiScale);

  useKeyboardShortcuts();

  // Échelle : html { font-size: calc(16px * var(--ui-scale)) } (theme.css).
  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(uiScale));
  }, [uiScale]);

  // Sous 900 px de large, control bar et view bar sont masquées (ré-affichables par ◀ ▶).
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const hideBars = () => {
      if (!mq.matches) return;
      const s = workspaceStore.get();
      if (s.showControlBar) toggleBar("control");
      if (s.showViewBar) toggleBar("view");
    };
    hideBars();
    mq.addEventListener("change", hideBars);
    return () => mq.removeEventListener("change", hideBars);
  }, []);

  // Un clic sur une zone neutre (fond d'une barre) redonne le focus à la command line.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.closest("button, input, textarea, select, a, [role=slider], [role=dialog], .sh-win, .ma-menu, .sh-screen")) return;
    if (t.closest("[data-neutral]")) focusCommandLine();
  };

  return (
    <div className={`sh-root${showEncoderBar ? "" : " sh-root--no-encbar"}`} onClick={onClick}>
      {showControlBar ? <ControlBar /> : null}
      <Screen />
      {showViewBar ? <ViewBar /> : null}
      <CommandLine />
      {showEncoderBar ? <EncoderBar /> : null}
      <OverlayHost />
      <Toasts />
    </div>
  );
}

export default Shell;
