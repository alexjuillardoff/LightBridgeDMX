import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"]
  },
  resolve: {
    alias: {
      "@lightbridgedmx/shared": path.resolve(__dirname, "../packages/shared/src")
    }
  }
});
