// Fiche d'edition d'un projecteur — le "Edit Fixture" du Fixture Schedule MA2.
//
// La table du patch etait jusqu'ici en lecture seule : pour corriger un nom mal
// tape ou decaler une adresse de deux canaux, il fallait supprimer le projecteur
// et le recreer, ce qui lui donnait un nouvel id et le faisait disparaitre des
// scenes deja enregistrees. Cette fiche fait la vraie modification (PUT), qui
// preserve l'id.
//
// Elle montre aussi ce qu'un pupitre montre toujours pendant qu'on repatche :
// l'encombrement resultant, et le conflit AVANT de valider — le backend refuse
// les chevauchements (409), autant ne pas envoyer l'utilisateur dans le mur.
import { FormEvent, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Capability, CapabilitySchema, Fixture, FixtureChannel } from "@lightbridgedmx/shared";
import { channelSpan, footprint, formatPatch, nextFreeAddress, occupiedChannels } from "../../lib/patch";

// Toutes les capabilities reconnues, dans l'ordre du schema partage.
const CAPABILITIES = CapabilitySchema.options;

// Etat du formulaire. Les champs numeriques sont gardes en texte tant qu'on
// saisit : un input vide doit rester vide, pas retomber a 0 sous les doigts.
type EditorState = {
  name: string;
  room: string;
  universe: string;
  address: string;
  channels: FixtureChannel[];
  homekitEnabled: boolean;
  homekitName: string;
};

type FixtureEditorProps = {
  fixture: Fixture;
  // Tous les projecteurs : sert au calcul des conflits et de l'adresse libre.
  fixtures: Fixture[];
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  saving: boolean;
};

const toState = (fixture: Fixture): EditorState => ({
  name: fixture.name,
  room: fixture.room ?? "",
  universe: String(fixture.universe),
  address: String(fixture.address),
  channels: fixture.channels.map((ch) => ({ ...ch })),
  homekitEnabled: fixture.homekit?.enabled !== false,
  homekitName: fixture.homekit?.name ?? ""
});

export const FixtureEditor = ({ fixture, fixtures, onClose, onSave, saving }: FixtureEditorProps) => {
  const [form, setForm] = useState<EditorState>(() => toState(fixture));
  const [error, setError] = useState<string | null>(null);

  // Changer de projecteur sans fermer la fiche (fleches de la table) doit
  // recharger les champs, sinon on editerait l'ancien avec les nouveaux libelles.
  useEffect(() => {
    setForm(toState(fixture));
    setError(null);
  }, [fixture]);

  // Echap ferme la fiche, comme n'importe quelle boite de dialogue du pupitre.
  useEffect(() => {
    const onKey = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const universe = Number(form.universe) || 0;
  const address = Number(form.address) || 0;

  // Pieces deja utilisees : proposees en autocompletion pour eviter les
  // doublons d'orthographe ("Salon" / "salon" feraient deux groupes distincts).
  const rooms = useMemo(
    () => [...new Set(fixtures.map((f) => f.room?.trim()).filter((r): r is string => !!r))].sort((a, b) => a.localeCompare(b, "fr")),
    [fixtures]
  );

  // Verification live du patch envisage : chevauchement avec un autre
  // projecteur, ou depassement de l'univers (canal > 512).
  const check = useMemo(() => {
    if (address < 1 || !form.channels.length) return { conflicts: [] as string[], overflow: false, span: 0 };
    const taken = occupiedChannels(fixtures, universe, fixture.id);
    const hit = new Set<string>();
    form.channels.forEach((ch) => {
      const absolute = address + ch.channel - 1;
      if (!taken.has(absolute)) return;
      const owner = fixtures.find(
        (f) => f.universe === universe && f.id !== fixture.id && f.channels.some((c) => f.address + c.channel - 1 === absolute)
      );
      if (owner) hit.add(owner.name);
    });
    return {
      conflicts: [...hit],
      overflow: address + channelSpan(form.channels) - 1 > 512,
      span: channelSpan(form.channels)
    };
  }, [address, fixture.id, fixtures, form.channels, universe]);

  // Range absolu resultant, affiche en permanence : c'est le repere qu'on lit
  // pour verifier a la main sur le pupitre ou dans QLC+.
  const range = useMemo(() => {
    if (address < 1 || !form.channels.length) return null;
    return footprint({ address, universe, channels: form.channels });
  }, [address, form.channels, universe]);

  const patchField = (patch: Partial<EditorState>) => setForm((f) => ({ ...f, ...patch }));

  // Reaffecte le projecteur au premier trou libre de l'univers courant.
  const jumpToFreeAddress = () => {
    const free = nextFreeAddress({ fixtures, universe, channels: form.channels, ignoreId: fixture.id });
    if (free === null) {
      setError("Aucune adresse libre dans cet univers pour ce nombre de canaux.");
      return;
    }
    setError(null);
    patchField({ address: String(free) });
  };

  const updateChannel = (index: number, patch: Partial<FixtureChannel>) =>
    setForm((f) => ({
      ...f,
      channels: f.channels.map((ch, i) => (i === index ? { ...ch, ...patch } : ch))
    }));

  const addChannel = () =>
    setForm((f) => ({
      ...f,
      channels: [...f.channels, { channel: channelSpan(f.channels) + 1, capability: "other" as Capability }]
    }));

  const removeChannel = (index: number) =>
    setForm((f) => ({ ...f, channels: f.channels.filter((_, i) => i !== index) }));

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError("Le nom ne peut pas être vide.");
      return;
    }
    if (!form.channels.length) {
      setError("Un projecteur doit garder au moins un canal.");
      return;
    }
    if (address < 1 || address > 512) {
      setError("L'adresse de départ doit être comprise entre 1 et 512.");
      return;
    }
    // Les numeros de canaux relatifs doivent etre uniques : deux canaux "3"
    // se marcheraient dessus a l'interieur meme du projecteur.
    const numbers = form.channels.map((ch) => ch.channel);
    if (new Set(numbers).size !== numbers.length) {
      setError("Deux canaux portent le même numéro.");
      return;
    }

    try {
      await onSave({
        name: form.name.trim(),
        address,
        universe,
        // Canaux tries : la table du patch et les encodeurs les lisent dans l'ordre.
        channels: [...form.channels].sort((a, b) => a.channel - b.channel),
        // null (et non "") : c'est ainsi que l'API accepte de RETIRER la piece.
        room: form.room.trim() || null,
        homekit: {
          // On repart de la config existante pour ne pas perdre les overrides de
          // canaux (RGB ou lyre) regles ailleurs.
          ...fixture.homekit,
          enabled: form.homekitEnabled,
          name: form.homekitName.trim() || undefined
        }
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="patch-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="patch-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Éditer ${fixture.name}`}
        onMouseDown={(evt) => evt.stopPropagation()}
      >
        <div className="patch-modal-head">
          <strong>Éditer le projecteur</strong>
          <button type="button" className="patch-modal-close" onClick={onClose} aria-label="Fermer">
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <form className="patch-modal-body" onSubmit={handleSubmit}>
          <div className="patch-field-row">
            <label>
              Nom
              <input
                autoFocus
                value={form.name}
                onChange={(e) => patchField({ name: e.target.value })}
                placeholder="PAR LED salon"
              />
            </label>
            <label>
              Pièce
              <input
                list="patch-rooms"
                value={form.room}
                onChange={(e) => patchField({ room: e.target.value })}
                placeholder="Salon"
              />
              <datalist id="patch-rooms">
                {rooms.map((room) => (
                  <option key={room} value={room} />
                ))}
              </datalist>
            </label>
          </div>

          <div className="patch-field-row">
            <label>
              Univers
              <input
                type="number"
                min={0}
                value={form.universe}
                onChange={(e) => patchField({ universe: e.target.value })}
              />
            </label>
            <label>
              Adresse
              <input
                type="number"
                min={1}
                max={512}
                value={form.address}
                onChange={(e) => patchField({ address: e.target.value })}
              />
            </label>
            <div className="patch-field-action">
              <button type="button" className="button-small" onClick={jumpToFreeAddress}>
                Adresse libre
              </button>
            </div>
          </div>

          {/* Recapitulatif du patch resultant : ce qu'on relit pour verifier. */}
          <div className="patch-summary">
            <span>
              Patch <strong>{formatPatch(universe, address)}</strong>
            </span>
            {range ? (
              <span>
                Canaux <strong>{range.start}</strong> → <strong>{range.end}</strong> ({range.count} ch)
              </span>
            ) : null}
          </div>

          {check.overflow ? (
            <p className="patch-alert">
              Débordement : ce projecteur dépasserait le canal 512 de l'univers {universe}.
            </p>
          ) : null}
          {check.conflicts.length ? (
            <p className="patch-alert">
              Conflit d'adresse avec {check.conflicts.join(", ")} — le patch sera refusé.
            </p>
          ) : null}

          {/* Canaux : le "mode" du projecteur. Le role (capability) decide de ce
              que la console et HomeKit savent en faire (RGB, pan/tilt...). */}
          <div className="patch-channels">
            <div className="patch-channels-head">
              <strong>Canaux</strong>
              <button type="button" className="button-small" onClick={addChannel}>
                + Canal
              </button>
            </div>
            <table className="table patch-channels-table">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Rôle</th>
                  <th>Nom</th>
                  <th>Abs.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {form.channels.map((ch, index) => (
                  <tr key={index}>
                    <td data-label="N°">
                      <input
                        type="number"
                        min={1}
                        max={512}
                        value={ch.channel}
                        onChange={(e) => updateChannel(index, { channel: Number(e.target.value) })}
                      />
                    </td>
                    <td data-label="Rôle">
                      <select
                        value={ch.capability}
                        onChange={(e) => updateChannel(index, { capability: e.target.value as Capability })}
                      >
                        {CAPABILITIES.map((cap) => (
                          <option key={cap} value={cap}>
                            {cap}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Nom">
                      <input
                        value={ch.name ?? ""}
                        placeholder={ch.capability}
                        onChange={(e) => updateChannel(index, { name: e.target.value || undefined })}
                      />
                    </td>
                    <td data-label="Abs." className="patch-abs">
                      {address > 0 ? address + ch.channel - 1 : "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button-danger button-small"
                        onClick={() => removeChannel(index)}
                        disabled={form.channels.length <= 1}
                        aria-label={`Retirer le canal ${ch.channel}`}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Exposition HomeKit : le nom vu dans l'app Maison peut differer du
              nom du pupitre ("Salon" a la maison, "PAR 1" au patch). */}
          <div className="patch-homekit">
            <label className="patch-check">
              <input
                type="checkbox"
                checked={form.homekitEnabled}
                onChange={(e) => patchField({ homekitEnabled: e.target.checked })}
              />
              <span>Exposer dans HomeKit</span>
            </label>
            <label>
              Nom HomeKit
              <input
                value={form.homekitName}
                disabled={!form.homekitEnabled}
                onChange={(e) => patchField({ homekitName: e.target.value })}
                placeholder={form.name || fixture.name}
              />
            </label>
          </div>

          {error ? <p className="patch-alert">{error}</p> : null}

          <div className="patch-modal-actions">
            <button type="button" className="button-small" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
