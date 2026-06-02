// Composant d'affichage de la liste des scenes enregistrees.
// Une scene est un etat sauvegarde de plusieurs canaux/projecteurs que l'on
// peut rappeler. Ici on se contente de lister leurs noms, ou d'afficher un
// message si aucune scene n'existe encore.

import { Scene } from "@lightbridgedmx/shared";

type ScenesSectionProps = {
  scenes?: Scene[];
};

export const ScenesSection = ({ scenes }: ScenesSectionProps) => (
  <div className="card">
    {/* Si au moins une scene existe : liste des noms ; sinon : message vide. */}
    {scenes && scenes.length > 0 ? (
      <ul>
        {scenes.map((scene) => (
          <li key={scene.id}>{scene.name}</li>
        ))}
      </ul>
    ) : (
      <p className="muted">No scenes yet.</p>
    )}
  </div>
);
