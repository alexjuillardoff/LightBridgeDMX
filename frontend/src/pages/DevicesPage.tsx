// Vue "Appareils" : inventaire unifie de tout ce que LightBridge voit sur le reseau.
//
// Contrairement aux autres vues, qui ne montrent qu'un backend a la fois, celle-ci
// agrege tout — projecteurs DMX, lampes connectees, prises, ponts HomeKit, fabrics
// Matter — et affiche AUSSI ce qui n'est pas pilotable, avec la raison. C'est le
// point de depart quand on se demande "pourquoi ma lampe n'apparait nulle part ?".
//
// Le backend fait toute l'agregation (GET /api/devices) ; ici on ne fait que
// regrouper par famille et mettre en forme.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DeviceCategory, DeviceInventoryEntry } from "@lightbridgedmx/shared";
import { Boxes, Lightbulb, PlugZap, RadioTower, Router, Sliders } from "lucide-react";
import { api } from "../lib/api";
import { withoutHiddenFixtures } from "../lib/hiddenFixtures";

// Familles affichees, dans l'ordre : du plus pilotable au plus lointain.
const GROUPS: { category: DeviceCategory; label: string; icon: typeof Sliders }[] = [
  { category: "dmx", label: "Projecteurs DMX", icon: Sliders },
  { category: "smart-light", label: "Lampes connectées", icon: Lightbulb },
  { category: "plug", label: "Prises", icon: PlugZap },
  { category: "bridge", label: "Ponts et passerelles", icon: Router },
  { category: "unknown", label: "Détectés, non identifiables", icon: RadioTower }
];

// Filtre haut de page : tout, ou seulement l'un des deux camps.
type Filter = "all" | "controllable" | "blocked";

/** Pastille d'etat d'une ligne. Trois cas distincts, a ne pas confondre :
 *   - vert  : pilotable et joignable ;
 *   - ambre : pilotable mais jamais teste (DMX, qui n'a pas de voie de retour) ;
 *   - gris  : pas pilotable, ou injoignable. */
const StatusLed = ({ entry }: { entry: DeviceInventoryEntry }) => {
  const cls = !entry.controllable
    ? "ma-led-off"
    : entry.reachable === false
      ? "ma-led-off"
      : entry.reachable === null
        ? "ma-led-warn"
        : "ma-led-on";
  const title = !entry.controllable
    ? "Non pilotable"
    : entry.reachable === false
      ? "Injoignable"
      : entry.reachable === null
        ? "Joignabilité inconnue"
        : "Joignable";
  return <span className={`ma-led ${cls}`} title={title} aria-label={title} />;
};

/** Une ligne d'appareil. Les non-pilotables sont grises et portent leur raison. */
const DeviceRow = ({
  entry,
  onPair,
  pairingHost,
  pairError
}: {
  entry: DeviceInventoryEntry;
  onPair: (host: string) => void;
  pairingHost: string | null;
  pairError: { host: string; message: string } | null;
}) => {
  const isPairing = pairingHost === entry.actionHost;
  const error = pairError && pairError.host === entry.actionHost ? pairError.message : null;

  return (
    <li className={`dev-row ${entry.controllable ? "" : "dev-row-blocked"}`}>
      <StatusLed entry={entry} />
      <div className="dev-main">
        <div className="dev-head">
          <span className="dev-name">{entry.name}</span>
          {entry.room ? <span className="dev-room">{entry.room}</span> : null}
          {entry.address ? <code className="dev-addr">{entry.address}</code> : null}
        </div>
        <div className="dev-sub">
          <span className="dev-transport">{entry.transport}</span>
          {entry.detail ? <span className="dev-detail">· {entry.detail}</span> : null}
        </div>
        {/* La raison n'existe que pour les non-pilotables : c'est tout l'interet
            de la vue, expliquer l'absence plutot que de la passer sous silence. */}
        {entry.reason ? <p className="dev-reason">{entry.reason}</p> : null}
        {error ? <p className="dev-error">{error}</p> : null}
      </div>
      {entry.action === "pair" && entry.actionHost ? (
        <button
          type="button"
          className="pill"
          disabled={isPairing}
          onClick={() => onPair(entry.actionHost as string)}
          title="Maintiens le bouton power de l'appareil ~5 s (la LED pulse), puis clique"
        >
          {isPairing ? "Appairage…" : "Appairer"}
        </button>
      ) : null}
    </li>
  );
};

export const DevicesPage = () => {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [pairError, setPairError] = useState<{ host: string; message: string } | null>(null);
  const [pairingHost, setPairingHost] = useState<string | null>(null);

  // Lecture : sert le cache backend, donc instantane. Le scan reseau est explicite.
  const inventory = useQuery(["devices"], api.devices.list);

  // Scan mDNS : quelques secondes d'ecoute des annonces du reseau.
  const scan = useMutation(() => api.devices.scan({ timeoutMs: 6000 }), {
    onSuccess: (data) => queryClient.setQueryData(["devices"], data)
  });

  // Appairage d'un Nanoleaf detecte. L'appareil doit etre en mode appairage :
  // sinon il repond 403 et on affiche la marche a suivre sur la ligne concernee.
  const pair = useMutation((host: string) => api.smartLights.pair({ host }), {
    onMutate: (host) => {
      setPairingHost(host);
      setPairError(null);
    },
    onSuccess: () => {
      // La lampe rejoint les appareils pilotes : on rafraichit les deux listes.
      void queryClient.invalidateQueries(["devices"]);
      void queryClient.invalidateQueries(["smart-lights"]);
    },
    onError: (err, host) =>
      setPairError({
        host,
        message: `${(err as Error).message} — maintiens le bouton power ~5 s jusqu'à ce que la LED pulse, puis réessaie.`
      }),
    onSettled: () => setPairingHost(null)
  });

  const devices = useMemo(
    () => withoutHiddenFixtures(inventory.data?.devices ?? []),
    [inventory.data]
  );

  const visible = useMemo(
    () =>
      devices.filter((d) =>
        filter === "all" ? true : filter === "controllable" ? d.controllable : !d.controllable
      ),
    [devices, filter]
  );

  const controllableCount = devices.filter((d) => d.controllable).length;
  const scannedAt = inventory.data?.scannedAt;

  return (
    <>
      <div className="section-title">
        <h2>Appareils</h2>
        <span className="muted">
          {devices.length > 0
            ? `${controllableCount} pilotable${controllableCount > 1 ? "s" : ""} sur ${devices.length} détecté${devices.length > 1 ? "s" : ""}`
            : "Tout ce que LightBridge voit sur le réseau, pilotable ou non"}
        </span>
      </div>

      <div className="filter-pills" role="tablist" aria-label="Filtre de l'inventaire">
        {(
          [
            ["all", "Tous"],
            ["controllable", "Pilotables"],
            ["blocked", "Non pilotables"]
          ] as [Filter, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={`pill ${filter === id ? "pill-active" : ""}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="muted dev-scan-age">
          {scannedAt
            ? `Scan : ${new Date(scannedAt).toLocaleTimeString("fr-FR")}`
            : "Aucun scan réseau"}
        </span>
        <button
          type="button"
          className="pill pill-with-icon"
          disabled={scan.isLoading}
          onClick={() => scan.mutate()}
          title="Réinterroge le réseau en mDNS (~6 s)"
        >
          <Boxes size={14} strokeWidth={2} aria-hidden="true" />
          <span>{scan.isLoading ? "Scan…" : "Rescanner"}</span>
        </button>
      </div>

      {inventory.isLoading ? <p className="muted">Chargement de l'inventaire…</p> : null}
      {inventory.error ? (
        <p className="dev-error">{(inventory.error as Error).message}</p>
      ) : null}
      {!scannedAt && !scan.isLoading && !inventory.isLoading ? (
        <p className="muted">
          Aucun scan réseau n'a encore tourné : seuls les appareils déjà enregistrés sont listés.
          Clique sur <strong>Rescanner</strong> pour découvrir le reste.
        </p>
      ) : null}

      {/* Une carte par famille. Les familles vides après filtrage sont masquées. */}
      {GROUPS.map((group) => {
        const rows = visible.filter((d) => d.category === group.category);
        if (rows.length === 0) return null;
        const Icon = group.icon;
        return (
          <div className="card" key={group.category} style={{ marginTop: 10 }}>
            <h2>
              <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
              {group.label}
              <span className="dev-count">{rows.length}</span>
            </h2>
            <ul className="dev-list">
              {rows.map((entry) => (
                <DeviceRow
                  key={entry.id}
                  entry={entry}
                  onPair={(host) => pair.mutate(host)}
                  pairingHost={pairingHost}
                  pairError={pairError}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
};
