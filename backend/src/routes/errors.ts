// Gestionnaire d'erreurs partage des routes (endpoints) Fastify.
// Traduit une exception lancee dans un handler en reponse HTTP propre :
// chaque type d'erreur connu choisit son propre code de statut ; tout le
// reste devient un 500 generique pour ne pas fuiter de details internes.
import type { FastifyBaseLogger, FastifyReply } from "fastify";
import { z } from "zod";
import { QxfError } from "../services/qxf";
import { StoreError } from "../state/store";

// Construit un gestionnaire (handler) d'erreurs lie au logger fourni.
// On le reutilise dans les routes pour centraliser la mise en forme des erreurs.
export const createErrorHandler = (logger: FastifyBaseLogger) => {
  return (err: unknown, reply: FastifyReply) => {
    // Erreur du store (couche SQLite/Prisma) : porte deja son propre code HTTP.
    if (err instanceof StoreError) {
      reply.code(err.statusCode).send({ message: err.message });
      return;
    }
    // Erreur du service QXF (bibliotheque de projecteurs) : idem, code HTTP fourni.
    if (err instanceof QxfError) {
      reply.code(err.statusCode).send({ message: err.message });
      return;
    }
    // Echec de validation Zod sur le contenu (payload) d'une requete -> 400.
    if (err instanceof z.ZodError) {
      reply.code(400).send({ message: err.message });
      return;
    }
    // Erreur inconnue : on la trace cote serveur et on renvoie un 500 neutre.
    // NB : on n'expose pas le message reel au client pour eviter toute fuite.
    logger.error(err);
    reply.code(500).send({ message: "Internal error" });
  };
};
