// Vue "Live" : l'écran principal du pupitre.
//
// Auparavant, cette vue empilait Encoders, Fixture Sheet, Fader View et
// Executors dans une seule colonne défilante, avec une barre d'ancres pour se
// rattraper. Ce n'est pas ainsi qu'on se sert d'un pupitre : on ne fait pas
// défiler une console, on regarde plusieurs fenêtres en même temps parce que la
// sélection, les encodeurs et les executors s'utilisent ensemble.
//
// La vue est donc devenue un plan de travail (`Workspace`) : des fenêtres qu'on
// déplace, redimensionne et range dans des Views rappelables. Toute la logique
// est dans components/console.
import { Workspace } from "../components/console/Workspace";

const LivePage = () => <Workspace />;

export default LivePage;
