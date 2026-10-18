// Point d'entree de l'application React (frontend Vite).
// L'ancienne interface a ete supprimee le 2026-10-18 (derniere version : commit 24c1176) ;
// la nouvelle se construit a partir d'ici.

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
