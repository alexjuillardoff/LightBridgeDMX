import { LucideIcon, Lightbulb } from "lucide-react";
import { SmartLight } from "@lightbridgedmx/shared";

export type SmartLightBackendId = "nanoleaf-http" | string;

export type SmartLightBackendMeta = {
  id: SmartLightBackendId;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const SMART_LIGHT_BACKENDS: SmartLightBackendMeta[] = [
  {
    id: "nanoleaf-http",
    label: "Nanoleaf",
    description: "Strips, panels et ampoules Nanoleaf via HTTP + streaming UDP",
    icon: Lightbulb
  }
];

export const getBackendMeta = (id: string): SmartLightBackendMeta | undefined =>
  SMART_LIGHT_BACKENDS.find((b) => b.id === id);

export const lightMatchesBackend = (light: SmartLight, filter: SmartLightBackendId | "all"): boolean => {
  if (filter === "all") return true;
  return light.config.type === filter;
};
