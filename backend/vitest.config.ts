// Configuration Vitest pour les tests du backend.
// Definit l'environnement d'execution, les fichiers de test a inclure et
// l'alias de chemin vers le package partage.

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests cote serveur : environnement Node (pas de DOM navigateur).
    environment: "node",
    // Ne lance que les fichiers *.spec.ts sous src/ (ex. homekit-utils.spec.ts).
    include: ["src/**/*.spec.ts"]
  },
  resolve: {
    alias: {
      // Resout l'import "@lightbridgedmx/shared" directement vers les sources
      // du package partage, sans build prealable (memes types Zod en test).
      "@lightbridgedmx/shared": path.resolve(__dirname, "../packages/shared/src")
    }
  }
});
