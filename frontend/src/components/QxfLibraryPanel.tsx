// Panneau UI "Bibliotheque QXF".
// Laisse l'utilisateur parcourir la bibliotheque de projecteurs (fixtures) QLC+
// telechargee depuis GitHub, choisir une marque / un modele / un mode DMX, fixer
// l'adresse DMX et l'univers DMX, puis importer le tout comme nouveau projecteur.
// Composant purement presentationnel : les donnees et les actions (refresh,
// import) arrivent par les props ; il ne fait aucun appel reseau lui-meme.
import { useEffect, useMemo, useState } from "react";
import { Fixture, QxfLibraryFixture } from "@lightbridgedmx/shared";
import { clamp } from "../lib/math";

type QxfLibraryPanelProps = {
  libraryItems: QxfLibraryFixture[];
  isLoading: boolean;
  error?: Error | null;
  onRefresh: () => Promise<void> | void;
  refreshing: boolean;
  onImport: (payload: { path: string; address: number; universe: number; mode: string; name?: string }) => Promise<Fixture>;
  importLoading: boolean;
};

export const QxfLibraryPanel = ({
  libraryItems,
  isLoading,
  error,
  onRefresh,
  refreshing,
  onImport,
  importLoading
}: QxfLibraryPanelProps) => {
  // Etat du formulaire d'import : filtre marque, projecteur et mode choisis,
  // adresse DMX / univers DMX cibles, nom optionnel, et message d'info a afficher.
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [libraryPath, setLibraryPath] = useState<string | null>(null);
  const [libraryMode, setLibraryMode] = useState<string | null>(null);
  const [libraryAddress, setLibraryAddress] = useState(1);
  const [libraryUniverse, setLibraryUniverse] = useState(0);
  const [libraryName, setLibraryName] = useState("");
  const [libraryNotice, setLibraryNotice] = useState("");

  // Liste triee et dedoublonnee des marques presentes dans la bibliotheque.
  // Repli : si l'item n'a pas de marque, on prend le 1er segment de son chemin.
  const brands = useMemo(() => {
    const set = new Set<string>();
    libraryItems.forEach((item) => set.add(item.brand || item.path.split("/")[0] || "Inconnu"));
    return Array.from(set).sort();
  }, [libraryItems]);

  // Projecteurs visibles selon le filtre marque ("all" = aucun filtre).
  const filteredLibrary = useMemo(() => {
    if (brandFilter === "all") return libraryItems;
    return libraryItems.filter((item) => (item.brand || item.path.split("/")[0] || "Inconnu") === brandFilter);
  }, [brandFilter, libraryItems]);

  // Projecteur actuellement selectionne, retrouve par son chemin (path) unique.
  const selectedLibrary = useMemo(() => {
    if (!libraryPath) return null;
    return filteredLibrary.find((item) => item.path === libraryPath) ?? null;
  }, [filteredLibrary, libraryPath]);

  // Pre-selection : des que la bibliotheque arrive et qu'aucun projecteur n'est
  // choisi, on selectionne le premier pour eviter un formulaire vide.
  useEffect(() => {
    if (!libraryItems.length || libraryPath) return;
    setLibraryPath(libraryItems[0].path);
  }, [libraryItems, libraryPath]);

  // Quand le projecteur change, on cale le mode DMX et le nom par defaut.
  useEffect(() => {
    if (!selectedLibrary) return;
    setLibraryMode((prev) => {
      // On garde le mode precedent s'il existe encore sur ce projecteur,
      // sinon on retombe sur le premier mode disponible.
      if (prev && selectedLibrary.modes.some((m) => m.name === prev)) return prev;
      return selectedLibrary.modes[0]?.name ?? null;
    });
    // On ne propose un nom par defaut que si l'utilisateur n'a rien saisi.
    setLibraryName((prev) => prev || `${selectedLibrary.manufacturer} ${selectedLibrary.model}`);
  }, [selectedLibrary]);

  // Nom suggere (marque + modele + mode) utilise comme placeholder et repli.
  const librarySuggestedName = useMemo(() => {
    if (!selectedLibrary || !libraryMode) return "";
    return `${selectedLibrary.manufacturer} ${selectedLibrary.model} (${libraryMode})`;
  }, [libraryMode, selectedLibrary]);

  // Lance l'import du projecteur selectionne via la callback onImport (prop).
  const handleImport = async () => {
    // Garde-fou : on a besoin d'un projecteur, d'un mode et d'un chemin valides.
    if (!selectedLibrary || !libraryMode || !libraryPath) {
      setLibraryNotice("Sélectionne un projecteur dans la bibliothèque");
      return;
    }
    setLibraryNotice("");
    try {
      // Si le nom est vide, on retombe sur le nom suggere, puis sur undefined
      // (le backend utilisera alors le nom issu du fichier QXF).
      const created = await onImport({
        path: libraryPath,
        address: libraryAddress,
        universe: libraryUniverse,
        mode: libraryMode,
        name: libraryName || librarySuggestedName || undefined
      });
      setLibraryNotice(`Importé ${created.name}`);
    } catch (err) {
      // On affiche le message d'erreur tel quel a l'utilisateur.
      setLibraryNotice((err as Error).message);
    }
  };

  // Relance le telechargement de la bibliotheque QXF depuis GitHub (action rapide).
  const handleRefresh = async () => {
    try {
      await onRefresh();
      setLibraryNotice("Bibliothèque mise à jour depuis GitHub");
    } catch (err) {
      setLibraryNotice((err as Error).message);
    }
  };

  // ----- rendu du formulaire d'import -----
  return (
    <div className="card">
      <h2>Bibliothèque QXF</h2>
      <div className="form">
        <button type="button" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? "Mise à jour…" : "Mettre à jour depuis GitHub"}
        </button>
        <label>
          Marque
          <select
            value={brandFilter}
            onChange={(e) => {
              // Changer de marque invalide le projecteur choisi : on remet a zero
              // pour que l'effet de pre-selection repointe sur la nouvelle liste.
              setBrandFilter(e.target.value);
              setLibraryPath(null);
            }}
          >
            <option value="all">Toutes</option>
            {brands.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </select>
        </label>
        <label>
          Projecteur
          <select
            value={libraryPath ?? ""}
            onChange={(e) => {
              setLibraryPath(e.target.value || null);
              setLibraryNotice("");
            }}
          >
            <option value="">{isLoading ? "Chargement…" : "Sélectionne un projecteur téléchargé"}</option>
            {filteredLibrary.map((item) => (
              <option key={item.path} value={item.path}>
                {brandFilter === "all" ? `${item.manufacturer} ${item.model}` : item.model} ({item.modes.length} modes)
              </option>
            ))}
          </select>
        </label>
        <label>
          Mode DMX
          <select disabled={!selectedLibrary} value={libraryMode ?? ""} onChange={(e) => setLibraryMode(e.target.value || null)}>
            {selectedLibrary ? (
              selectedLibrary.modes.map((mode) => (
                <option key={mode.name} value={mode.name}>
                  {mode.name} · {mode.channelCount} ch
                </option>
              ))
            ) : (
              <option value="">Choisis un projecteur</option>
            )}
          </select>
        </label>
        <div className="input-inline">
          <label>
            Adresse
            <input
              type="number"
              min={1}
              max={512}
              value={libraryAddress}
              onChange={(e) => setLibraryAddress(clamp(Number(e.target.value), 1, 512))}
            />
          </label>
          <label>
            Universe
            <input
              type="number"
              min={0}
              value={libraryUniverse}
              onChange={(e) => setLibraryUniverse(Math.max(0, Number(e.target.value)))}
            />
          </label>
        </div>
        <label>
          Nom (optionnel)
          <input
            value={libraryName}
            onChange={(e) => setLibraryName(e.target.value)}
            placeholder={librarySuggestedName || "Utilise le nom du QXF"}
          />
        </label>
        <button type="button" onClick={handleImport} disabled={importLoading}>
          {importLoading ? "Import…" : "Créer ce fixture"}
        </button>
        {libraryNotice ? <small>{libraryNotice}</small> : null}
        {error ? <small>Impossible de charger la bibliothèque: {error.message}</small> : null}
      </div>
      {/* Apercu du projecteur selectionne : recap du mode + 8 premiers canaux. */}
      {selectedLibrary && libraryMode ? (
        <div style={{ marginTop: 12 }}>
          <p className="muted">
            {selectedLibrary.manufacturer} {selectedLibrary.model} · {libraryMode} ·{" "}
            {selectedLibrary.modes.find((m) => m.name === libraryMode)?.channelCount ?? "?"} canaux
          </p>
          {/* On n'affiche que les 8 premiers canaux ; au-dela on ajoute " …". */}
          <p className="muted">
            {selectedLibrary.modes
              .find((m) => m.name === libraryMode)
              ?.channels.slice(0, 8)
              .map((ch) => `${ch.channel}: ${ch.name} (${ch.capability})`)
              .join(" · ")}
            {(selectedLibrary.modes.find((m) => m.name === libraryMode)?.channels.length ?? 0) > 8 ? " …" : ""}
          </p>
        </div>
      ) : (
        <p className="muted">Télécharge automatiquement la librairie QLC+ complète et choisis un projecteur.</p>
      )}
    </div>
  );
};
