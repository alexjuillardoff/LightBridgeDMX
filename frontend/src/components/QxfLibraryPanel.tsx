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
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [libraryPath, setLibraryPath] = useState<string | null>(null);
  const [libraryMode, setLibraryMode] = useState<string | null>(null);
  const [libraryAddress, setLibraryAddress] = useState(1);
  const [libraryUniverse, setLibraryUniverse] = useState(0);
  const [libraryName, setLibraryName] = useState("");
  const [libraryNotice, setLibraryNotice] = useState("");

  const brands = useMemo(() => {
    const set = new Set<string>();
    libraryItems.forEach((item) => set.add(item.brand || item.path.split("/")[0] || "Inconnu"));
    return Array.from(set).sort();
  }, [libraryItems]);

  const filteredLibrary = useMemo(() => {
    if (brandFilter === "all") return libraryItems;
    return libraryItems.filter((item) => (item.brand || item.path.split("/")[0] || "Inconnu") === brandFilter);
  }, [brandFilter, libraryItems]);

  const selectedLibrary = useMemo(() => {
    if (!libraryPath) return null;
    return filteredLibrary.find((item) => item.path === libraryPath) ?? null;
  }, [filteredLibrary, libraryPath]);

  useEffect(() => {
    if (!libraryItems.length || libraryPath) return;
    setLibraryPath(libraryItems[0].path);
  }, [libraryItems, libraryPath]);

  useEffect(() => {
    if (!selectedLibrary) return;
    setLibraryMode((prev) => {
      if (prev && selectedLibrary.modes.some((m) => m.name === prev)) return prev;
      return selectedLibrary.modes[0]?.name ?? null;
    });
    setLibraryName((prev) => prev || `${selectedLibrary.manufacturer} ${selectedLibrary.model}`);
  }, [selectedLibrary]);

  const librarySuggestedName = useMemo(() => {
    if (!selectedLibrary || !libraryMode) return "";
    return `${selectedLibrary.manufacturer} ${selectedLibrary.model} (${libraryMode})`;
  }, [libraryMode, selectedLibrary]);

  const handleImport = async () => {
    if (!selectedLibrary || !libraryMode || !libraryPath) {
      setLibraryNotice("Sélectionne un projecteur dans la bibliothèque");
      return;
    }
    setLibraryNotice("");
    try {
      const created = await onImport({
        path: libraryPath,
        address: libraryAddress,
        universe: libraryUniverse,
        mode: libraryMode,
        name: libraryName || librarySuggestedName || undefined
      });
      setLibraryNotice(`Importé ${created.name}`);
    } catch (err) {
      setLibraryNotice((err as Error).message);
    }
  };

  const handleRefresh = async () => {
    try {
      await onRefresh();
      setLibraryNotice("Bibliothèque mise à jour depuis GitHub");
    } catch (err) {
      setLibraryNotice((err as Error).message);
    }
  };

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
      {selectedLibrary && libraryMode ? (
        <div style={{ marginTop: 12 }}>
          <p className="muted">
            {selectedLibrary.manufacturer} {selectedLibrary.model} · {libraryMode} ·{" "}
            {selectedLibrary.modes.find((m) => m.name === libraryMode)?.channelCount ?? "?"} canaux
          </p>
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
