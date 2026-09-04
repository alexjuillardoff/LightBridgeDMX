// Fenêtre Effets du pupitre : le pool d'effets paramétriques (façon grandMA2)
// appliqué aux bandeaux LED connectés.
//
// Elle remplace l'ancienne fenêtre « Dance ». La différence de fond : Dance était
// un chenillard codé en dur, alors qu'ici on pose une forme d'onde, une vitesse et
// une phase répartie sur les zones — et, quand la lampe a un layout 3D, sur leur
// position réelle dans la pièce.
//
// Le panneau de réglage lui-même (EffectDesigner) est celui de la vue Réseau : une
// seule implémentation, deux endroits où l'ouvrir.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SmartLight } from "@lightbridgedmx/shared";
import { api } from "../../../lib/api";
import { EffectDesigner } from "../../smart-lights/EffectDesigner";

export const EffectsWindow = () => {
  const queryClient = useQueryClient();
  // Même clé de cache que la vue Réseau : les deux fenêtres restent d'accord.
  const lightsQuery = useQuery<SmartLight[]>(["smart-lights"], api.smartLights.list);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const lights = lightsQuery.data ?? [];
  // Seules les lampes à zones savent jouer ces effets : une ampoule n'a qu'une
  // couleur, il n'y a pas de phase à répartir.
  //
  // On ne filtre PAS sur `streaming.enabled` : un bandeau dont le streaming est coupé
  // reste un bandeau, et appliquer un effet le rallume désormais tout seul. Le masquer
  // ici donnait la panne la plus déroutante qui soit — le pupitre affichait « aucun
  // bandeau » alors que le ruban était bien là, patché et alimenté.
  const strips = lights.filter(
    (l) => (l.zoneLayout?.segments.length ?? 0) > 0 || !!l.dmxMirror?.zones || !!l.streaming
  );
  const light = strips.find((l) => l.id === selectedId) ?? strips[0] ?? null;

  // Après application d'un effet, on rafraîchit la lampe dans le cache partagé.
  const onUpdated = (updated: SmartLight) => {
    queryClient.setQueryData<SmartLight[]>(["smart-lights"], (prev = []) =>
      prev.map((l) => (l.id === updated.id ? updated : l))
    );
  };

  if (lightsQuery.isLoading) {
    return <p className="muted" style={{ fontSize: 13, padding: 10 }}>Chargement des bandeaux…</p>;
  }
  if (!light) {
    return (
      <p className="muted" style={{ fontSize: 13, padding: 10 }}>
        Aucun bandeau LED à zones déclaré. Ajoute une lampe et expose-la en projecteur DMX
        dans Réseau → Lampes connectées.
      </p>
    );
  }

  return (
    <div>
      {/* Streaming coupé : le bandeau ne reçoit rien tant qu'aucune trame ne part.
          Appliquer un effet le rallume, mais on le dit — sinon l'état « ⚡ » de la vue
          Réseau et ce panneau se contredisent sans explication. */}
      {light.streaming?.enabled === false ? (
        <p
          className="muted"
          style={{ fontSize: 12, padding: "8px 10px 0", margin: 0, color: "var(--warn, #d0a02b)" }}
        >
          ⚠ Streaming UDP coupé sur « {light.name} » : il sera rallumé automatiquement à
          l'application de l'effet.
        </p>
      ) : null}
      {/* Sélecteur de bandeau : masqué s'il n'y en a qu'un, comme sur le pupitre
          où l'on n'affiche pas un menu à une seule entrée. */}
      {strips.length > 1 ? (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "8px 10px 0" }}>
          {strips.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setSelectedId(l.id)}
              style={{
                padding: "4px 10px", fontSize: 13, borderRadius: 0, cursor: "pointer",
                border: "1px solid var(--border)",
                background: l.id === light.id
                  ? "linear-gradient(180deg,#2b7fd0,#10457d)"
                  : "linear-gradient(180deg,#1a1a1a,#050505)",
                color: l.id === light.id ? "#fff" : "var(--dim)",
                fontWeight: l.id === light.id ? 700 : 400
              }}
            >
              {l.name}
            </button>
          ))}
        </div>
      ) : null}
      <EffectDesigner light={light} onUpdated={onUpdated} />
    </div>
  );
};
