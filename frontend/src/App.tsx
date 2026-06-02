// Composant racine de l'application React.
// Son seul role : envelopper l'interface (AppShell) dans le fournisseur
// de donnees global (AppDataProvider) pour que tous les onglets aient
// acces a l'etat partage (projecteurs, lampes, canaux DMX...).
import { AppDataProvider } from "./contexts/AppDataContext";
import { AppShell } from "./shell/AppShell";

function App() {
  return (
    <AppDataProvider>
      <AppShell />
    </AppDataProvider>
  );
}

export default App;
