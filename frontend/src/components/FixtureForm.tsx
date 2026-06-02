// FixtureForm : formulaire d'ajout d'un projecteur (fixture).
// L'utilisateur saisit un nom, une adresse DMX de depart, un univers DMX et choisit un modele
// (template) de canaux. A la validation, on envoie le tout au parent via onSubmit, puis on
// reinitialise le formulaire.
import { FormEvent, useState } from "react";
import { FixtureChannel } from "@lightbridgedmx/shared";
import { fixtureTemplates, FixtureTemplateKey } from "../lib/fixtureTemplates";

// Etat local du formulaire (champs saisis).
type FixtureFormState = {
  name: string;
  address: number;
  universe: number;
  template: FixtureTemplateKey;
};

type FixtureFormProps = {
  onSubmit: (payload: { name: string; address: number; universe: number; channels: FixtureChannel[] }) => Promise<void> | void;
  isLoading: boolean;
  error?: Error | null;
};

// Valeurs par defaut a l'ouverture (et apres un ajout reussi) : adresse 1, univers 0, modele RGB.
const initialForm: FixtureFormState = {
  name: "",
  address: 1,
  universe: 0,
  template: "rgb"
};

export const FixtureForm = ({ onSubmit, isLoading, error }: FixtureFormProps) => {
  const [form, setForm] = useState<FixtureFormState>(initialForm);

  // Validation du formulaire : on resout le modele de canaux choisi, on construit le contenu
  // (payload) et on le transmet au parent. En cas de succes, on remet le formulaire a zero.
  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    const template = fixtureTemplates[form.template];
    if (!template) return;

    try {
      await onSubmit({
        // Nom par defaut si l'utilisateur n'en saisit pas : "Fixture <adresse>".
        name: form.name || `Fixture ${form.address}`,
        address: Number(form.address),
        universe: Number(form.universe),
        channels: template.channels
      });
      setForm(initialForm);
    } catch {
      // Erreur geree en amont via l'etat de la mutation (on ne fait rien ici).
    }
  };

  return (
    <form className="form" onSubmit={handleSubmit}>
      <label>
        Name
        <input
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Back truss RGB"
        />
      </label>
      <label>
        Start address
        <input
          type="number"
          min={1}
          max={512}
          value={form.address}
          onChange={(e) => setForm((f) => ({ ...f, address: Number(e.target.value) }))}
        />
      </label>
      <label>
        Universe
        <input
          type="number"
          min={0}
          value={form.universe}
          onChange={(e) => setForm((f) => ({ ...f, universe: Number(e.target.value) }))}
        />
      </label>
      <label>
        Template
        <select
          value={form.template}
          onChange={(e) => setForm((f) => ({ ...f, template: e.target.value as FixtureTemplateKey }))}
        >
          {Object.entries(fixtureTemplates).map(([key, tpl]) => (
            <option key={key} value={key}>
              {tpl.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Adding…" : "Add fixture"}
      </button>
      {error ? <small>Failed: {error.message}</small> : null}
    </form>
  );
};
