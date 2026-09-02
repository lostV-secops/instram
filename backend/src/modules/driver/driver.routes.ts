import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import {
  DriverService,
  NotFoundError,
  ForbiddenError,
  InvalidQrError,
  WrongTripError,
  AlreadyBoardedError,
  NoShowBeforeDepartureError,
} from './driver.service';
import {
  TripInstanceIdParamSchema,
  BoardRequestSchema,
  NoShowRequestSchema,
  DepartRequestSchema,
} from './driver.schema';
import prisma from '../../infra/db/prisma';

// =====================================================================
// Plugin Fastify — module driver
// Périmètre :
//   GET  /v1/driver/trips/today
//   GET  /v1/driver/trips/:tripInstanceId/manifest
//   POST /v1/driver/trips/:tripInstanceId/board
//   POST /v1/driver/trips/:tripInstanceId/no-show
//   POST /v1/driver/trips/:tripInstanceId/depart
//
// Auth : rôle COOP_DRIVER vérifié dans le service via Membership.
// Contrat : docs/contrat-api.yaml §Driver
// =====================================================================

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

/** Extrait l'userId depuis le JWT vérifié par @fastify/jwt. */
function getUserId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

/**
 * Traduit une erreur métier en réponse HTTP standardisée (code + message).
 */
function handleServiceError(
  err: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (err instanceof InvalidQrError) {
    return reply.status(403).send({ code: err.code, message: err.message });
  }
  if (err instanceof WrongTripError) {
    return reply.status(409).send({ code: err.code, message: err.message });
  }
  if (err instanceof AlreadyBoardedError) {
    return reply.status(409).send({ code: err.code, message: err.message });
  }
  if (err instanceof NoShowBeforeDepartureError) {
    return reply.status(400).send({ code: err.code, message: err.message });
  }
  if (err instanceof ForbiddenError) {
    return reply.status(403).send({ code: err.code, message: err.message });
  }
  if (err instanceof NotFoundError) {
    return reply.status(404).send({ code: err.code, message: err.message });
  }

  req.log.error(err, 'driver — unhandled error');
  return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
}

export default async function driverRoutes(fastify: FastifyInstance): Promise<void> {
  const driverService = new DriverService(prisma);

  // ------------------------------------------------------------------
  // GET /driver/trips/today
  // Auth : COOP_DRIVER (vérifié dans le service via Membership)
  // ------------------------------------------------------------------
  fastify.get(
    '/driver/trips/today',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      const userId = getUserId(req);

      try {
        const trips = await driverService.getTripsToday(userId);
        return reply.status(200).send(trips);
      } catch (err) {
        return handleServiceError(err, req, reply);
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /driver/trips/:tripInstanceId/manifest
  // Auth : COOP_DRIVER de la coop propriétaire du trajet
  // ------------------------------------------------------------------
  fastify.get(
    '/driver/trips/:tripInstanceId/manifest',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      const userId = getUserId(req);

      const paramResult = TripInstanceIdParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(paramResult.error),
        });
      }

      try {
        const manifest = await driverService.getManifest(
          userId,
          paramResult.data.tripInstanceId,
        );
        return reply.status(200).send(manifest);
      } catch (err) {
        return handleServiceError(err, req, reply);
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /driver/trips/:tripInstanceId/board
  // Auth : COOP_DRIVER
  // ------------------------------------------------------------------
  fastify.post(
    '/driver/trips/:tripInstanceId/board',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      const userId = getUserId(req);

      const paramResult = TripInstanceIdParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(paramResult.error),
        });
      }

      const bodyResult = BoardRequestSchema.safeParse(req.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(bodyResult.error),
        });
      }

      try {
        const result = await driverService.board(
          userId,
          paramResult.data.tripInstanceId,
          bodyResult.data,
        );
        return reply.status(200).send(result);
      } catch (err) {
        return handleServiceError(err, req, reply);
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /driver/trips/:tripInstanceId/no-show
  // Auth : COOP_DRIVER
  // ------------------------------------------------------------------
  fastify.post(
    '/driver/trips/:tripInstanceId/no-show',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      const userId = getUserId(req);

      const paramResult = TripInstanceIdParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(paramResult.error),
        });
      }

      const bodyResult = NoShowRequestSchema.safeParse(req.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(bodyResult.error),
        });
      }

      try {
        const result = await driverService.noShow(
          userId,
          paramResult.data.tripInstanceId,
          bodyResult.data,
        );
        return reply.status(200).send(result);
      } catch (err) {
        return handleServiceError(err, req, reply);
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /driver/trips/:tripInstanceId/depart
  // Auth : COOP_DRIVER
  // Idempotent : 200 si départ déjà signalé.
  // ------------------------------------------------------------------
  fastify.post(
    '/driver/trips/:tripInstanceId/depart',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      const userId = getUserId(req);

      const paramResult = TripInstanceIdParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(paramResult.error),
        });
      }

      const bodyResult = DepartRequestSchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(bodyResult.error),
        });
      }

      try {
        const result = await driverService.depart(
          userId,
          paramResult.data.tripInstanceId,
          bodyResult.data ?? {},
        );
        return reply.status(200).send(result);
      } catch (err) {
        return handleServiceError(err, req, reply);
      }
    },
  );
}
