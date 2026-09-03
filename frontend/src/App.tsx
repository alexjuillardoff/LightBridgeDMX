// Composant racine de l'application React.
// Il empile les fournisseurs de contexte globaux autour du chassis du pupitre :
//  - AppDataProvider : donnees et actions partagees (projecteurs, DMX, HomeKit) ;
//  - SelectionProvider : selection courante de projecteurs (le "programmer") ;
//  - CommandProvider : ligne de commande partagee (barre du bas + pave de touches).
import { AppDataProvider } from "./contexts/AppDataContext";
import { CommandProvider } from "./contexts/CommandContext";
import { SelectionProvider } from "./contexts/SelectionContext";
import { AppShell } from "./shell/AppShell";

function App() {
  return (
    <AppDataProvider>
      <SelectionProvider>
        <CommandProvider>
          <AppShell />
        </CommandProvider>
      </SelectionProvider>
    </AppDataProvider>
  );
}

export default App;
