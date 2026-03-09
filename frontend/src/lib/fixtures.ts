import { Fixture, UniverseState } from "@lightbridgedmx/shared";
import { addAlpha } from "./math";

export type FixtureColor = {
  solid: string;
  tint: string;
};

export type VisibleChannel = {
  channel: number;
  value: number;
  note?: string;
  color?: FixtureColor;
};

type VisibleChannelsInput = {
  channelStart: number;
  channelPageSize: number;
  universeState: UniverseState | null;
  fixtures: Fixture[];
  fixtureColors: Record<string, FixtureColor>;
};

export const buildFixtureColors = (fixtures: Fixture[]): Record<string, FixtureColor> => {
  const palette = ["#1dd3b0", "#f39c12", "#9b59b6", "#e74c3c", "#3498db", "#2ecc71", "#e67e22", "#16a085"];
  return fixtures.reduce((acc, fixture, idx) => {
    const base = palette[idx % palette.length];
    acc[fixture.id] = { solid: base, tint: addAlpha(base, 0.2) };
    return acc;
  }, {} as Record<string, FixtureColor>);
};

export const computeVisibleChannels = ({
  channelStart,
  channelPageSize,
  universeState,
  fixtures,
  fixtureColors
}: VisibleChannelsInput): VisibleChannel[] => {
  const start = Math.max(1, Math.min(channelStart, 512));
  const end = Math.min(start + channelPageSize - 1, 512);
  const values = universeState?.values ?? Array(512).fill(0);
  const channelNotes: Record<number, { note: string; color?: FixtureColor }> = {};

  fixtures.forEach((fixture) => {
    fixture.channels.forEach((ch) => {
      const abs = fixture.address + ch.channel - 1;
      if (abs >= 1 && abs <= 512) {
        const label = ch.name ?? ch.capability;
        channelNotes[abs] = { note: `${fixture.name} · ${label}`, color: fixtureColors[fixture.id] };
      }
    });
  });

  return Array.from({ length: end - start + 1 }, (_, idx) => {
    const channel = start + idx;
    const note = channelNotes[channel];
    return { channel, value: values[channel - 1] ?? 0, note: note?.note, color: note?.color };
  });
};

export const countActiveChannels = (universeState: UniverseState | null) => {
  if (!universeState) return 0;
  return universeState.values.filter((v) => v > 0).length;
};
