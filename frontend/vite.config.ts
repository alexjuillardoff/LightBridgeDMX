// Configuration Vite du frontend React (serveur de dev + build).
// Sert l'UI sur le port 5173 et fait proxy des appels /api et /ws vers le backend Fastify (:5000),
// ce qui evite les problemes CORS en developpement.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Le package partage est en TypeScript source (pas un paquet npm pre-build) :
    // on demande a Vite de le pre-bundler pour eviter des erreurs de resolution au demarrage.
    include: ["@lightbridgedmx/shared"]
  },
  server: {
    // host: true expose le serveur sur le reseau local (acces depuis un mobile/tablette).
    host: true,
    port: 5173,
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
