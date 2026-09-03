// Console DMX : une page de 32 canaux de l'univers, en faders verticaux.
// C'est la "Fader View" du pupitre : chaque tranche montre son numéro de canal,
// son niveau en pourcent, le fader lui-même, la fixture à laquelle le canal
// appartient et un champ de saisie directe en 0-255.
import { useMemo, useState } from "react";
import { Fixture, UniverseState } from "@lightbridgedmx/shared";
import { computeVisibleChannels, FixtureColor, VisibleChannel } from "../lib/fixtures";
import { clamp } from "../lib/math";
import { toPct } from "../lib/programmer";
import { MaFader } from "./ma/MaFader";

type ChannelGridProps = {
  universeState: UniverseState | null;
  fixtures: Fixture[];
  fixtureColors: Record<string, FixtureColor>;
  onUpdate: (channel: number, value: number) => void;
  error?: Error | null;
};

// Nombre de canaux par page : l'univers en compte 512, on le parcourt par pages.
const channelPageSize = 32;

export const ChannelGrid = ({ universeState, fixtures, fixtureColors, onUpdate, error }: ChannelGridProps) => {
  // Premier canal affiché (1 à 512).
  const [channelStart, setChannelStart] = useState(1);
  // Tranche de canaux visible + étiquettes/couleurs, recalculée à la demande.
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

  const first = visibleChannels[0]?.channel ?? 1;
  const last = visibleChannels[visibleChannels.length - 1]?.channel ?? 1;

  return (
    <div className="card channel-card">
      <h2>
        DMX Fader View
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 400 }}>
          Canaux {first} → {last} / 512
        </span>
      </h2>

      <div className="channel-toolbar">
        <div className="input-inline">
          <label>
            Premier canal
            <input
              type="number"
              min={1}
              max={512}
              value={channelStart}
              onChange={(e) => setChannelStart(clamp(Number(e.target.value), 1, 512))}
            />
          </label>
          <label>
            Page
            <input type="number" value={channelPageSize} readOnly />
          </label>
        </div>
        {/* Navigation entre les pages de 32 canaux. */}
        <div className="channel-nav">
          <button type="button" onClick={() => setChannelStart((prev) => clamp(prev - channelPageSize, 1, 512))}>
            ◀ Page −
          </button>
          <button
            type="button"
            onClick={() =>
              setChannelStart((prev) =>
                clamp(prev + channelPageSize, 1, Math.max(512 - channelPageSize + 1, 1))
              )
            }
          >
            Page + ▶
          </button>
        </div>
      </div>

      {/* Une tranche par canal : entête, étiquette fixture, fader, saisie. */}
      <div className="channels">
        {visibleChannels.map((ch) => (
          <div
            className={`channel-column ${ch.color ? "channel-column-tagged" : ""}`}
            key={ch.channel}
            // Le liseré haut reprend la couleur de la fixture propriétaire.
            style={ch.color ? { borderTopColor: ch.color.solid } : undefined}
          >
            <div className="channel-head">
              <span className="channel-index">{String(ch.channel).padStart(3, "0")}</span>
              <span className="channel-pct">{toPct(ch.value)}</span>
            </div>

            {/* Étiquette "fixture · rôle du canal", colorée si canal r/g/b. */}
            <div
              className="channel-note"
              style={ch.color ? { borderColor: ch.color.solid, color: ch.color.solid } : undefined}
            >
              {ch.note ?? "—"}
            </div>

            <MaFader
              label={`Canal DMX ${ch.channel}`}
              value={ch.value}
              onChange={(next) => onUpdate(ch.channel, next)}
              fill={ch.color ? `linear-gradient(180deg, ${ch.color.solid}, ${ch.color.tint})` : undefined}
            />

            <input
              className="channel-number"
              type="number"
              min={0}
              max={255}
              value={ch.value}
              onChange={(e) => onUpdate(ch.channel, clamp(Number(e.target.value), 0, 255))}
              aria-label={`Valeur du canal ${ch.channel}`}
            />
          </div>
        ))}
      </div>

      {error ? <small>Écriture DMX impossible : {error.message}</small> : null}
    </div>
  );
};
