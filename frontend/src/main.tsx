// Point d'entree de l'application React (frontend Vite).
// Cree la racine React, branche react-query (cache des appels API) et
// monte le composant App dans la balise #root de la page HTML.

import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles.css";

// Client react-query partage : gere le cache et les requetes vers l'API backend.
const queryClient = new QueryClient();

// Le "!" affirme que l'element #root existe (defini dans index.html).
// StrictMode aide a reperer les bugs en dev (double rendu volontaire).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
