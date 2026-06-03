// Configuration Vite du frontend React (serveur de dev + build).
// Sert l'UI sur le port 5173 et fait proxy des appels /api et /ws vers le backend Fastify (:5000),
// ce qui evite les problemes CORS en developpement.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// On resout le package partage vers sa SOURCE TypeScript (et non son dist/index.js compile en
// CommonJS). Raison : au build, rollup n'arrive pas a detecter les exports de fonctions du dist
// CJS (ex. buildUShapeLayout), ce qui cassait `vite build`. En pointant sur la source ESM, tous
// les exports nommes sont resolus proprement, et c'est coherent avec le backend (tsconfig-paths
// resout aussi vers src). Bonus : plus besoin que `packages/shared` soit compile avant le frontend.
const sharedSource = fileURLToPath(new URL("../packages/shared/src/index.ts", import.meta.url));
// Racine du monorepo : on l'autorise pour que le serveur de dev puisse lire la source partagee,
// qui se trouve hors du dossier frontend/.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@lightbridgedmx/shared": sharedSource
    }
  },
  server: {
    // host: true expose le serveur sur le reseau local (acces depuis un mobile/tablette).
    host: true,
    port: 5173,
    // Autorise Vite a servir des fichiers hors de frontend/ (ici la source du package partage).
    fs: {
      allow: [repoRoot]
    },
    proxy: {
      // Les requetes REST passent au backend.
      "/api": "http://localhost:5000",
      // Le flux temps reel WebSocket (etat de l'univers DMX). ws: true active le tunnel WebSocket.
      "/ws": {
        target: "ws://localhost:5000",
        ws: true
      }
    }
  }
});
