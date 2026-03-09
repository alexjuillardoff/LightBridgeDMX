import { FixtureChannel } from "@lightbridgedmx/shared";

export const fixtureTemplates: Record<
  string,
  { label: string; channels: FixtureChannel[] }
> = {
  dimmer: {
    label: "Dimmer (1ch)",
    channels: [{ channel: 1, capability: "intensity" }]
  },
  rgb: {
    label: "RGB (3ch)",
    channels: [
      { channel: 1, capability: "r" },
      { channel: 2, capability: "g" },
      { channel: 3, capability: "b" }
    ]
  },
  rgbw: {
    label: "RGBW (4ch)",
    channels: [
      { channel: 1, capability: "r" },
      { channel: 2, capability: "g" },
      { channel: 3, capability: "b" },
      { channel: 4, capability: "w" }
    ]
  }
};

export type FixtureTemplateKey = keyof typeof fixtureTemplates;
