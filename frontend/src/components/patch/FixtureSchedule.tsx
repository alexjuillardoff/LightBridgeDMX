// "Fixture Schedule" : la table du patch, telle qu'un pupitre grandMA la donne.
//
// L'ancienne table etait un affichage mort — nom, adresse, bouton Supprimer.
// Corriger une faute de frappe ou decaler une adresse de deux canaux imposait de
// supprimer le projecteur et de le recreer : nouvel id, donc disparition
// silencieuse de toutes les scenes deja enregistrees. Tout ce qui se modifie sur
// un pupitre se modifie donc ici, sur place :
//
//   - renommer directement dans la cellule (double-clic, comme MA2) ;
//   - editer la fiche complete (adresse, univers, piece, canaux, HomeKit) ;
//   - selectionner plusieurs projecteurs et les traiter en bloc : renommage
//     numerote, affectation a une piece, repatch a la suite, suppression ;
//   - dupliquer un projecteur sur la premiere adresse libre ;
//   - trier et filtrer, et surtout VOIR les conflits d'adresse en rouge.
//
// Le numero affiche en colonne ID est l'index global dans le patch, jamais la
// position dans le tri courant : c'est ce numero que comprennent la ligne de
// commande ("Fixture 4 At Full") et la fixture sheet.
import { useMemo, useState } from "react";
import { Copy, Lock, Pencil, Trash2 } from "lucide-react";
import { Fixture } from "@lightbridgedmx/shared";
import { useAppData } from "../../contexts/AppDataContext";
import { lockReason } from "../../lib/fixtureGuard";
import {
  PatchRow,
  SortDir,
  SortKey,
  buildConflictMap,
  channelSpan,
  fixtureTypeLabel,
  footprint,
  formatPatch,
  matchesQuery,
  nextFreeAddress,
  seriesName,
  sortRows
} from "../../lib/patch";
import { FixtureEditor } from "./FixtureEditor";

// Colonnes triables : libelle affiche + cle de tri.
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "Nom" },
  { key: "patch", label: "Patch" },
  { key: "room", label: "Pièce" },
  { key: "channels", label: "Canaux" }
];

export const FixtureSchedule = () => {
  const {
    fixtures,
    homekitFixtureIds,
    homekitStatus,
    mutations: { createFixture, deleteFixture, updateFixture, repatchFixtures },
    handleUpdateFixture,
    handleRepatchFixtures
  } = useAppData();

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Projecteur dont la fiche complete est ouverte.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Projecteur en cours de renommage dans la cellule (double-clic).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // Champs de la barre d'actions groupees.
  const [batchName, setBatchName] = useState("");
  const [batchRoom, setBatchRoom] = useState("");
  const [batchAddress, setBatchAddress] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Numero de patch de chaque projecteur : fige sur l'ordre de la liste, donc
  // insensible au tri et au filtre de l'affichage.
  const rows = useMemo<PatchRow[]>(
    () => fixtures.map((fixture, index) => ({ fixture, number: index + 1 })),
    [fixtures]
  );

  const visible = useMemo(
    () => sortRows(rows.filter((row) => matchesQuery(row.fixture, query)), sortKey, sortDir),
    [rows, query, sortKey, sortDir]
  );

  // Chevauchements d'adresses, recalcules a chaque changement du patch.
  const conflicts = useMemo(() => buildConflictMap(fixtures), [fixtures]);

  // Projecteurs selectionnes, dans l'ordre du patch : c'est cet ordre que
  // suivent le renommage numerote et le repatch a la suite.
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.fixture.id)),
    [rows, selected]
  );

  const editing = editingId ? fixtures.find((f) => f.id === editingId) ?? null : null;
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.fixture.id));

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelectAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((row) => row.fixture.id)));

  // Enveloppe commune des actions ecrivant sur le backend : un seul endroit ou
  // remettre l'indicateur d'activite a zero et ou capter le message d'erreur.
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ----- Renommage dans la cellule -----

  const startRename = (fixture: Fixture) => {
    setRenamingId(fixture.id);
    setDraftName(fixture.name);
  };

  const commitRename = async (fixture: Fixture) => {
    const name = draftName.trim();
    setRenamingId(null);
    // Nom vide ou inchange : on ne derange pas le backend.
    if (!name || name === fixture.name) return;
    await run(() => handleUpdateFixture(fixture, { name }));
  };

  // ----- Actions sur une ligne -----

  // Duplique un projecteur sur la premiere adresse libre de son univers.
  // C'est le geste qui sert a patcher une serie identique sans ressaisir les canaux.
  const duplicate = (fixture: Fixture) =>
    run(async () => {
      const address = nextFreeAddress({ fixtures, universe: fixture.universe, channels: fixture.channels });
      if (address === null) {
        throw new Error(`Aucune adresse libre dans l'univers ${fixture.universe} pour ${channelSpan(fixture.channels)} canaux.`);
      }
      await createFixture.mutateAsync({
        name: `${fixture.name} copie`,
        address,
        universe: fixture.universe,
        channels: fixture.channels,
        ...(fixture.room ? { room: fixture.room } : {}),
        ...(fixture.profile ? { profile: fixture.profile } : {})
      });
    });

  const remove = (fixture: Fixture) => {
    if (!window.confirm(`Supprimer ${fixture.name} ?`)) return;
    void run(async () => {
      await deleteFixture.mutateAsync(fixture);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(fixture.id);
        return next;
      });
    });
  };

  // ----- Actions groupees -----

  // Renomme la selection en serie : "PAR LED" -> "PAR LED 1", "PAR LED 2"...
  // Un seul projecteur selectionne garde le nom nu, comme sur un pupitre.
  const renameSeries = () => {
    const base = batchName.trim();
    if (!base) return;
    void run(async () => {
      for (let i = 0; i < selectedRows.length; i += 1) {
        const { fixture } = selectedRows[i];
        await handleUpdateFixture(fixture, { name: seriesName(base, i, selectedRows.length) });
      }
      setBatchName("");
    });
  };

  // Affecte (ou retire, si le champ est vide) la piece de toute la selection.
  // La piece pilote le regroupement de la fixture sheet et les garde-fous.
  const assignRoom = () => {
    const room = batchRoom.trim();
    void run(async () => {
      for (const { fixture } of selectedRows) {
        await handleUpdateFixture(fixture, { room: room || null });
      }
    });
  };

  // Repatche la selection a la suite, a partir d'une adresse donnee.
  // Un seul appel : le backend valide la disposition finale complete, sinon
  // deplacer A sur l'adresse encore occupee par B echouerait en cours de route.
  const repatchSeries = () => {
    const start = Number(batchAddress);
    if (!Number.isFinite(start) || start < 1 || start > 512) {
      setError("Adresse de départ invalide (1-512).");
      return;
    }
    void run(async () => {
      let cursor = start;
      const moves = selectedRows.map(({ fixture }) => {
        const move = { id: fixture.id, address: cursor, universe: fixture.universe };
        cursor += channelSpan(fixture.channels);
        return move;
      });
      if (cursor - 1 > 512) {
        throw new Error(`La série déborde de l'univers : elle irait jusqu'au canal ${cursor - 1}.`);
      }
      await handleRepatchFixtures(moves);
    });
  };

  const removeSelected = () => {
    if (!window.confirm(`Supprimer ${selectedRows.length} projecteur(s) ?`)) return;
    void run(async () => {
      for (const { fixture } of selectedRows) {
        await deleteFixture.mutateAsync(fixture);
      }
      setSelected(new Set());
    });
  };

  const pending =
    busy || updateFixture.isLoading || repatchFixtures.isLoading || createFixture.isLoading || deleteFixture.isLoading;

  if (!fixtures.length) {
    return <p className="muted">Aucun projecteur patché pour l'instant.</p>;
  }

  return (
    <div className="patch-schedule">
      {/* Barre d'outils : filtre texte et rappel de ce qui est affiche. */}
      <div className="patch-toolbar">
        <input
          className="patch-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrer par nom, pièce, adresse…"
          aria-label="Filtrer les projecteurs"
        />
        <span className="muted">
          {visible.length} / {fixtures.length} affiché(s)
          {conflicts.size ? ` · ${conflicts.size} en conflit` : ""}
        </span>
      </div>

      {/* Actions groupees : n'apparaissent qu'avec une selection, comme les
          fonctions d'un pupitre qui ne s'allument qu'une fois la selection faite. */}
      {selectedRows.length ? (
        <div className="patch-batch">
          <strong>{selectedRows.length} sélectionné(s)</strong>

          <div className="patch-batch-group">
            <input
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder="Nom de série"
              aria-label="Nom de série"
            />
            <button type="button" className="button-small" onClick={renameSeries} disabled={pending || !batchName.trim()}>
              Renommer
            </button>
          </div>

          <div className="patch-batch-group">
            <input
              value={batchRoom}
              onChange={(e) => setBatchRoom(e.target.value)}
              placeholder="Pièce"
              aria-label="Pièce à assigner"
            />
            <button type="button" className="button-small" onClick={assignRoom} disabled={pending}>
              Assigner
            </button>
          </div>

          <div className="patch-batch-group">
            <input
              type="number"
              min={1}
              max={512}
              value={batchAddress}
              onChange={(e) => setBatchAddress(e.target.value)}
              aria-label="Adresse de départ du repatch"
            />
            <button type="button" className="button-small" onClick={repatchSeries} disabled={pending}>
              Repatcher à la suite
            </button>
          </div>

          <div className="patch-batch-spacer" />
          <button type="button" className="button-small" onClick={() => setSelected(new Set())}>
            Désélectionner
          </button>
          <button type="button" className="button-danger button-small" onClick={removeSelected} disabled={pending}>
            Supprimer
          </button>
        </div>
      ) : null}

      {error ? <p className="patch-alert">{error}</p> : null}

      <table className="table patch-table">
        <thead>
          <tr>
            <th className="patch-col-check">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
                aria-label="Tout sélectionner"
              />
            </th>
            {COLUMNS.map((col) => (
              <th key={col.key}>
                <button
                  type="button"
                  className="patch-sort"
                  onClick={() => toggleSort(col.key)}
                  aria-label={`Trier par ${col.label}`}
                >
                  {col.label}
                  {sortKey === col.key ? <span aria-hidden="true">{sortDir === "asc" ? " ▲" : " ▼"}</span> : null}
                </button>
              </th>
            ))}
            <th>Type</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(({ fixture, number }) => {
            const rowConflicts = conflicts.get(fixture.id);
            const range = footprint(fixture);
            const locked = lockReason(fixture);
            const inHomeKit = homekitStatus?.enabled !== false && homekitFixtureIds.has(fixture.id);
            return (
              <tr key={fixture.id} className={rowConflicts ? "patch-row-conflict" : ""}>
                <td className="patch-col-check">
                  <input
                    type="checkbox"
                    checked={selected.has(fixture.id)}
                    onChange={() => toggleSelected(fixture.id)}
                    aria-label={`Sélectionner ${fixture.name}`}
                  />
                </td>

                <td data-label="ID" className="patch-col-id">
                  {number}
                </td>

                {/* Double-clic sur le nom : renommage sur place, comme MA2. */}
                <td data-label="Nom">
                  {renamingId === fixture.id ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => void commitRename(fixture)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename(fixture);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      aria-label={`Renommer ${fixture.name}`}
                    />
                  ) : (
                    <div className="patch-name" onDoubleClick={() => startRename(fixture)} title="Double-clic pour renommer">
                      <span>{fixture.name}</span>
                      {locked ? (
                        <Lock size={11} strokeWidth={2} aria-label={`Verrouillé : ${locked}`} />
                      ) : null}
                      {inHomeKit ? <span className="badge-pill">HomeKit</span> : null}
                    </div>
                  )}
                  {/* Le conflit se lit sur la ligne meme : pas besoin d'aller
                      chercher l'autre projecteur pour comprendre ce qui cloche. */}
                  {rowConflicts ? (
                    <small className="patch-conflict-note">
                      Conflit canal {rowConflicts[0].channels[0]} avec {rowConflicts.map((c) => c.name).join(", ")}
                    </small>
                  ) : null}
                </td>

                <td data-label="Patch" className="patch-col-patch">
                  <div>{formatPatch(fixture.universe, fixture.address)}</div>
                  <small className="muted">
                    {range.start}–{range.end}
                  </small>
                </td>

                <td data-label="Pièce">{fixture.room ?? <span className="muted">—</span>}</td>

                <td data-label="Canaux">
                  <div>{fixture.channels.length} ch</div>
                  <small className="muted">{fixture.channels.map((ch) => ch.name ?? ch.capability).join(", ")}</small>
                </td>

                <td data-label="Type">
                  <div>{fixtureTypeLabel(fixture)}</div>
                  {fixture.profile ? <small className="muted">{fixture.profile.mode}</small> : null}
                </td>

                <td data-label="Actions">
                  <div className="table-actions patch-actions">
                    <button
                      type="button"
                      className="button-small"
                      onClick={() => setEditingId(fixture.id)}
                      aria-label={`Éditer ${fixture.name}`}
                      title="Éditer la fiche"
                    >
                      <Pencil size={12} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="button-small"
                      onClick={() => void duplicate(fixture)}
                      disabled={pending}
                      aria-label={`Dupliquer ${fixture.name}`}
                      title="Dupliquer sur la première adresse libre"
                    >
                      <Copy size={12} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="button-danger button-small"
                      onClick={() => remove(fixture)}
                      disabled={pending}
                      aria-label={`Supprimer ${fixture.name}`}
                      title="Supprimer"
                    >
                      <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editing ? (
        <FixtureEditor
          fixture={editing}
          fixtures={fixtures}
          saving={updateFixture.isLoading}
          onClose={() => setEditingId(null)}
          onSave={async (patch) => {
            await handleUpdateFixture(editing, patch);
          }}
        />
      ) : null}
    </div>
  );
};
