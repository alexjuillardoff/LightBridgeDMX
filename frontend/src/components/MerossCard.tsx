// Carte de configuration + etat de la prise connectee Meross (Reglages).
// La prise est pilotee en LOCAL sur le LAN : on saisit son IP, sa device key et le
// canal, on persiste cote backend (SQLite) et le service est reconfigure a chaud.
// Un changement de valeur DMX sur les projecteurs surveilles allume la prise.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MerossStatus } from "@lightbridgedmx/shared";
import { api } from "../lib/api";

export const MerossCard = () => {
  const queryClient = useQueryClient();
  const statusQuery = useQuery<MerossStatus>(["meross", "status"], api.meross.status);

  // Etat local du formulaire, initialise depuis le statut backend.
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [key, setKey] = useState("");
  const [channel, setChannel] = useState(0);
  // Vrai tant que l'utilisateur n'a pas touche au formulaire : on se laisse alors
  // re-synchroniser depuis le backend (premier chargement / apres enregistrement).
  const [pristine, setPristine] = useState(true);
  const [testResult, setTestResult] = useState<{ reachable: boolean; on: boolean | null; error: string | null } | null>(
    null
  );

  const status = statusQuery.data;

  // Synchronise le formulaire avec le backend tant que l'utilisateur n'a rien modifie.
  useEffect(() => {
    if (status && pristine) {
      setEnabled(status.enabled);
      setHost(status.host);
      setKey(status.key);
      setChannel(status.channel);
    }
  }, [status, pristine]);

  const saveMutation = useMutation(() => api.meross.update({ enabled, host, key, channel }), {
    onSuccess: (next) => {
      queryClient.setQueryData(["meross", "status"], next);
      setPristine(true);
      setTestResult(null);
    }
  });

  const testMutation = useMutation(api.meross.test, {
    onSuccess: (result) => {
      setTestResult(result);
      void queryClient.invalidateQueries(["meross", "status"]);
    }
  });

  // Marque le formulaire comme modifie quand l'utilisateur edite un champ.
  const touch = () => {
    if (pristine) setPristine(false);
  };

  // Libelle + classe du badge d'etat global.
  const badge = status?.active ? "Actif" : status?.enabled ? "Incomplet" : "Désactivé";

  return (
    <div className="card grid-span-full">
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div>
          <h2>Prise Meross</h2>
          <p className="muted">Allumée automatiquement quand un projecteur surveillé change (pilotage local LAN)</p>
        </div>
        <span className={`badge ${status?.active ? "badge-on" : ""}`}>{badge}</span>
      </div>

      {statusQuery.isLoading ? <p className="muted">Chargement du statut…</p> : null}
      {statusQuery.error ? (
        <p className="muted">Erreur : {(statusQuery.error as Error).message}</p>
      ) : null}

      {/* Formulaire de configuration. */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 8 }}>
        <label>
          Adresse IP de la prise
          <input
            type="text"
            inputMode="decimal"
            placeholder="192.168.0.xxx"
            value={host}
            onChange={(e) => {
              touch();
              setHost(e.target.value);
            }}
          />
        </label>
        <label>
          Device key Meross
          <input
            type="text"
            placeholder="clef récupérée du compte Meross"
            value={key}
            onChange={(e) => {
              touch();
              setKey(e.target.value);
            }}
          />
        </label>
        <label>
          Canal
          <input
            type="number"
            min={0}
            max={31}
            value={channel}
            onChange={(e) => {
              touch();
              setChannel(Number(e.target.value));
            }}
          />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={enabled}
            onChange={(e) => {
              touch();
              setEnabled(e.target.checked);
            }}
          />
          Activé
        </label>
      </div>

      <div className="flex-between" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn-primary"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isLoading}
          >
            {saveMutation.isLoading ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button
            className="button-small"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isLoading}
          >
            {testMutation.isLoading ? "Test…" : "Tester la connexion"}
          </button>
        </div>
      </div>

      {saveMutation.error ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Échec de l'enregistrement : {(saveMutation.error as Error).message}
        </p>
      ) : null}

      {/* Resultat du test de connexion. */}
      {testResult ? (
        <p className="muted" style={{ marginTop: 8 }}>
          {testResult.reachable
            ? `Prise joignable — actuellement ${testResult.on ? "allumée" : "éteinte"}.`
            : `Injoignable${testResult.error ? ` : ${testResult.error}` : ""}.`}
        </p>
      ) : null}

      {/* Synthese de l'etat courant cote backend. */}
      {status ? (
        <dl className="kv" style={{ marginTop: 12 }}>
          <div>
            <dt>État prise</dt>
            <dd>
              <span className={`badge ${status.on ? "badge-on" : ""}`}>
                {status.on === null ? "Inconnu" : status.on ? "Allumée" : "Éteinte"}
              </span>
            </dd>
          </div>
          <div>
            <dt>Joignable</dt>
            <dd>{status.reachable === null ? "—" : status.reachable ? "Oui" : "Non"}</dd>
          </div>
          <div>
            <dt>Projecteurs surveillés</dt>
            <dd>{status.watchedFixtures.join(", ") || "—"}</dd>
          </div>
          <div>
            <dt>Canaux surveillés</dt>
            <dd>{status.watchedChannelCount}</dd>
          </div>
          {status.lastError ? (
            <div>
              <dt>Dernière erreur</dt>
              <dd>{status.lastError}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
};
