// Registre cote frontend des "backends" de lampes connectees (smart lights).
// Ici, "backend" designe la marque/type de lampe supporte (Nanoleaf, etc.),
// a ne pas confondre avec le serveur Fastify. Ce fichier centralise les
// metadonnees d'affichage (libelle, description, icone) et fournit deux
// helpers : retrouver les metadonnees d'un backend et filtrer les lampes.
import { LucideIcon, Lightbulb } from "lucide-react";
import { SmartLight } from "@lightbridgedmx/shared";

// Identifiant d'un backend. "nanoleaf-http" est le seul connu pour l'instant ;
// le `| string` laisse la porte ouverte a de futurs backends sans casser le typage.
export type SmartLightBackendId = "nanoleaf-http" | string;

// Metadonnees d'affichage d'un backend dans l'UI (carte, filtre, icone).
export type SmartLightBackendMeta = {
  id: SmartLightBackendId;
  label: string;
  description: string;
  icon: LucideIcon;
};

// Liste des backends supportes. Le pattern est extensible : ajouter une
// entree ici suffit a faire apparaitre un nouveau type de lampe dans l'UI.
export const SMART_LIGHT_BACKENDS: SmartLightBackendMeta[] = [
  {
    id: "nanoleaf-http",
    label: "Nanoleaf",
    description: "Strips, panels et ampoules Nanoleaf via HTTP + streaming UDP",
    icon: Lightbulb
  }
];

// Retrouve les metadonnees d'un backend par son id. Renvoie undefined si inconnu.
export const getBackendMeta = (id: string): SmartLightBackendMeta | undefined =>
  SMART_LIGHT_BACKENDS.find((b) => b.id === id);

// Indique si une lampe correspond au filtre de backend choisi dans l'UI.
// Le filtre special "all" laisse tout passer (aucun filtrage).
export const lightMatchesBackend = (light: SmartLight, filter: SmartLightBackendId | "all"): boolean => {
  if (filter === "all") return true;
  return light.config.type === filter;
};
