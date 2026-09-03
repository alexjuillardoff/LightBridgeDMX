// Composant racine de l'application React.
// Il empile les fournisseurs de contexte globaux autour du chassis du pupitre.
// L'ordre est impose par les dependances entre eux :
//  - AppDataProvider  : donnees et actions partagees (projecteurs, DMX, HomeKit) ;
//  - SelectionProvider: selection courante de projecteurs (le "programmer"),
//                       qui lit le patch pour ecarter les projecteurs verrouilles ;
//  - ConsoleProvider  : pools du pupitre (groupes, executors, playbacks, presets),
//                       qui agit sur la selection ;
//  - CommandProvider  : ligne de commande partagee (barre du bas + rail de touches),
//                       qui delegue STORE / GO / OFF aux pools.
import { AppDataProvider } from "./contexts/AppDataContext";
import { CommandProvider } from "./contexts/CommandContext";
import { ConsoleProvider } from "./contexts/ConsoleContext";
import { SelectionProvider } from "./contexts/SelectionContext";
import { AppShell } from "./shell/AppShell";

function App() {
  return (
    <AppDataProvider>
      <SelectionProvider>
        <ConsoleProvider>
          <CommandProvider>
            <AppShell />
          </CommandProvider>
        </ConsoleProvider>
      </SelectionProvider>
    </AppDataProvider>
  );
}

export default App;
