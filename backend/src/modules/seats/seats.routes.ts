import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { SeatsService, SeatConflictError } from './seats.service';
import { HoldSeatsSchema } from './seats.schema';
import prisma from '../../infra/db/prisma';
import redis from '../../infra/cache/redis';

// =====================================================================
// Plugin Fastify — module seats
// Préfixes attendus (enregistrés depuis app.ts) :
//   GET  /v1/trips/:tripInstanceId/seats
//   POST /v1/trips/:tripInstanceId/seats/hold
//   DELETE /v1/trips/:tripInstanceId/seats/hold/:holdId
//
// Contrat : docs/contrat-api.yaml §Traveler-Trips
// Architecture §5 : zéro double réservation, 4 niveaux
// =====================================================================

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

export default async function seatsRoutes(fastify: FastifyInstance): Promise<void> {
  const seatsService = new SeatsService(prisma, redis);

  // ------------------------------------------------------------------
  // GET /trips/:tripInstanceId/seats
  // Auth optionnelle : si présente, les propres holds deviennent HELD_BY_ME
  // Cache-Control: no-store (temps réel, architecture §7.1)
  // ------------------------------------------------------------------
  fastify.get<{ Params: { tripInstanceId: string } }>(
    '/trips/:tripInstanceId/seats',
    async (req: FastifyRequest<{ Params: { tripInstanceId: string } }>, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');

      // Auth optionnelle
      let userId: string | undefined;
      try {
        await req.jwtVerify();
        userId = (req.user as { sub: string }).sub;
      } catch {
        // Non authentifié — ok pour cet endpoint public
      }

      try {
        const result = await seatsService.getSeats(req.params.tripInstanceId, userId);
        return reply.status(200).send(result);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        req.log.error(err, 'getSeats error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /trips/:tripInstanceId/seats/hold
  // Auth requise (architecture §6.2)
  // ------------------------------------------------------------------
  fastify.post<{ Params: { tripInstanceId: string } }>(
    '/trips/:tripInstanceId/seats/hold',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { tripInstanceId: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = HoldSeatsSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      const userId = (req.user as { sub: string }).sub;

      try {
        const result = await seatsService.holdSeats(
          req.params.tripInstanceId,
          userId,
          parseResult.data,
        );
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof SeatConflictError) {
          return reply.status(409).send({
            code: 'SEAT_UNAVAILABLE',
            message: 'Un ou plusieurs sièges ne sont plus disponibles',
            conflictingSeats: err.conflictingSeats,
          });
        }
        if ((err as NodeJS.ErrnoException).code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        // C-3 : statut trajet non bookable ou siège hors véhicule → 403
        if ((err as NodeJS.ErrnoException).code === 'FORBIDDEN') {
          return reply.status(403).send({ code: 'FORBIDDEN', message: (err as Error).message });
        }
        req.log.error(err, 'holdSeats error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /trips/:tripInstanceId/seats/hold/:holdId
  // Libération explicite avant paiement — Auth requise
  // ------------------------------------------------------------------
  fastify.delete<{ Params: { tripInstanceId: string; holdId: string } }>(
    '/trips/:tripInstanceId/seats/hold/:holdId',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { tripInstanceId: string; holdId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = (req.user as { sub: string }).sub;

      try {
        await seatsService.releaseHold(
          req.params.tripInstanceId,
          req.params.holdId,
          userId,
        );
        return reply.status(204).send();
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        if (code === 'FORBIDDEN') {
          return reply.status(403).send({ code: 'FORBIDDEN', message: (err as Error).message });
        }
        req.log.error(err, 'releaseHold error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );
}
