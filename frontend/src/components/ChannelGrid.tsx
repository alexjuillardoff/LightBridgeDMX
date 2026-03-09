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

const channelPageSize = 32;

export const ChannelGrid = ({ universeState, fixtures, fixtureColors, onUpdate, error }: ChannelGridProps) => {
  const [channelStart, setChannelStart] = useState(1);
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
          <div className="channel-nav">
            <button type="button" onClick={() => setChannelStart((prev) => clamp(prev - channelPageSize, 1, 512))}>
              ← Prev
            </button>
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

        <div className="channels">
          {visibleChannels.map((ch) => (
            <div className="channel-column" key={ch.channel}>
              <div className="channel-label">
                Ch {ch.channel}
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
        {error ? <small>DMX write failed: {error.message}</small> : null}
      </div>
    </>
  );
};
