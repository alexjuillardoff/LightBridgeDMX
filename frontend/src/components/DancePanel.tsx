// Panneau React du "Mode Dance" : strobe coordonne avec des patterns spatiaux
// (chenillards, vagues, paires...) sur les projecteurs, la lyre et les lampes connectees.
// L'UI lit/ecrit la config Dance via l'API backend (React Query) et affiche l'etat live.
// Tout le pilotage reel est fait cote backend ; ce fichier ne fait que la configuration.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DanceConfig,
  DanceLyrePosition,
  DancePatternId,
  DancePatternIds,
  DanceState,
  Fixture,
  SmartLight
} from "@lightbridgedmx/shared";
import { api } from "../lib/api";

// Libelles FR affiches dans l'UI pour chaque pattern de chase (les ids restent en anglais).
const PATTERN_LABELS: Record<DancePatternId, string> = {
  chase: "Chase L→R",
  reverseChase: "Chase R→L",
  pingPong: "Ping-pong",
  waveLR: "Vague L→R",
  waveRL: "Vague R→L",
  alternate: "Alternance pair/impair",
  pairs: "Paires",
  randomSubset: "Sous-ensembles random",
  allHit: "Full hit (1 flash commun)",
  strobeSync: "Strobe synchrone (rafale)",
  bookendIn: "Extérieurs ↔ Intérieurs",
  bookendOut: "Intérieurs ↔ Extérieurs"
};

// Liste des capabilities (fonctions de canal) qu'on peut choisir d'exclure du strobe.
// Sert a alimenter les boutons de la section "Exclusions".
const CAPABILITY_OPTIONS = [
  "intensity",
  "r",
  "g",
  "b",
  "w",
  "uv",
  "strobe",
  "colorTemp",
  "color",
  "gobo",
  "beam",
  "effect",
  "speed",
  "prism",
  "focus",
  "maintenance",
  "other"
] as const;

export const DancePanel = () => {
  const queryClient = useQueryClient();

  // Etat live du Mode Dance : on le rafraichit toutes les 1,5 s pour afficher
  // le pattern courant, le nombre de phases envoyees, etc. pendant que ca tourne.
  const stateQuery = useQuery<DanceState>(["dance", "state"], api.dance.state, {
    refetchInterval: 1500
  });
  // Donnees de reference servant a construire les selecteurs de l'UI.
  const roomsQuery = useQuery<string[]>(["rooms"], api.rooms.list);
  const fixturesQuery = useQuery<Fixture[]>(["fixtures"], api.fixtures.list);
  const smartLightsQuery = useQuery<SmartLight[]>(["smart-lights"], api.smartLights.list);

  // Mutations : chaque action renvoie l'etat Dance complet, qu'on reinjecte
  // directement dans le cache React Query pour un retour visuel immediat.
  const updateConfig = useMutation<DanceState, Error, Partial<DanceConfig>>(
    (patch) => api.dance.updateConfig(patch),
    {
      onSuccess: (state) => queryClient.setQueryData(["dance", "state"], state)
    }
  );
  const startDance = useMutation<DanceState, Error, void>(() => api.dance.start(), {
    onSuccess: (state) => queryClient.setQueryData(["dance", "state"], state)
  });
  const stopDance = useMutation<DanceState, Error, void>(() => api.dance.stop(), {
    onSuccess: (state) => queryClient.setQueryData(["dance", "state"], state)
  });

  // Raccourcis vers les donnees chargees, avec valeurs par defaut tant que ca charge.
  const state = stateQuery.data;
  const config = state?.config;
  const rooms = roomsQuery.data ?? [];
  const fixtures = fixturesQuery.data ?? [];
  const smartLights = smartLightsQuery.data ?? [];
  const running = state?.running ?? false;

  // Seules les lampes connectees ayant un layout avec des cotes nommes servent au Dance :
  // chaque cote devient un groupe du chase. Les lampes sans cotes sont masquees du selecteur.
  const danceableSmartLights = useMemo(
    () => smartLights.filter((l) => (l.zoneLayout?.sides?.length ?? 0) > 0),
    [smartLights]
  );

  // Ajoute ou retire une lampe connectee de la selection (bascule par id).
  const toggleSmartLight = (id: string) => {
    if (!config) return;
    const has = config.smartLights.lightIds.includes(id);
    const lightIds = has
      ? config.smartLights.lightIds.filter((x) => x !== id)
      : [...config.smartLights.lightIds, id];
    updateConfig.mutate({
      smartLights: { ...config.smartLights, lightIds }
    });
  };

  // Projecteurs (fixtures) que la lyre peut viser : on exclut les lyres elles-memes,
  // c.-a-d. tout projecteur ayant une capability pan ou tilt.
  const targetableFixtures = useMemo(
    () =>
      fixtures.filter(
        (f) => !f.channels.some((c) => c.capability === "pan" || c.capability === "tilt")
      ),
    [fixtures]
  );

  // Retrouve la position pan/tilt enregistree pour viser un projecteur donne (si elle existe).
  const positionForFixture = (fixtureId: string): DanceLyrePosition | undefined =>
    config?.lyre.positions.find((p) => p.fixtureId === fixtureId);

  // Cree ou met a jour la position d'ancrage pan/tilt d'un projecteur (upsert).
  // On conserve l'axe non touche : si on ne change que le pan, le tilt existant est garde.
  const upsertPosition = (fixtureId: string, patch: Partial<Pick<DanceLyrePosition, "pan" | "tilt">>) => {
    if (!config) return;
    const existing = positionForFixture(fixtureId);
    const next: DanceLyrePosition = {
      fixtureId,
      pan: patch.pan ?? existing?.pan ?? 0,
      tilt: patch.tilt ?? existing?.tilt ?? 0
    };
    const others = config.lyre.positions.filter((p) => p.fixtureId !== fixtureId);
    updateConfig.mutate({ lyre: { ...config.lyre, positions: [...others, next] } });
  };

  // Supprime l'ancre d'un projecteur : sa position sera alors extrapolee depuis les autres.
  const removePosition = (fixtureId: string) => {
    if (!config) return;
    updateConfig.mutate({
      lyre: {
        ...config.lyre,
        positions: config.lyre.positions.filter((p) => p.fixtureId !== fixtureId)
      }
    });
  };

  // Bascule une piece dans/hors du filtre de ciblage.
  const toggleRoom = (room: string) => {
    if (!config) return;
    const next = config.rooms.includes(room)
      ? config.rooms.filter((r) => r !== room)
      : [...config.rooms, room];
    updateConfig.mutate({ rooms: next });
  };

  // Active ou desactive un pattern de chase dans la rotation.
  const togglePattern = (pattern: DancePatternId) => {
    if (!config) return;
    const next = config.patterns.includes(pattern)
      ? config.patterns.filter((p) => p !== pattern)
      : [...config.patterns, pattern];
    updateConfig.mutate({ patterns: next });
  };

  // Bascule une capability dans la liste des canaux a ne jamais flasher pendant le Dance.
  const toggleExcludedCap = (cap: string) => {
    if (!config) return;
    const has = (config.excludeCapabilities as string[]).includes(cap);
    const next = has
      ? config.excludeCapabilities.filter((c) => c !== cap)
      : [...config.excludeCapabilities, cap as DanceConfig["excludeCapabilities"][number]];
    updateConfig.mutate({ excludeCapabilities: next });
  };

  // Met a jour une des deux bornes de l'intervalle aleatoire entre flashs (en ms).
  const setInterval = (field: "intervalMinMs" | "intervalMaxMs", value: number) => {
    if (!config) return;
    updateConfig.mutate({ [field]: value } as Partial<DanceConfig>);
  };

  // Premier message d'erreur disponible parmi les mutations/queries, pour l'afficher a l'utilisateur.
  const errorMessage = useMemo(() => {
    const e =
      (updateConfig.error as Error | null) ||
      (startDance.error as Error | null) ||
      (stopDance.error as Error | null) ||
      (stateQuery.error as Error | null);
    return e?.message;
  }, [updateConfig.error, startDance.error, stopDance.error, stateQuery.error]);

  return (
    <div className="card" style={{ gridColumn: "1 / -1" }}>
      {/* En-tete : titre + badge d'etat (en cours / arrete) + bouton Demarrer/Arreter. */}
      {/* On ne peut demarrer que si au moins une piece est ciblee OU la lyre est activee. */}
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <div>
          <h2>Mode Dance</h2>
          <p className="muted">Strobe coordonné avec patterns spatiaux sur les fixtures sélectionnées.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={`badge ${running ? "badge-on" : ""}`}>
            {running ? `▶ En cours · ${state?.phasesSent ?? 0} phases` : "■ Arrêté"}
          </span>
          {running ? (
            <button
              onClick={() => stopDance.mutate()}
              disabled={stopDance.isLoading}
              className="btn-danger"
            >
              {stopDance.isLoading ? "Arrêt…" : "Arrêter"}
            </button>
          ) : (
            <button
              onClick={() => startDance.mutate()}
              disabled={
                startDance.isLoading ||
                !config ||
                (config.rooms.length === 0 && !config.lyre.enabled)
              }
              className="btn-primary"
            >
              {startDance.isLoading ? "Démarrage…" : "Démarrer"}
            </button>
          )}
        </div>
      </div>

      {errorMessage ? <p className="muted">Erreur : {errorMessage}</p> : null}

      {!config ? (
        <p className="muted">Chargement…</p>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {/* ----- Section : pieces ciblees -----
              Filtre par piece : seuls les projecteurs des pieces selectionnees participent au Dance. */}
          <section>
            <h3 style={{ margin: "0 0 8px" }}>Pièces ciblées</h3>
            {rooms.length === 0 ? (
              <p className="muted">
                Aucune fixture n'a de champ <code>room</code>. Édite tes fixtures pour leur attribuer une pièce.
              </p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {rooms.map((room) => {
                  const active = config.rooms.includes(room);
                  return (
                    <button
                      key={room}
                      onClick={() => toggleRoom(room)}
                      className={`pill ${active ? "pill-active" : ""}`}
                      type="button"
                    >
                      {active ? "✓ " : ""}
                      {room}
                    </button>
                  );
                })}
              </div>
            )}
            {config.rooms.length === 0 && !config.lyre.enabled ? (
              <p className="muted" style={{ marginTop: 6 }}>
                Sélectionne au moins une pièce, ou active la lyre, pour pouvoir démarrer.
              </p>
            ) : null}
          </section>

          {/* ----- Section : vitesse -----
              Deux curseurs qui bornent l'intervalle aleatoire (ms) entre deux flashs : min = rapide, max = lent. */}
          <section>
            <h3 style={{ margin: "0 0 8px" }}>Vitesse (intervalle aléatoire entre flashs)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 60px", gap: 8, alignItems: "center" }}>
              <label>Min ({config.intervalMinMs} ms)</label>
              <input
                type="range"
                min={1}
                max={500}
                step={1}
                value={config.intervalMinMs}
                onChange={(e) => setInterval("intervalMinMs", Number(e.target.value))}
              />
              <span className="muted">rapide</span>
              <label>Max ({config.intervalMaxMs} ms)</label>
              <input
                type="range"
                min={1}
                max={1000}
                step={1}
                value={config.intervalMaxMs}
                onChange={(e) => setInterval("intervalMaxMs", Number(e.target.value))}
              />
              <span className="muted">lent</span>
            </div>
          </section>

          {/* ----- Section : patterns -----
              Cases a cocher pour choisir quels patterns de chase entrent dans la rotation. */}
          <section>
            <h3 style={{ margin: "0 0 8px" }}>Patterns activés</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
              {DancePatternIds.map((pid) => {
                const checked = config.patterns.includes(pid);
                return (
                  <label key={pid} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePattern(pid)}
                    />
                    {PATTERN_LABELS[pid]}
                  </label>
                );
              })}
            </div>
          </section>

          {/* ----- Section : lyre -----
              Inclut la lyre (moving head) dans le strobe. Principe : on maintient le shutter ouvert
              et on pulse le dimmer au rythme du pattern. La lyre devient alors un groupe a droite
              de la chaine spatiale. Cette section est independante du filtre par piece. */}
          <section>
            <h3 style={{ margin: "0 0 8px" }}>Lyre (shutter ouvert + dimmer pulsé)</h3>
            <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={config.lyre.enabled}
                onChange={(e) =>
                  updateConfig.mutate({
                    lyre: { ...config.lyre, enabled: e.target.checked }
                  })
                }
              />
              Inclure la lyre dans le strobe
            </label>
            <p className="muted" style={{ marginBottom: 4 }}>
              Shutter maintenu ouvert + dimmer toggled par le pattern (devient un groupe à droite de la chaîne spatiale). Indépendant du filtre par pièce.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "180px 1fr 60px",
                gap: 8,
                alignItems: "center"
              }}
            >
              <label>Shutter ouvert ({config.lyre.shutterOpenValue})</label>
              <input
                type="range"
                min={0}
                max={255}
                step={1}
                value={config.lyre.shutterOpenValue}
                disabled={!config.lyre.enabled}
                onChange={(e) =>
                  updateConfig.mutate({
                    lyre: { ...config.lyre, shutterOpenValue: Number(e.target.value) }
                  })
                }
              />
              <span className="muted">DMX</span>
              <label>Dimmer ON ({config.lyre.dimmerOnValue})</label>
              <input
                type="range"
                min={0}
                max={255}
                step={1}
                value={config.lyre.dimmerOnValue}
                disabled={!config.lyre.enabled}
                onChange={(e) =>
                  updateConfig.mutate({
                    lyre: { ...config.lyre, dimmerOnValue: Number(e.target.value) }
                  })
                }
              />
              <span className="muted">brillance</span>
            </div>
            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "180px 1fr 60px",
                gap: 8,
                alignItems: "center"
              }}
            >
              <label>Vitesse lyre ({config.lyre.speedValue})</label>
              <input
                type="range"
                min={0}
                max={255}
                step={1}
                value={config.lyre.speedValue}
                disabled={!config.lyre.enabled}
                onChange={(e) =>
                  updateConfig.mutate({
                    lyre: { ...config.lyre, speedValue: Number(e.target.value) }
                  })
                }
              />
              <span className="muted">0 = rapide</span>
              <label>ms / unité pan ({config.lyre.msPerPanUnit} ms)</label>
              <input
                type="range"
                min={1}
                max={200}
                step={1}
                value={config.lyre.msPerPanUnit}
                disabled={!config.lyre.enabled}
                onChange={(e) =>
                  updateConfig.mutate({
                    lyre: { ...config.lyre, msPerPanUnit: Number(e.target.value) }
                  })
                }
              />
              <span className="muted">cadence</span>
            </div>
            <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>
              <strong>Vitesse lyre</strong> : canal DMX "Response speed" (vitesse mécanique).{" "}
              <strong>ms / unité pan</strong> : temps que la lyre met pour parcourir 1 unité DMX (mesuré:
              Lava→Café = 10 unités ≈ 400 ms → ~40 ms/unité). Pendant un déplacement, le dimmer et le
              shutter sont coupés (blackout) pour éviter le "spotlight volant".
            </p>
            <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 12 }}>
              <input
                type="checkbox"
                checked={config.lyre.followChase}
                disabled={!config.lyre.enabled}
                onChange={(e) =>
                  updateConfig.mutate({
                    lyre: { ...config.lyre, followChase: e.target.checked }
                  })
                }
              />
              Lyre suit le chase (pan/tilt vise le groupe actif)
            </label>
            {/* Si "followChase" est actif, la lyre pointe vers le groupe en cours d'allumage.
                On saisit ici les ancres pan/tilt connues ; les projecteurs sans ancre sont
                positionnes par extrapolation lineaire a partir des positions saisies. */}
            {config.lyre.followChase ? (
              <div style={{ marginTop: 10 }}>
                <p className="muted" style={{ marginBottom: 6 }}>
                  Positions pan/tilt pour viser chaque fixture (auto-seedées pour Café et Lava). Les
                  fixtures sans position héritent d'une extrapolation linéaire à partir des positions
                  connues.
                </p>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fixture</th>
                      <th style={{ width: "30%" }}>Pan</th>
                      <th style={{ width: "30%" }}>Tilt</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {targetableFixtures.map((f) => {
                      const pos = positionForFixture(f.id);
                      return (
                        <tr key={f.id}>
                          <td>
                            {f.name}
                            {f.room ? <span className="muted"> · {f.room}</span> : null}
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              max={255}
                              value={pos?.pan ?? ""}
                              placeholder="—"
                              style={{ width: 80 }}
                              disabled={!config.lyre.enabled}
                              onChange={(e) => {
                                const v = e.target.value === "" ? 0 : Number(e.target.value);
                                upsertPosition(f.id, { pan: v });
                              }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              max={255}
                              value={pos?.tilt ?? ""}
                              placeholder="—"
                              style={{ width: 80 }}
                              disabled={!config.lyre.enabled}
                              onChange={(e) => {
                                const v = e.target.value === "" ? 0 : Number(e.target.value);
                                upsertPosition(f.id, { tilt: v });
                              }}
                            />
                          </td>
                          <td>
                            {pos ? (
                              <button
                                type="button"
                                className="pill"
                                onClick={() => removePosition(f.id)}
                              >
                                Effacer
                              </button>
                            ) : (
                              <span className="muted">extrapolé</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ marginTop: 10 }}>
                  <h4 style={{ margin: "0 0 4px" }}>Ancre &quot;bout du mur droite&quot;</h4>
                  <p className="muted" style={{ marginBottom: 6 }}>
                    Position visuelle séparée, au-delà du dernier fixture. Sert d&apos;ancre supplémentaire pour
                    l&apos;interpolation par morceaux à droite (au-delà de Café/Lava).
                  </p>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <label>
                      Pan
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={config.lyre.wallEdgeRight?.pan ?? ""}
                        placeholder="—"
                        style={{ width: 80, marginLeft: 6 }}
                        disabled={!config.lyre.enabled}
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                          updateConfig.mutate({
                            lyre: {
                              ...config.lyre,
                              wallEdgeRight: {
                                pan: v,
                                tilt: config.lyre.wallEdgeRight?.tilt ?? 9
                              }
                            }
                          });
                        }}
                      />
                    </label>
                    <label>
                      Tilt
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={config.lyre.wallEdgeRight?.tilt ?? ""}
                        placeholder="—"
                        style={{ width: 80, marginLeft: 6 }}
                        disabled={!config.lyre.enabled}
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                          updateConfig.mutate({
                            lyre: {
                              ...config.lyre,
                              wallEdgeRight: {
                                pan: config.lyre.wallEdgeRight?.pan ?? 20,
                                tilt: v
                              }
                            }
                          });
                        }}
                      />
                    </label>
                    {config.lyre.wallEdgeRight ? (
                      <button
                        type="button"
                        className="pill"
                        onClick={() =>
                          updateConfig.mutate({
                            lyre: { ...config.lyre, wallEdgeRight: null }
                          })
                        }
                        disabled={!config.lyre.enabled}
                      >
                        Désactiver
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {/* ----- Section : lampes connectees -----
              Chaque cote du layout 3D d'un bandeau LED devient un groupe du chase.
              Les zones flashent dans la couleur ambiante courante du strip.
              NB : ne marche que si le streaming UDP de la lampe est active (sinon affiche "streaming OFF"). */}
          <section>
            <h3 style={{ margin: "0 0 8px" }}>Lampes connectées</h3>
            <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={config.smartLights.enabled}
                onChange={(e) =>
                  updateConfig.mutate({
                    smartLights: { ...config.smartLights, enabled: e.target.checked }
                  })
                }
              />
              Inclure les lampes connectées dans le chase
            </label>
            <p className="muted" style={{ marginBottom: 6 }}>
              Chaque <strong>côté</strong> du layout (ex: backRightFloor, frontFloorLToR…)
              devient un groupe du chase. Les zones flashent dans la couleur ambiante
              courante du strip. Requiert le streaming activé.
            </p>
            {danceableSmartLights.length === 0 ? (
              <p className="muted">
                Aucune lampe connectée avec un layout 3D et des côtés nommés. Configure le
                layout d'une lampe dans l'onglet <strong>Lampes connectées</strong> pour
                qu'elle apparaisse ici.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {danceableSmartLights.map((light) => {
                  const checked = config.smartLights.lightIds.includes(light.id);
                  const sides = light.zoneLayout?.sides?.length ?? 0;
                  const streaming = light.streaming?.enabled === true;
                  return (
                    <label
                      key={light.id}
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        opacity: config.smartLights.enabled ? 1 : 0.6
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!config.smartLights.enabled}
                        onChange={() => toggleSmartLight(light.id)}
                      />
                      <span>
                        <strong>{light.name}</strong>
                        {light.room ? <span className="muted"> · {light.room}</span> : null}
                        <span className="muted">
                          {" · "}
                          {sides} côté{sides > 1 ? "s" : ""}
                        </span>
                        {!streaming ? (
                          <span className="muted" style={{ color: "#c44" }}>
                            {" · "}streaming OFF (activer dans Lampes)
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          {/* ----- Section : exclusions -----
              Empeche certains canaux d'etre flashes. Exclure pan/tilt est recommande pour les lyres,
              sinon elles bougeraient au rythme du strobe. On peut aussi exclure d'autres capabilities. */}
          <section>
            <h3 style={{ margin: "0 0 8px" }}>Exclusions</h3>
            <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={config.excludePanTilt}
                onChange={(e) => updateConfig.mutate({ excludePanTilt: e.target.checked })}
              />
              Exclure les canaux pan / tilt (recommandé pour lyres)
            </label>
            <p className="muted" style={{ marginBottom: 4 }}>Capabilities supplémentaires à ne jamais flasher :</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CAPABILITY_OPTIONS.map((cap) => {
                const active = (config.excludeCapabilities as string[]).includes(cap);
                return (
                  <button
                    key={cap}
                    onClick={() => toggleExcludedCap(cap)}
                    className={`pill ${active ? "pill-active" : ""}`}
                    type="button"
                  >
                    {active ? "✓ " : ""}
                    {cap}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ----- Section : etat live -----
              Affiche le pattern courant et le nombre de groupes actifs, mis a jour via le refetch a 1,5 s. */}
          {state ? (
            <section>
              <h3 style={{ margin: "0 0 8px" }}>État live</h3>
              <p className="muted">
                Pattern en cours : <strong>{state.currentPattern ?? "—"}</strong>
                {" · "}Groupes actifs : <strong>{state.activeFixtureIds.length}</strong>
              </p>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
};
