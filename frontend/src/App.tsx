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
