// Console DMX : une page de 32 canaux de l'univers, en faders verticaux.
// C'est la "Fader View" du pupitre : chaque tranche montre son numéro de canal,
// son niveau en pourcent, le fader lui-même, la fixture à laquelle le canal
// appartient et un champ de saisie directe en 0-255.
//
// Tous les projecteurs patchés y sont visibles, y compris ceux qui ne sont pas
// du DMX physique (un strip Nanoleaf exposé en projecteur par zone, par exemple) :
// la vue lit l'univers, pas le matériel. Le sélecteur "Aller au projecteur"
// permet de sauter directement sur leur plage de canaux.
import { useMemo, useState } from "react";
import { useAppData } from "../contexts/AppDataContext";
import { useUniverseState } from "../contexts/UniverseStateContext";
import { computeVisibleChannels, VisibleChannel } from "../lib/fixtures";
import { clamp } from "../lib/math";
import { toPct } from "../lib/programmer";
import { MaFader } from "./ma/MaFader";

// Nombre de canaux par page : l'univers en compte 512, on le parcourt par pages.
const channelPageSize = 32;

export const ChannelGrid = () => {
  // La fenêtre fournit le cadre et le titre : ce composant ne dessine que son
  // contenu et va chercher lui-même ce dont il a besoin dans les contextes.
  const { fixtures, fixtureColors, mutations, handleUpdateChannel } = useAppData();
  const { universeState } = useUniverseState();
  const onUpdate = handleUpdateChannel;
  const error = mutations.setChannel.error as Error | null | undefined;
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

  // Raccourci "aller au projecteur" : la vue ne montre que 32 canaux a la fois,
  // et un projecteur peut vivre loin dans l'univers (un strip a zones occupe des
  // centaines de canaux). On liste donc les projecteurs par adresse croissante avec
  // leur plage, pour sauter directement dessus au lieu de pager a l'aveugle.
  const fixtureJumps = useMemo(
    () =>
      [...fixtures]
        .map((fixture) => ({
          id: fixture.id,
          name: fixture.name,
          address: fixture.address,
          // Un projecteur n'occupe pas forcement des canaux contigus : on prend
          // le canal relatif le plus haut pour borner sa plage.
          lastChannel: fixture.address + Math.max(...fixture.channels.map((ch) => ch.channel)) - 1,
          count: fixture.channels.length
        }))
        .sort((a, b) => a.address - b.address),
    [fixtures]
  );
  // Le projecteur dont l'adresse de depart tombe dans la page affichee (pour que
  // le selecteur reflete ou on se trouve au lieu de rester bloque sur "—").
  const currentJump = fixtureJumps.find((f) => f.address >= first && f.address <= last)?.id ?? "";

  return (
    <div className="channel-card">
      <div className="channel-toolbar">
        <span className="channel-range">
          Canaux {first} → {last} / 512
        </span>
        <div className="input-inline">
          <label>
            Aller au projecteur
            <select
              className="channel-jump"
              value={currentJump}
              onChange={(e) => {
                const target = fixtureJumps.find((f) => f.id === e.target.value);
                if (target) setChannelStart(target.address);
              }}
            >
              <option value="">— Choisir —</option>
              {fixtureJumps.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.address}
                  {f.lastChannel > f.address ? `–${f.lastChannel}` : ""} ({f.count} ch.)
                </option>
              ))}
            </select>
          </label>
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
