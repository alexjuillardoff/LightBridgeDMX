import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildFixtureFromQxf, parseQxf } from "../services/qxf";
import { ensureFixtureLibrary, listFixtureLibrary, readFixtureFromLibrary } from "../services/qxf-library";
import { createFixtureAndSync } from "./helpers";
import { ErrorHandler, RouteContext } from "./types";

export const registerQxfRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  const qxfLibraryImportSchema = z.object({
    path: z.string().min(1),
    address: z.number().int().min(1).max(512),
    universe: z.number().int().min(0).default(0),
    mode: z.string().min(1).optional(),
    name: z.string().min(1).optional()
  });

  app.get("/api/qxf/library", async () => {
    const items = await listFixtureLibrary();
    return items.map((entry) => ({
      path: entry.path,
      brand: entry.path.split("/")[0] ?? "Unknown",
      ...entry.data
    }));
  });

  app.post("/api/qxf/library/refresh", async (_, reply) => {
    try {
      await ensureFixtureLibrary({ force: true });
      const items = await listFixtureLibrary();
      reply.send(
        items.map((entry) => ({
          path: entry.path,
          brand: entry.path.split("/")[0] ?? "Unknown",
          ...entry.data
        }))
      );
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.post("/api/fixtures/import/qxf-library", async (request, reply) => {
    try {
      const parsed = qxfLibraryImportSchema.parse(request.body);
      const xml = await readFixtureFromLibrary(parsed.path);
      const qxf = parseQxf(xml);
      const fixturePayload = buildFixtureFromQxf(qxf, {
        address: parsed.address,
        universe: parsed.universe,
        mode: parsed.mode,
        name: parsed.name
      });
      const fixture = await createFixtureAndSync(ctx, fixturePayload);
      reply.code(201).send(fixture);
    } catch (err) {
      handleError(err, reply);
    }
  });
};
