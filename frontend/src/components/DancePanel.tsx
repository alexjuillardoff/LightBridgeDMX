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

  const stateQuery = useQuery<DanceState>(["dance", "state"], api.dance.state, {
    refetchInterval: 1500
  });
  const roomsQuery = useQuery<string[]>(["rooms"], api.rooms.list);
  const fixturesQuery = useQuery<Fixture[]>(["fixtures"], api.fixtures.list);
  const smartLightsQuery = useQuery<SmartLight[]>(["smart-lights"], api.smartLights.list);

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

  const state = stateQuery.data;
  const config = state?.config;
  const rooms = roomsQuery.data ?? [];
  const fixtures = fixturesQuery.data ?? [];
  const smartLights = smartLightsQuery.data ?? [];
  const running = state?.running ?? false;

  // Only smart lights that have a layout with labelled sides are useful for Dance —
  // each side becomes one chase group. Lights without sides are hidden from the picker.
  const danceableSmartLights = useMemo(
    () => smartLights.filter((l) => (l.zoneLayout?.sides?.length ?? 0) > 0),
    [smartLights]
  );

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

  // Fixtures eligible as lyre targets: non-lyre fixtures (no pan/tilt capability).
  const targetableFixtures = useMemo(
    () =>
      fixtures.filter(
        (f) => !f.channels.some((c) => c.capability === "pan" || c.capability === "tilt")
      ),
    [fixtures]
  );

  const positionForFixture = (fixtureId: string): DanceLyrePosition | undefined =>
    config?.lyre.positions.find((p) => p.fixtureId === fixtureId);

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

  const removePosition = (fixtureId: string) => {
    if (!config) return;
    updateConfig.mutate({
      lyre: {
        ...config.lyre,
        positions: config.lyre.positions.filter((p) => p.fixtureId !== fixtureId)
      }
    });
  };

  const toggleRoom = (room: string) => {
    if (!config) return;
    const next = config.rooms.includes(room)
      ? config.rooms.filter((r) => r !== room)
      : [...config.rooms, room];
    updateConfig.mutate({ rooms: next });
  };

  const togglePattern = (pattern: DancePatternId) => {
    if (!config) return;
    const next = config.patterns.includes(pattern)
      ? config.patterns.filter((p) => p !== pattern)
      : [...config.patterns, pattern];
    updateConfig.mutate({ patterns: next });
  };

  const toggleExcludedCap = (cap: string) => {
    if (!config) return;
    const has = (config.excludeCapabilities as string[]).includes(cap);
    const next = has
      ? config.excludeCapabilities.filter((c) => c !== cap)
      : [...config.excludeCapabilities, cap as DanceConfig["excludeCapabilities"][number]];
    updateConfig.mutate({ excludeCapabilities: next });
  };

  const setInterval = (field: "intervalMinMs" | "intervalMaxMs", value: number) => {
    if (!config) return;
    updateConfig.mutate({ [field]: value } as Partial<DanceConfig>);
  };

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
