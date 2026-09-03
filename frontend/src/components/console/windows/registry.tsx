// Registre des fenêtres : associe un `WindowKind` à son contenu et à son badge
// de barre de titre.
//
// Un seul endroit à toucher pour ajouter une fenêtre au pupitre : on déclare son
// type dans lib/console/layout.ts, on ajoute son entrée ici, et elle apparaît
// dans le menu « + Fenêtre » comme dans toutes les dispositions.
import { ReactNode } from "react";
import { WindowKind } from "../../../lib/console/layout";
import { ChannelGrid } from "../../ChannelGrid";
import { EncoderBar } from "../../EncoderBar";
import { FixtureSheet } from "../../FixtureSheet";
import { UniverseMonitor } from "../../UniverseMonitor";
import { EffectsWindow } from "./EffectsWindow";
import { ExecutorsWindow } from "./ExecutorsWindow";
import { GroupsWindow } from "./GroupsWindow";
import { LogWindow } from "./LogWindow";
import { PlaybacksWindow } from "./PlaybacksWindow";
import { PresetsWindow } from "./PresetsWindow";

/** Contenu d'une fenêtre, choisi par son type. */
export const renderWindowContent = (kind: WindowKind): ReactNode => {
  switch (kind) {
    case "fixtures":
      return <FixtureSheet />;
    case "encoders":
      return <EncoderBar />;
    case "executors":
      return <ExecutorsWindow />;
    case "playbacks":
      return <PlaybacksWindow />;
    case "groups":
      return <GroupsWindow />;
    case "presets":
      return <PresetsWindow />;
    case "faders":
      return <ChannelGrid />;
    case "dmx":
      return <UniverseMonitor />;
    case "effects":
      return <EffectsWindow />;
    case "log":
      return <LogWindow />;
    default:
      return null;
  }
};
