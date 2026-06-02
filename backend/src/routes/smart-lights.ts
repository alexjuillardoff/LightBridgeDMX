// Routes REST des lampes connectees (smart lights, ex. Nanoleaf).
// Expose le CRUD, l'appairage (pairing) Nanoleaf, le pilotage d'etat bas-latence,
// la gestion des effets, du streaming UDP, des zones, du layout 3D et la decouverte mDNS.
// Chaque route valide son contenu (payload) avec un schema Zod, delegue la logique au
// service ctx.smartLights / au store, puis diffuse (broadcast) la maj a tous les clients WebSocket.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SmartLight,
  SmartLightEffectConfigSchema,
  SmartLightInputSchema,
  SmartLightPairInputSchema,
  SmartLightStateInputSchema,
  SmartLightZoneLayoutSchema,
  SmartLightZonePaletteSchema
} from "@lightbridgedmx/shared";
import { NanoleafApiError, NanoleafClient } from "../services/smart-lights/nanoleaf-client";
import { discoverNanoleaf } from "../services/smart-lights/discovery";
import { ErrorHandler, RouteContext } from "./types";

// Enregistre toutes les routes /api/smart-lights sur l'instance Fastify.
// ctx donne acces au store (persistance) et au service smartLights (runtime),
// handleError centralise la mise en forme des erreurs (notamment les erreurs Zod).
export const registerSmartLightRoutes = (
  app: FastifyInstance,
  ctx: RouteContext,
  handleError: ErrorHandler
) => {
  // ─── CRUD de base ─────────────────────────────────────────────────────────

  // Liste toutes les lampes connectees avec leur etat runtime courant.
  app.get("/api/smart-lights", async () => ctx.smartLights.listWithState());

  // Detail d'une lampe (etat runtime inclus) ; 404 si l'id est inconnu.

  app.get("/api/smart-lights/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const light = ctx.smartLights.getWithState(id);
    if (!light) return reply.code(404).send({ message: "Smart light not found" });
    return light;
  });

  // Cree une lampe a partir d'une config complete fournie par l'UI.
  // On persiste d'abord (store), puis on enregistre la lampe dans le service runtime,
  // et on previent les clients via broadcast. 201 = ressource creee.
  app.post("/api/smart-lights", async (request, reply) => {
    try {
      const parsed = SmartLightInputSchema.parse(request.body);
      const light = await ctx.store.createSmartLight(parsed);
      await ctx.smartLights.register(light);
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.code(201).send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Met a jour une lampe existante. .partial() autorise un patch partiel
  // (seuls les champs fournis sont modifies). On re-enregistre ensuite la lampe
  // dans le service pour que le runtime tienne compte des changements.
  app.put("/api/smart-lights/:id", async (request, reply) => {
    try {
      const parsed = SmartLightInputSchema.partial().parse(request.body);
      const id = (request.params as { id: string }).id;
      const light = await ctx.store.updateSmartLight(id, parsed);
      await ctx.smartLights.register(light);
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Supprime une lampe : on l'enleve du store puis du service runtime.
  // 204 = succes sans contenu de reponse.
  app.delete("/api/smart-lights/:id", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      await ctx.store.deleteSmartLight(id);
      await ctx.smartLights.unregister(id);
      reply.code(204).send();
    } catch (err) {
      handleError(err, reply);
    }
  });

  /** Applique un etat — chemin bas-latence : regroupe (coalesce) et envoye par le tick du service. */
  // NB : applyState n'ecrit pas tout de suite sur la lampe. Le service met l'etat en
  // attente et l'envoie au prochain tick (regroupement). C'est ce qui rend ce chemin
  // rapide quand l'UI envoie beaucoup d'updates (ex. curseur deplace en continu).
  app.post("/api/smart-lights/:id/state", async (request, reply) => {
    try {
      const parsed = SmartLightStateInputSchema.parse(request.body);
      const id = (request.params as { id: string }).id;
      const light = ctx.smartLights.applyState(id, parsed);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ─── Appairage (pairing) Nanoleaf ────────────────────────────────────────

  /**
   * Appaire un appareil Nanoleaf. L'utilisateur doit d'abord mettre le bandeau
   * (strip) en mode appairage (maintenir le bouton power ~5 a 7 s jusqu'a ce que
   * la LED clignote). En cas de succes, le token d'authentification est persiste
   * dans la config de la lampe et le client runtime le reprend.
   *
   * Deux modes :
   *   • POST /api/smart-lights/pair          → cree une toute nouvelle lampe connectee
   *   • POST /api/smart-lights/:id/pair     → re-appaire une entree existante (rafraichit le token)
   */
  app.post("/api/smart-lights/pair", async (request, reply) => {
    try {
      const parsed = SmartLightPairInputSchema.parse(request.body);
      const token = await NanoleafClient.pair(parsed.host, parsed.port, app.log);

      // Recupere le nom/modele de l'appareil pour proposer de meilleurs defauts.
      const probeClient = new NanoleafClient({
        host: parsed.host,
        port: parsed.port,
        token,
        logger: app.log
      });
      let deviceName = parsed.name;
      try {
        const info = await probeClient.getInfo();
        deviceName = deviceName ?? info.name;
      } catch {
        // Non bloquant : on continue avec le nom fourni par l'utilisateur.
      }

      const light = await ctx.store.createSmartLight({
        name: deviceName ?? `Nanoleaf ${parsed.host}`,
        backend: "nanoleaf-http",
        ...(parsed.room ? { room: parsed.room } : {}),
        config: {
          type: "nanoleaf-http",
          host: parsed.host,
          ...(parsed.port ? { port: parsed.port } : {}),
          token,
          ...(deviceName ? { deviceName } : {})
        }
      });
      ctx.smartLights.register(light);
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.code(201).send(light);
    } catch (err) {
      // 403 Nanoleaf = pas en mode appairage : on le traduit en 409 (Conflit) cote API,
      // plus parlant pour l'UI. Les autres erreurs gardent leur code HTTP d'origine.
      if (err instanceof NanoleafApiError) {
        return reply.code(err.status === 403 ? 409 : err.status).send({ message: err.message });
      }
      handleError(err, reply);
    }
  });

  // Re-appairage d'une lampe deja enregistree : rafraichit son token sans recreer
  // l'entree. Reserve aux lampes Nanoleaf HTTP (seul backend gerant l'appairage ici).
  app.post("/api/smart-lights/:id/pair", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const existing = await ctx.store.getSmartLight(id);
      if (!existing) return reply.code(404).send({ message: "Smart light not found" });
      if (existing.config.type !== "nanoleaf-http") {
        return reply.code(400).send({ message: "Only nanoleaf-http re-pair is supported" });
      }
      const token = await NanoleafClient.pair(existing.config.host, existing.config.port, app.log);
      const updated = await ctx.store.updateSmartLight(id, {
        config: { ...existing.config, token } as SmartLight["config"]
      });
      await ctx.smartLights.register(updated);
      ctx.broadcast({ type: "smart_light_updated", data: updated });
      reply.send(updated);
    } catch (err) {
      // Meme traduction 403 → 409 que pour l'appairage initial (voir ci-dessus).
      if (err instanceof NanoleafApiError) {
        return reply.code(err.status === 403 ? 409 : err.status).send({ message: err.message });
      }
      handleError(err, reply);
    }
  });

  // ─── Effets (effects natifs Nanoleaf) ─────────────────────────────────────

  // Liste les effets disponibles sur la lampe (effets embarques dans l'appareil).
  app.get("/api/smart-lights/:id/effects", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const effects = await ctx.smartLights.listEffects(id);
      reply.send({ effects });
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Active un effet existant par son nom sur la lampe.
  app.post("/api/smart-lights/:id/effects/select", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const parsed = z.object({ name: z.string().min(1) }).parse(request.body);
      const light = await ctx.smartLights.selectEffect(id, parsed.name);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ─── Streaming UDP (extControl Nanoleaf) ─────────────────────────────────

  // Active/desactive le mode streaming UDP (flux basse latence ~5-15 ms).
  // zoneCount fixe le nombre de zones pilotees (borne a 500 par securite).
  app.post("/api/smart-lights/:id/streaming", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const parsed = z
        .object({ enabled: z.boolean(), zoneCount: z.number().int().min(1).max(500).optional() })
        .parse(request.body);
      const light = await ctx.smartLights.setStreaming(id, parsed.enabled, parsed.zoneCount);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ─── Palette par zone (necessite streaming.enabled = true) ───────────────

  // Applique une palette : une couleur par zone du bandeau. NB : ne fonctionne
  // que si le streaming UDP est actif, sinon le service n'a pas de canal d'envoi.
  app.post("/api/smart-lights/:id/zones", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const parsed = SmartLightZonePaletteSchema.parse(request.body);
      const light = ctx.smartLights.applyZones(id, parsed);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ─── Disposition 3D des zones (layout) ───────────────────────────────────

  // Enregistre le placement physique 3D des zones du bandeau. Sert aux effets
  // sensibles a la position (position-aware). null = pas de layout defini.
  app.post("/api/smart-lights/:id/layout", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const parsed = SmartLightZoneLayoutSchema.nullable().parse(request.body);
      const light = await ctx.smartLights.setLayout(id, parsed);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ─── Effet actif sensible a la position (position-aware) ─────────────────

  // Definit l'effet anime evalue par le moteur d'effets (EffectEngine) cote backend,
  // a distinguer des effets natifs Nanoleaf. null = arrete l'effet en cours.
  app.post("/api/smart-lights/:id/effect", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const parsed = SmartLightEffectConfigSchema.nullable().parse(request.body);
      const light = await ctx.smartLights.setEffect(id, parsed);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ─── Decouverte (discovery mDNS) ─────────────────────────────────────────

  // Scanne le reseau en mDNS pour trouver les Nanoleaf. timeoutMs = delai de scan
  // (defaut 3000 ms, borne 500-10000) ; renvoie la liste des appareils detectes.
  app.post("/api/smart-lights/discover", async (request, reply) => {
    try {
      const parsed = z
        .object({ timeoutMs: z.number().int().min(500).max(10000).optional() })
        .parse(request.body ?? {});
      const devices = await discoverNanoleaf(parsed.timeoutMs ?? 3000, app.log);
      reply.send({ devices });
    } catch (err) {
      handleError(err, reply);
    }
  });

  /** Test rapide de joignabilite (reachable) — indique si l'API HTTP Nanoleaf repond. */
  app.post("/api/smart-lights/probe", async (request, reply) => {
    try {
      const parsed = z.object({ host: z.string().min(1), port: z.number().int().optional() }).parse(request.body);
      // 16021 = port HTTP par defaut de l'API Nanoleaf.
      const port = parsed.port ?? 16021;
      // On borne la requete a 2,5 s pour ne pas bloquer si l'appareil ne repond pas.
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 2500);
      try {
        // On appelle l'endpoint d'appairage : meme refus (403), il prouve que l'API est vivante.
        const res = await fetch(`http://${parsed.host}:${port}/api/v1/new`, {
          method: "POST",
          signal: ctrl.signal
        });
        reply.send({
          reachable: true,
          // 403 = API vivante mais pas en mode appairage (cas le plus frequent) ; 200 = appairage reussi
          inPairingMode: res.status === 200,
          status: res.status
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Toute erreur (timeout, refus de connexion...) signifie : appareil non joignable.
      reply.send({ reachable: false, inPairingMode: false });
    }
  });
};
