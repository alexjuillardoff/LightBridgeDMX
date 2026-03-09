import { Scene } from "@lightbridgedmx/shared";

type ScenesSectionProps = {
  scenes?: Scene[];
};

export const ScenesSection = ({ scenes }: ScenesSectionProps) => (
  <div className="card">
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
