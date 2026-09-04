// Routes du moteur d'effets DMX.
//
// Un effet se lance sur une SELECTION de projecteurs — les ids viennent du
// programmeur cote pupitre. Rien n'est persiste : ces routes pilotent une
// boucle vivante, elles ne modifient pas le patch.
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { DmxEffectSchema } from "@lightbridgedmx/shared";
import { RouteContext } from "./types";

const RunBodySchema = z.object({
  effect: DmxEffectSchema,
  /** Projecteurs vises, dans l'ordre de selection : c'est cet ordre qui porte la
   *  repartition de phase, donc il est significatif et on ne le trie pas. */
  fixtureIds: z.array(z.string().uuid()).min(1)
});

export const registerEffectRoutes = (app: FastifyInstance, ctx: RouteContext) => {
  // Effets actuellement en cours.
  app.get("/api/effects", async () => ({ running: ctx.effects.list() }));

  // Lance un effet sur une selection. Relancer sur une selection qui recoupe un
  // effet en cours remplace ce dernier (un seul effet par projecteur).
  app.post("/api/effects/run", async (request, reply) => {
    const parsed = RunBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Effet invalide", issues: parsed.error.issues });
    }
    const running = await ctx.effects.run(parsed.data.effect, parsed.data.fixtureIds);
    if (!running) {
      return reply.code(409).send({
        message:
          "Aucune cellule pilotable dans la selection : ces projecteurs n'exposent ni intensite, ni RGB, ni pan/tilt."
      });
    }
    ctx.broadcast({ type: "effects_updated", data: { running: ctx.effects.list() } });
    return running;
  });

  // Retouche un effet EN COURS sans le relancer : la phase ne repart pas de zero,
  // donc on peut regler la vitesse ou la forme en regardant le plateau.
  app.put("/api/effects/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = DmxEffectSchema.safeParse((request.body as { effect?: unknown })?.effect);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Effet invalide", issues: parsed.error.issues });
    }
    const running = ctx.effects.updateRun(id, parsed.data);
    if (!running) {
      return reply.code(404).send({ message: "Effet introuvable (deja arrete ?)" });
    }
    ctx.broadcast({ type: "effects_updated", data: { running: ctx.effects.list() } });
    return running;
  });

  // Arrete un effet. Ses canaux reprennent la valeur qu'ils avaient avant.
  app.delete("/api/effects/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!ctx.effects.stopRun(id)) {
      return reply.code(404).send({ message: "Effet introuvable (deja arrete ?)" });
    }
    ctx.broadcast({ type: "effects_updated", data: { running: ctx.effects.list() } });
    return { stopped: id };
  });

  // Arrete tout — l'equivalent d'un « off » general sur le pool d'effets.
  app.post("/api/effects/stop-all", async () => {
    ctx.effects.stopAll();
    ctx.broadcast({ type: "effects_updated", data: { running: ctx.effects.list() } });
    return { running: ctx.effects.list() };
  });
};
