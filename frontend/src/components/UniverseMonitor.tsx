// Moniteur d'univers : les 512 canaux DMX en une seule grille compacte, façon
// fenêtre "DMX Sheet" d'un pupitre. Chaque case est un canal ; sa hauteur et sa
// couleur reflètent la valeur courante, et l'infobulle donne le détail.
//
// C'est de la lecture seule : pour agir sur un canal, on passe par la Fader
// View de la vue Live ou par la ligne de commande.
import { useMemo } from "react";
import { useAppData } from "../contexts/AppDataContext";
import { useUniverseState } from "../contexts/UniverseStateContext";
import { toPct } from "../lib/programmer";

export const UniverseMonitor = () => {
  const { fixtures } = useAppData();
  const { universeState } = useUniverseState();

  const values = universeState?.values ?? new Array(512).fill(0);

  // Étiquette de chaque canal occupé par une fixture : sert d'infobulle et
  // colore la case aux couleurs de son propriétaire.
  const owners = useMemo(() => {
    const map: Record<number, string> = {};
    fixtures.forEach((fixture) => {
      fixture.channels.forEach((ch) => {
        const abs = fixture.address + ch.channel - 1;
        if (abs >= 1 && abs <= 512) {
          map[abs] = `${fixture.name} · ${ch.name ?? ch.capability}`;
        }
      });
    });
    return map;
  }, [fixtures]);

  const active = values.filter((v) => v > 0).length;

  return (
    <div className="monitor-wrap">
      <p className="monitor-head">
        Univers 01 · <strong>{active}</strong> canaux actifs / 512
      </p>

      <div className="ma-monitor" role="img" aria-label={`Univers DMX : ${active} canaux actifs sur 512`}>
        {values.map((value, index) => {
          const channel = index + 1;
          const owner = owners[channel];
          return (
            <div
              key={channel}
              className={`ma-monitor-cell ${owner ? "ma-monitor-cell-patched" : ""}`}
              title={`Canal ${channel}${owner ? ` — ${owner}` : ""} : ${value} (${toPct(value)} %)`}
            >
              {/* Le remplissage monte depuis le bas, comme un bargraph. */}
              <span style={{ height: `${(value / 255) * 100}%` }} />
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        Chaque case = un canal (1 → 512, de gauche à droite). Les canaux patchés sont cerclés d'ambre.
      </p>
    </div>
  );
};
