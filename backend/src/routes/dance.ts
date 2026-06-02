// Routes REST du Mode Dance.
// Expose la config et le pilotage du chenillard (chase) automatique :
// lecture/ecriture de la config, demarrage et arret, plus la liste des pieces.
// La logique reelle vit dans le service ctx.dance ; ici on ne fait que valider
// les entrees (Zod) et relayer vers le service.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DancePatternIdSchema, CapabilitySchema } from "@lightbridgedmx/shared";
import { ErrorHandler, RouteContext } from "./types";

// Enregistre toutes les routes /api/dance/* (et /api/rooms) sur l'instance Fastify.
export const registerDanceRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  // Schema Zod du corps de PUT /config. Tous les champs sont optionnels :
  // on applique une mise a jour partielle, seuls les champs fournis changent.
  const updateBodySchema = z.object({
    rooms: z.array(z.string().min(1)).optional(),
    intervalMinMs: z.number().int().min(1).max(2000).optional(),
    intervalMaxMs: z.number().int().min(1).max(2000).optional(),
    patterns: z.array(DancePatternIdSchema).optional(),
    excludePanTilt: z.boolean().optional(),
    excludeCapabilities: z.array(CapabilitySchema).optional(),
    // Reglages specifiques aux lyres participant au chase.
    lyre: z
      .object({
        enabled: z.boolean(),
        shutterOpenValue: z.number().int().min(0).max(255),
        dimmerOnValue: z.number().int().min(0).max(255),
        followChase: z.boolean(),
        // Positions pan/tilt connues par lyre : servent d'ancres pour interpoler
        // la trajectoire qui suit le chenillard de projecteur en projecteur.
        positions: z.array(
          z.object({
            fixtureId: z.string().uuid(),
            pan: z.number().int().min(0).max(255),
            tilt: z.number().int().min(0).max(255)
          })
        ),
        // Ancre du bord droit du mur : sert a extrapoler au-dela de la derniere position connue.
        wallEdgeRight: z
          .object({
            pan: z.number().int().min(0).max(255),
            tilt: z.number().int().min(0).max(255)
          })
          .nullable(),
        speedValue: z.number().int().min(0).max(255),
        // Duree (ms) par unite de pan parcourue : regle la vitesse de deplacement de la lyre.
        msPerPanUnit: z.number().int().min(1).max(500)
      })
      .optional()
  });

  // Renvoie l'etat courant du Mode Dance (config + statut en cours/arrete).
  app.get("/api/dance/state", async (_request, reply) => {
    try {
      const state = await ctx.dance.getState();
      reply.send(state);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Met a jour la config (mise a jour partielle validee par updateBodySchema)
  // et renvoie l'etat resultant. Un corps vide est traite comme {} (aucun changement).
  app.put("/api/dance/config", async (request, reply) => {
    try {
      const parsed = updateBodySchema.parse(request.body ?? {});
      const state = await ctx.dance.updateConfig(parsed);
      reply.send(state);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Demarre le chenillard automatique.
  app.post("/api/dance/start", async (_request, reply) => {
    try {
      const state = await ctx.dance.start();
      reply.send(state);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Arrete le chenillard.
  app.post("/api/dance/stop", async (_request, reply) => {
    try {
      const state = await ctx.dance.stop();
      reply.send(state);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Liste les pieces disponibles, utilisees pour cibler le Mode Dance par piece.
  app.get("/api/rooms", async (_request, reply) => {
    try {
      const rooms = await ctx.store.listRooms();
      reply.send(rooms);
    } catch (err) {
      handleError(err, reply);
    }
  });
};
