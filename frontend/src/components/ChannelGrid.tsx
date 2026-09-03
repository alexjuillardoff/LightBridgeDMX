// Console DMX : une page de 32 canaux de l'univers, en faders verticaux.
// C'est la "Fader View" du pupitre : chaque tranche montre son numéro de canal,
// son niveau en pourcent, le fader lui-même, le rôle du canal et un champ de
// saisie directe en 0-255.
//
// Les canaux consécutifs d'un même projecteur sont réunis dans un bloc coiffé
// d'un bandeau qui porte son nom en entier : une tranche fait ~54 px de large,
// un nom de projecteur n'y tient pas, alors qu'écrit une seule fois au-dessus
// de ses canaux il reste lisible. Les canaux libres forment leurs propres blocs.
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

  // Découpe la page en blocs de canaux consécutifs appartenant au même
  // projecteur (fixtureId absent = canaux libres, regroupés entre eux).
  const channelGroups = useMemo(() => {
    const groups: { key: string; fixture?: VisibleChannel; channels: VisibleChannel[] }[] = [];
    visibleChannels.forEach((ch) => {
      const previous = groups[groups.length - 1];
      if (previous && previous.channels[0].fixtureId === ch.fixtureId) {
        previous.channels.push(ch);
        return;
      }
      groups.push({ key: `${ch.fixtureId ?? "free"}-${ch.channel}`, fixture: ch, channels: [ch] });
    });
    return groups;
  }, [visibleChannels]);

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

      {/* Un bloc par projecteur : bandeau nommé, puis une tranche par canal
          (entête, rôle du canal, fader, saisie). */}
      <div className="channels">
        {channelGroups.map((group) => {
          const color = group.fixture?.color;
          const name = group.fixture?.fixtureName;
          const groupFirst = group.channels[0].channel;
          const groupLast = group.channels[group.channels.length - 1].channel;
          return (
            <section
              className={`channel-group ${name ? "channel-group-tagged" : ""}`}
              key={group.key}
              // Le liseré haut du bloc reprend la couleur du projecteur.
              style={color ? { borderTopColor: color.solid } : undefined}
            >
              <header className="channel-group-head">
                {/* title : le nom complet reste accessible au survol quand le
                    bloc est trop étroit pour l'afficher en entier. */}
                <span
                  className="channel-group-name"
                  style={color ? { color: color.solid } : undefined}
                  title={name ?? "Canaux libres"}
                >
                  {name ?? "Libre"}
                </span>
                <span className="channel-group-range">
                  {groupFirst}
                  {groupLast > groupFirst ? `–${groupLast}` : ""}
                </span>
              </header>

              <div className="channel-group-strips">
                {group.channels.map((ch) => (
                  <div className="channel-column" key={ch.channel}>
                    <div className="channel-head">
                      <span className="channel-index">{String(ch.channel).padStart(3, "0")}</span>
                      <span className="channel-pct">{toPct(ch.value)}</span>
                    </div>

                    {/* Rôle du canal seul : le nom du projecteur est au-dessus. */}
                    <div
                      className="channel-note"
                      style={color ? { borderColor: color.solid, color: color.solid } : undefined}
                      title={ch.channelLabel ? `${name} · ${ch.channelLabel}` : undefined}
                    >
                      {ch.channelLabel ?? "—"}
                    </div>

                    <MaFader
                      label={ch.channelLabel ? `${name} · ${ch.channelLabel}` : `Canal DMX ${ch.channel}`}
                      value={ch.value}
                      onChange={(next) => onUpdate(ch.channel, next)}
                      fill={color ? `linear-gradient(180deg, ${color.solid}, ${color.tint})` : undefined}
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
            </section>
          );
        })}
      </div>

      {error ? <small>Écriture DMX impossible : {error.message}</small> : null}
    </div>
  );
};
