// FixtureForm : ajout de projecteurs au patch — le "Add new fixtures" d'un pupitre.
//
// Il ne cree plus un projecteur a la fois : sur un plateau on patche des SERIES
// ("6 PAR LED a la suite"), et les faire un par un en recalculant l'adresse a la
// main est exactement le genre d'arithmetique qu'un pupitre fait pour vous. On
// saisit donc une quantite, et le formulaire place la serie a la suite en
// sautant les adresses deja occupees, avec des noms numerotes.
import { FormEvent, useMemo, useState } from "react";
import { Fixture, FixtureChannel } from "@lightbridgedmx/shared";
import { fixtureTemplates, FixtureTemplateKey } from "../lib/fixtureTemplates";
import { channelSpan, formatPatch, planSeriesAddresses, seriesName } from "../lib/patch";

// Contenu d'un projecteur a creer, tel que l'attend l'API.
export type NewFixturePayload = {
  name: string;
  address: number;
  universe: number;
  channels: FixtureChannel[];
  room?: string;
};

// Etat local du formulaire (champs saisis).
type FixtureFormState = {
  name: string;
  address: number;
  universe: number;
  quantity: number;
  room: string;
  template: FixtureTemplateKey;
};

type FixtureFormProps = {
  // Projecteurs deja patches : servent a placer la serie sans chevauchement.
  fixtures: Fixture[];
  onSubmit: (payloads: NewFixturePayload[]) => Promise<void> | void;
  isLoading: boolean;
  error?: Error | null;
};

// Valeurs par defaut a l'ouverture (et apres un ajout reussi).
const initialForm: FixtureFormState = {
  name: "",
  address: 1,
  universe: 0,
  quantity: 1,
  room: "",
  template: "rgb"
};

export const FixtureForm = ({ fixtures, onSubmit, isLoading, error }: FixtureFormProps) => {
  const [form, setForm] = useState<FixtureFormState>(initialForm);
  const [localError, setLocalError] = useState<string | null>(null);

  const template = fixtureTemplates[form.template];

  // Pieces deja utilisees, proposees en autocompletion : deux orthographes de la
  // meme piece feraient deux groupes distincts dans la fixture sheet.
  const rooms = useMemo(
    () =>
      [...new Set(fixtures.map((f) => f.room?.trim()).filter((r): r is string => !!r))].sort((a, b) =>
        a.localeCompare(b, "fr")
      ),
    [fixtures]
  );

  // Placement envisage, recalcule a chaque frappe : on montre AVANT de valider
  // les adresses que la serie va reellement occuper (elles sautent les trous).
  const plan = useMemo(() => {
    if (!template) return null;
    return planSeriesAddresses({
      fixtures,
      universe: Number(form.universe) || 0,
      channels: template.channels,
      count: Math.max(1, Number(form.quantity) || 1),
      from: Number(form.address) || 1
    });
  }, [fixtures, form.address, form.quantity, form.universe, template]);

  const patchField = (patch: Partial<FixtureFormState>) => setForm((f) => ({ ...f, ...patch }));

  // Place la serie sur le premier trou libre, sans partir d'une adresse choisie.
  const jumpToFreeAddress = () => {
    if (!template) return;
    const free = planSeriesAddresses({
      fixtures,
      universe: Number(form.universe) || 0,
      channels: template.channels,
      count: Math.max(1, Number(form.quantity) || 1),
      from: 1
    });
    if (!free) {
      setLocalError("Aucune place pour cette série dans cet univers.");
      return;
    }
    setLocalError(null);
    patchField({ address: free[0] });
  };

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    setLocalError(null);
    if (!template) return;
    if (!plan) {
      setLocalError("La série ne tient pas dans l'univers à partir de cette adresse.");
      return;
    }

    const base = form.name.trim() || `Fixture ${form.address}`;
    const room = form.room.trim();

    try {
      await onSubmit(
        plan.map((address, index) => ({
          name: seriesName(base, index, plan.length),
          address,
          universe: Number(form.universe),
          channels: template.channels,
          ...(room ? { room } : {})
        }))
      );
      // On garde l'univers, la piece et le modele : on patche rarement un seul
      // projecteur isole, et refaire les memes reglages a chaque ajout use.
      setForm((f) => ({ ...initialForm, universe: f.universe, room: f.room, template: f.template }));
    } catch {
      // Erreur geree en amont via l'etat de la mutation (on ne fait rien ici).
    }
  };

  return (
    <form className="form" onSubmit={handleSubmit}>
      <label>
        Nom
        <input
          required
          value={form.name}
          onChange={(e) => patchField({ name: e.target.value })}
          placeholder="PAR LED salon"
        />
      </label>

      <div className="patch-field-row">
        <label>
          Quantité
          <input
            type="number"
            min={1}
            max={64}
            value={form.quantity}
            onChange={(e) => patchField({ quantity: Number(e.target.value) })}
          />
        </label>
        <label>
          Adresse
          <input
            type="number"
            min={1}
            max={512}
            value={form.address}
            onChange={(e) => patchField({ address: Number(e.target.value) })}
          />
        </label>
        <label>
          Univers
          <input
            type="number"
            min={0}
            value={form.universe}
            onChange={(e) => patchField({ universe: Number(e.target.value) })}
          />
        </label>
        <div className="patch-field-action">
          <button type="button" className="button-small" onClick={jumpToFreeAddress}>
            Adresse libre
          </button>
        </div>
      </div>

      <label>
        Pièce
        <input
          list="patch-form-rooms"
          value={form.room}
          onChange={(e) => patchField({ room: e.target.value })}
          placeholder="Salon"
        />
        <datalist id="patch-form-rooms">
          {rooms.map((room) => (
            <option key={room} value={room} />
          ))}
        </datalist>
      </label>

      <label>
        Modèle
        <select
          value={form.template}
          onChange={(e) => patchField({ template: e.target.value as FixtureTemplateKey })}
        >
          {Object.entries(fixtureTemplates).map(([key, tpl]) => (
            <option key={key} value={key}>
              {tpl.label}
            </option>
          ))}
        </select>
      </label>

      {/* Recapitulatif du placement : ce qu'on relit avant de valider. */}
      {template ? (
        <div className="patch-summary">
          {plan ? (
            <span>
              {plan.length} × {channelSpan(template.channels)} ch →{" "}
              <strong>{formatPatch(form.universe, plan[0])}</strong>
              {plan.length > 1 ? (
                <>
                  {" … "}
                  <strong>{formatPatch(form.universe, plan[plan.length - 1])}</strong>
                </>
              ) : null}
            </span>
          ) : (
            <span className="patch-alert">Pas de place pour cette série dans l'univers {form.universe}.</span>
          )}
        </div>
      ) : null}

      <button type="submit" disabled={isLoading || !plan}>
        {isLoading ? "Ajout…" : form.quantity > 1 ? `Ajouter ${form.quantity} projecteurs` : "Ajouter le projecteur"}
      </button>
      {localError ? <small className="patch-alert">{localError}</small> : null}
      {error ? <small className="patch-alert">Échec : {error.message}</small> : null}
    </form>
  );
};
