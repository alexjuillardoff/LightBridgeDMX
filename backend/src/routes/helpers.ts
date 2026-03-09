import { Fixture } from "@lightbridgedmx/shared";
import { FixtureInput } from "../state/store";
import { RouteContext } from "./types";

export const createFixtureAndSync = async (ctx: RouteContext, input: FixtureInput): Promise<Fixture> => {
  const fixture = await ctx.store.createFixture(input);
  await ctx.homekit.syncFixtures(await ctx.store.listFixtures());
  ctx.broadcast({ type: "fixture_updated", data: fixture });
  return fixture;
};
