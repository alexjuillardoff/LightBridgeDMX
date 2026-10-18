// Configuration Vitest du frontend : tests de logique pure (parseur de commandes,
// programmer, scenes...) en environnement Node, sans DOM. L'alias vers la source
// du package partage est le meme que dans vite.config.ts.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"]
  },
  resolve: {
    alias: {
      "@lightbridgedmx/shared": fileURLToPath(new URL("../packages/shared/src/index.ts", import.meta.url))
    }
  }
});
