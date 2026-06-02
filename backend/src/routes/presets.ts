// Routes REST des presets (reglages predefinis) : liste, creation et application.
// Un preset stocke un ensemble de valeurs de canaux DMX reutilisable ; l'appliquer
// reecrit directement ces canaux dans le service DMX.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PresetSchema } from "@lightbridgedmx/shared";
import { ErrorHandler, RouteContext } from "./types";

// Enregistre les endpoints /api/presets sur l'instance Fastify.
export const registerPresetRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  // Schema d'entree : l'id est genere par le serveur, mais le client peut en
  // fournir un (UUID valide uniquement).
  const presetInputSchema = PresetSchema.omit({ id: true }).extend({
    id: z.string().uuid().optional()
  });

  // GET : renvoie la liste de tous les presets enregistres.
  app.get("/api/presets", async () => ctx.store.listPresets());

  // POST : cree un preset a partir du contenu (payload) recu. Reponse 201 (cree).
  app.post("/api/presets", async (request, reply) => {
    try {
      const parsed = presetInputSchema.parse(request.body);
      const preset = await ctx.store.createPreset(parsed);
      reply.code(201).send(preset);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // POST .../apply : applique un preset en poussant ses valeurs sur le DMX.
  app.post("/api/presets/:id/apply", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const presets = await ctx.store.listPresets();
      const preset = presets.find((p) => p.id === id);
      // Preset introuvable : on repond 404 sans rien modifier sur le DMX.
      if (!preset) return reply.code(404).send({ message: "Preset not found" });

      // Le payload est une map { numeroDeCanal: valeur }. Les cles JSON sont des
      // chaines : on les reconvertit en nombre avant d'ecrire chaque canal DMX.
      Object.entries(preset.payload).forEach(([channelStr, value]) => {
        const channel = Number(channelStr);
        ctx.dmx.setChannel(channel, value);
      });

      reply.send({ ok: true });
    } catch (err) {
      handleError(err, reply);
    }
  });
};
