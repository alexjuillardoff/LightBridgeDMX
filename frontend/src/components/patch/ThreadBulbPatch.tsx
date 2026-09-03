// Ajout automatise d'une ampoule HomeKit-sur-Thread, dans la vue Patch.
//
// Ajouter une de ces ampoules demandait sept etapes reparties entre un terminal et
// trois onglets. Ce panneau les ramene a deux gestes, dans l'ordre naturel :
//
//   1. APPAIRER  — l'ampoule quitte la maison Apple et rejoint LightBridge.
//      Seule etape qui ne peut PAS etre entierement automatisee : elle exige le
//      Bluetooth, et macOS ne l'accorde jamais a un service sans interface. Le
//      backend fait donc executer le script par Terminal.app, et l'utilisateur
//      reinitialise l'ampoule pendant la recherche.
//
//   2. PATCHER   — declaration de la lampe, recherche d'une adresse DMX libre,
//      creation du projecteur, pose du miroir, exposition HomeKit. Entierement
//      automatique : un clic.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fixture } from "@lightbridgedmx/shared";
import { Bluetooth, Lightbulb, Plus } from "lucide-react";
import { api } from "../../lib/api";

type Props = {
  /** Noms des ampoules Thread vues sur le reseau, pour pre-remplir l'appairage. */
  detectedNames: string[];
  /** Projecteurs existants, pour proposer un rattachement plutot qu'un doublon. */
  fixtures: Fixture[];
};

export const ThreadBulbPatch = ({ detectedNames, fixtures }: Props) => {
  const queryClient = useQueryClient();
  const [pairName, setPairName] = useState("");
  const [pairPin, setPairPin] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rattachement choisi par candidat : "" = nouvelle adresse automatique.
  const [attachTo, setAttachTo] = useState<Record<string, string>>({});

  // Les candidats apparaissent apres un appairage reussi : on interroge
  // regulierement pour que le panneau se mette a jour sans action de l'utilisateur.
  const candidates = useQuery(["thread-candidates"], api.threadLights.candidates, {
    refetchInterval: 10000
  });

  const adopt = useMutation(api.threadLights.adopt, {
    onSuccess: (data) => {
      setError(null);
      setNotice(
        data.address === null
          ? `« ${data.light.name} » déclarée, sans adresse DMX.`
          : `« ${data.light.name} » patchée sur les canaux ${data.address}-${data.address + 3}.`
      );
      void queryClient.invalidateQueries(["thread-candidates"]);
      void queryClient.invalidateQueries(["smart-lights"]);
      void queryClient.invalidateQueries(["fixtures"]);
      void queryClient.invalidateQueries(["devices"]);
    },
    onError: (err) => setError((err as Error).message)
  });

  const pair = useMutation(api.threadLights.pair, {
    onSuccess: (data) => {
      setError(null);
      setNotice(data.message);
      setPairPin("");
    },
    onError: (err) => setError((err as Error).message)
  });

  const ready = candidates.data?.candidates ?? [];
  const sidecarDown = candidates.data?.sidecarUp === false;

  return (
    <div className="card" style={{ marginTop: 10 }}>
      <h2>
        <Lightbulb size={14} strokeWidth={2.2} aria-hidden="true" />
        Ampoules Thread
      </h2>

      {/* Le sidecar est le seul chemin vers ces ampoules : s'il est arrete, rien
          d'autre n'a de sens et on le dit avant tout le reste. */}
      {sidecarDown ? (
        <p className="dev-error" style={{ marginTop: 0 }}>
          {candidates.data?.message}
        </p>
      ) : null}

      {/* ── Étape 2 en premier : c'est celle qui aboutit ─────────────────── */}
      <h3 className="thread-step">Prêtes à patcher</h3>
      {ready.length === 0 ? (
        <p className="muted" style={{ margin: "2px 0 8px" }}>
          Aucune ampoule appairée en attente. Appaire-en une ci-dessous.
        </p>
      ) : (
        <ul className="dev-list">
          {ready.map((c) => (
            <li className="dev-row" key={c.alias}>
              <span
                className={`ma-led ${c.reachable ? "ma-led-on" : "ma-led-off"}`}
                title={c.reachable ? "Joignable" : "Injoignable"}
              />
              <div className="dev-main">
                <div className="dev-head">
                  <span className="dev-name">{c.name}</span>
                  <code className="dev-addr">{c.alias}</code>
                </div>
                <div className="dev-sub">
                  {/* Rattacher plutot que creer, quand un projecteur existe deja :
                      sinon on obtient deux entrees pour une seule ampoule. */}
                  <label>
                    <span className="muted">Adresse : </span>
                    <select
                      value={attachTo[c.alias] ?? ""}
                      onChange={(e) =>
                        setAttachTo((prev) => ({ ...prev, [c.alias]: e.target.value }))
                      }
                    >
                      <option value="">nouvelle, automatique</option>
                      {fixtures.map((f) => (
                        <option key={f.id} value={f.id}>
                          rattacher à « {f.name} » (ch. {f.address})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <button
                type="button"
                className="pill pill-with-icon"
                disabled={adopt.isLoading}
                onClick={() =>
                  adopt.mutate({
                    alias: c.alias,
                    name: c.name,
                    fixtureId: attachTo[c.alias] || undefined
                  })
                }
              >
                <Plus size={13} strokeWidth={2.4} aria-hidden="true" />
                <span>{adopt.isLoading ? "Patch…" : "Patcher"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── Étape 1 : l'appairage, avec ses contraintes physiques ────────── */}
      <h3 className="thread-step">Appairer une ampoule</h3>
      <p className="muted" style={{ margin: "2px 0 6px", fontSize: 11, lineHeight: 1.5 }}>
        Relève d'abord le <strong>code à 8 chiffres</strong> dans l'app Maison (accessoire →
        réglages → bas de page). Sans lui, une ampoule réinitialisée n'est réappairable
        nulle part. Une fenêtre Terminal s'ouvrira : le Bluetooth est inaccessible au
        service, seule une application graphique peut l'obtenir.
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input
          list="thread-detected"
          value={pairName}
          onChange={(e) => setPairName(e.target.value)}
          placeholder="Nanoleaf A19 XXXX"
          style={{ flex: "1 1 200px" }}
        />
        <datalist id="thread-detected">
          {detectedNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <input
          value={pairPin}
          onChange={(e) => setPairPin(e.target.value)}
          placeholder="code à 8 chiffres"
          inputMode="numeric"
          style={{ flex: "0 1 140px" }}
        />
        <button
          type="button"
          className="pill pill-with-icon"
          disabled={!pairName || pairPin.replace(/\D/g, "").length !== 8 || pair.isLoading}
          onClick={() => pair.mutate({ name: pairName.trim(), pin: pairPin })}
        >
          <Bluetooth size={13} strokeWidth={2.4} aria-hidden="true" />
          <span>{pair.isLoading ? "Lancement…" : "Appairer"}</span>
        </button>
      </div>

      {notice ? (
        <p className="muted" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
          {notice}
        </p>
      ) : null}
      {error ? <p className="dev-error">{error}</p> : null}
    </div>
  );
};
