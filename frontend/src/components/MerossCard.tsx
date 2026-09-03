// Carte de configuration + etat de la prise connectee Meross (Reglages).
// La prise est pilotee en LOCAL sur le LAN : on saisit son IP, sa device key et le
// canal, on persiste cote backend (SQLite) et le service est reconfigure a chaud.
// Un changement de valeur DMX sur les projecteurs surveilles allume la prise.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MerossConsumption, MerossConsumptionDay, MerossStatus } from "@lightbridgedmx/shared";
import { api } from "../lib/api";

// Profondeur de l'histogramme de consommation (la prise garde ~30 jours).
const CHART_DAYS = 14;

// Formate un compte a rebours en ms vers "Xm Ys" (ou "Ys" sous la minute).
const formatCountdown = (ms: number): string => {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} min ${s}s` : `${s}s`;
};

// Formate une puissance en watts : une decimale sous 100 W, entier au-dela.
const formatPower = (w: number): string =>
  (w < 100 ? w.toFixed(1) : Math.round(w).toString()).replace(".", ",");

// Formate une energie : Wh en dessous de 1 kWh, kWh au-dela.
const formatEnergy = (wh: number): { value: string; unit: string } =>
  wh >= 1000
    ? { value: (wh / 1000).toFixed(2).replace(".", ","), unit: "kWh" }
    : { value: Math.round(wh).toString(), unit: "Wh" };

// "2026-09-03" -> "3 sept." (libelle court pour l'axe et le survol).
const formatDay = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};

// Date du jour au format de l'historique, pour reperer la barre encore partielle.
const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const MerossCard = () => {
  const queryClient = useQueryClient();
  // Rafraichissement leger : garde l'etat de la prise et le compte a rebours d'extinction a jour.
  const statusQuery = useQuery<MerossStatus>(["meross", "status"], api.meross.status, {
    refetchInterval: 15000
  });

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

  // Historique journalier : le backend le met en cache 1 min, on le repolle doucement.
  const consumptionQuery = useQuery<MerossConsumption | null>(["meross", "consumption"], api.meross.consumption, {
    refetchInterval: 60000
  });
  // Jour survole dans l'histogramme (etiquette directe ponctuelle).
  const [hoveredDay, setHoveredDay] = useState<MerossConsumptionDay | null>(null);

  const status = statusQuery.data;
  const consumption = consumptionQuery.data ?? null;
  const chartDays = consumption ? consumption.days.slice(-CHART_DAYS) : [];
  // Le maximum de la fenetre donne l'echelle verticale (affichee dans l'en-tete).
  const maxWh = chartDays.reduce((max, d) => Math.max(max, d.wh), 0);
  const windowWh = chartDays.reduce((sum, d) => sum + d.wh, 0);
  const today = todayIso();

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
      <h2>
        Prise Meross
        <span className={`badge ${status?.active ? "badge-on" : ""}`} style={{ marginLeft: "auto" }}>
          {badge}
        </span>
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Allumée automatiquement quand un projecteur surveillé change (pilotage local LAN)
      </p>

      {statusQuery.isLoading ? <p className="muted">Chargement du statut…</p> : null}
      {statusQuery.error ? (
        <p className="muted">Erreur : {(statusQuery.error as Error).message}</p>
      ) : null}

      {/* Metrologie : mesures instantanees (prises MSS310/MSS315...) et energie
          consommee. Le bloc disparait si la prise n'a pas de compteur ou ne
          repond pas. */}
      {status?.electricity || consumption ? (
        <dl className="meter-tiles">
          {status?.electricity ? (
            <div className="meter-tile">
              <dt>Puissance</dt>
              <dd>
                {formatPower(status.electricity.power)}
                <span className="meter-unit">W</span>
              </dd>
            </div>
          ) : null}
          {consumption && consumption.todayWh !== null ? (
            <div className="meter-tile">
              <dt>Aujourd'hui</dt>
              <dd>
                {formatEnergy(consumption.todayWh).value}
                <span className="meter-unit">{formatEnergy(consumption.todayWh).unit}</span>
              </dd>
            </div>
          ) : null}
          {chartDays.length ? (
            <div className="meter-tile">
              <dt>{chartDays.length} jours</dt>
              <dd>
                {formatEnergy(windowWh).value}
                <span className="meter-unit">{formatEnergy(windowWh).unit}</span>
              </dd>
            </div>
          ) : null}
          {status?.electricity ? (
            <div className="meter-tile">
              <dt>Tension</dt>
              <dd>
                {Math.round(status.electricity.voltage)}
                <span className="meter-unit">V</span>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {/* Histogramme de la consommation journaliere. Une seule serie : pas de
          legende, l'echelle est donnee par le maximum affiche dans l'en-tete et
          la valeur exacte d'un jour apparait au survol. */}
      {chartDays.length ? (
        <div className="meter-chart">
          <div className="meter-chart-head">
            <span>Consommation journalière</span>
            <span className="meter-chart-readout">
              {hoveredDay
                ? `${formatDay(hoveredDay.date)} — ${Math.round(hoveredDay.wh)} Wh`
                : `max ${Math.round(maxWh)} Wh`}
            </span>
          </div>
          <div
            className="meter-bars"
            onMouseLeave={() => setHoveredDay(null)}
            role="img"
            aria-label={`Consommation journalière du ${formatDay(chartDays[0].date)} au ${formatDay(
              chartDays[chartDays.length - 1].date
            )}, maximum ${Math.round(maxWh)} Wh`}
          >
            {chartDays.map((day) => (
              <div
                key={day.date}
                className={`meter-bar ${day.date === today ? "meter-bar-partial" : ""}`}
                title={`${formatDay(day.date)} : ${Math.round(day.wh)} Wh${
                  day.date === today ? " (en cours)" : ""
                }`}
                onMouseEnter={() => setHoveredDay(day)}
              >
                {/* Barre ancree sur la ligne de base ; 2 % minimum pour qu'une
                    journee non nulle reste visible. */}
                <div
                  className="meter-bar-fill"
                  style={{ height: maxWh > 0 && day.wh > 0 ? `${Math.max(2, (day.wh / maxWh) * 100)}%` : 0 }}
                />
              </div>
            ))}
          </div>
          <div className="meter-bars-axis">
            <span>{formatDay(chartDays[0].date)}</span>
            <span>
              {chartDays[chartDays.length - 1].date === today
                ? "aujourd'hui (partiel)"
                : formatDay(chartDays[chartDays.length - 1].date)}
            </span>
          </div>
        </div>
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
          {/* Pas de largeur en style inline : la feuille gère déjà les cases à
              cocher (et les agrandit sur écran tactile). Un style inline gagne
              sur toute règle CSS et bloquait cet agrandissement. */}
          <input
            type="checkbox"
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
          <div>
            <dt>Extinction auto</dt>
            <dd>
              {status.offWatchedChannelCount} canaux à 0 pendant {Math.round(status.offTimeoutMs / 60000)} min
              {status.offCountdownMs !== null
                ? ` — coupure dans ${formatCountdown(status.offCountdownMs)}`
                : ""}
            </dd>
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
