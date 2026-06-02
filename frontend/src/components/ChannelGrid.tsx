// Console DMX en direct (Live) : affiche une page de 32 canaux de l'univers DMX.
// Chaque canal a un curseur (slider) vertical + un champ numerique (0-255).
// Une etiquette indique a quel projecteur (fixture) et a quelle capability
// appartient le canal, avec un code couleur quand c'est un canal r/g/b.
import { useMemo, useState } from "react";
import { Fixture, UniverseState } from "@lightbridgedmx/shared";
import { computeVisibleChannels, FixtureColor, VisibleChannel } from "../lib/fixtures";
import { clamp } from "../lib/math";

type ChannelGridProps = {
  universeState: UniverseState | null;
  fixtures: Fixture[];
  fixtureColors: Record<string, FixtureColor>;
  onUpdate: (channel: number, value: number) => void;
  error?: Error | null;
};

// Nombre de canaux affiches par page. On pagine car l'univers DMX fait 512 canaux.
const channelPageSize = 32;

export const ChannelGrid = ({ universeState, fixtures, fixtureColors, onUpdate, error }: ChannelGridProps) => {
  // Premier canal affiche (1 a 512). Sert de point de depart de la page courante.
  const [channelStart, setChannelStart] = useState(1);
  // Calcule la tranche de canaux a afficher + leurs etiquettes/couleurs.
  // Recalcule seulement quand la page ou les donnees changent (memo).
  const visibleChannels: VisibleChannel[] = useMemo(
    () =>
      computeVisibleChannels({
        channelStart,
        channelPageSize,
        universeState,
        fixtures,
        fixtureColors
      }),
    [channelStart, fixtures, fixtureColors, universeState]
  );

  return (
    <>
      <div className="section-title">
        <h2>Live DMX channels</h2>
        <span className="muted">
          {visibleChannels.length} channels · showing {visibleChannels[0]?.channel ?? 1}-
          {visibleChannels[visibleChannels.length - 1]?.channel ?? 1}
        </span>
      </div>
      <div className="card channel-card">
        <div className="channel-toolbar">
          <div className="input-inline">
            <label>
              Start
              <input
                type="number"
                min={1}
                max={512}
                value={channelStart}
                onChange={(e) => setChannelStart(clamp(Number(e.target.value), 1, 512))}
              />
            </label>
            <label>
              Range
              <input type="number" value={channelPageSize} readOnly />
            </label>
          </div>
          {/* Navigation entre les pages de 32 canaux. */}
          <div className="channel-nav">
            {/* Page precedente : on borne (clamp) a 1 pour ne pas passer sous le canal 1. */}
            <button type="button" onClick={() => setChannelStart((prev) => clamp(prev - channelPageSize, 1, 512))}>
              ← Prev
            </button>
            {/* Page suivante : on borne au dernier debut de page possible (512 - 32 + 1 = 481)
                pour toujours afficher 32 canaux pleins en fin d'univers. */}
            <button
              type="button"
              onClick={() =>
                setChannelStart((prev) => clamp(prev + channelPageSize, 1, Math.max(512 - channelPageSize + 1, 1)))
              }
            >
              Next →
            </button>
          </div>
        </div>

        {/* Une colonne par canal : etiquette, curseur vertical et champ numerique. */}
        <div className="channels">
          {visibleChannels.map((ch) => (
            <div className="channel-column" key={ch.channel}>
              <div className="channel-label">
                Ch {ch.channel}
                {/* Note = nom du projecteur + capability. Coloree si c'est un canal r/g/b. */}
                {ch.note ? (
                  <div
                    className="channel-note"
                    style={
                      ch.color
                        ? { borderColor: ch.color.solid, backgroundColor: ch.color.tint, color: ch.color.solid }
                        : undefined
                    }
                  >
                    {ch.note}
                  </div>
                ) : null}
              </div>
              {/* Curseur et champ pilotent la meme valeur 0-255 ; tout changement
                  remonte au parent via onUpdate, qui envoie l'ecriture DMX. */}
              <input
                className="vertical"
                type="range"
                min={0}
                max={255}
                value={ch.value}
                onChange={(e) => onUpdate(ch.channel, Number(e.target.value))}
              />
              <input
                className="channel-number"
                type="number"
                min={0}
                max={255}
                value={ch.value}
                onChange={(e) => onUpdate(ch.channel, Number(e.target.value))}
              />
            </div>
          ))}
        </div>
        {/* Affiche l'erreur si la derniere ecriture DMX a echoue. */}
        {error ? <small>DMX write failed: {error.message}</small> : null}
      </div>
    </>
  );
};
