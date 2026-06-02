// Routes REST de la bibliotheque QXF (modeles de projecteurs QLC+).
// Expose trois endpoints :
//  - GET  /api/qxf/library          : liste les modeles disponibles localement,
//  - POST /api/qxf/library/refresh  : re-telecharge la bibliotheque depuis GitHub,
//  - POST /api/fixtures/import/qxf-library : importe un modele en projecteur DMX.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildFixtureFromQxf, parseQxf } from "../services/qxf";
import { ensureFixtureLibrary, listFixtureLibrary, readFixtureFromLibrary } from "../services/qxf-library";
import { createFixtureAndSync } from "./helpers";
import { ErrorHandler, RouteContext } from "./types";

export const registerQxfRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  // Schema Zod de validation du corps de la requete d'import.
  // address : adresse DMX de depart (1-512). universe : univers DMX (defaut 0).
  // mode et name : facultatifs, pour choisir un mode QXF precis ou renommer.
  const qxfLibraryImportSchema = z.object({
    path: z.string().min(1),
    address: z.number().int().min(1).max(512),
    universe: z.number().int().min(0).default(0),
    mode: z.string().min(1).optional(),
    name: z.string().min(1).optional()
  });

  // Liste les modeles QXF presents localement.
  // La marque est deduite du premier segment du chemin (ex. "Martin/...").
  app.get("/api/qxf/library", async () => {
    const items = await listFixtureLibrary();
    return items.map((entry) => ({
      path: entry.path,
      brand: entry.path.split("/")[0] ?? "Unknown",
      ...entry.data
    }));
  });

  // Force le re-telechargement de la bibliotheque QXF (~50 Mo) depuis GitHub,
  // puis renvoie la liste mise a jour. force: true ignore le cache local.
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

  // Importe un modele de la bibliotheque comme nouveau projecteur DMX.
  // Etapes : lire le XML du fichier QXF, le parser, en construire un payload de
  // projecteur (canaux/capabilities), puis le creer et synchroniser (HomeKit, etc.).
  // Repond 201 avec le projecteur cree.
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
