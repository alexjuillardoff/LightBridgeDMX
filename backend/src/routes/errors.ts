import type { FastifyBaseLogger, FastifyReply } from "fastify";
import { z } from "zod";
import { QxfError } from "../services/qxf";
import { StoreError } from "../state/store";

export const createErrorHandler = (logger: FastifyBaseLogger) => {
  return (err: unknown, reply: FastifyReply) => {
    if (err instanceof StoreError) {
      reply.code(err.statusCode).send({ message: err.message });
      return;
    }
    if (err instanceof QxfError) {
      reply.code(err.statusCode).send({ message: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      reply.code(400).send({ message: err.message });
      return;
    }
    logger.error(err);
    reply.code(500).send({ message: "Internal error" });
  };
};
