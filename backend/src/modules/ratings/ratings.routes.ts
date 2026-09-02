import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import {
  RatingsService,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from './ratings.service';
import {
  CreateRatingSchema,
  RatingListQuerySchema,
  AdminRatingListQuerySchema,
  ModerateRatingSchema,
} from './ratings.schema';
import prisma from '../../infra/db/prisma';

// =====================================================================
// Plugin Fastify — module ratings
//
// Routes :
//   POST  /bookings/:bookingId/rating     — voyageur authentifié (RG-11, RG-12)
//   GET   /ratings/cooperative/:coop      — public (liste paginée anonymisée)
//   GET   /cooperatives/:id/rating-summary — public (résumé + distribution)
//   GET   /admin/ratings                  — admin InsTRAM (modération)
//   PATCH /admin/ratings/:ratingId        — admin InsTRAM (publier / rejeter)
//
// Note : l'endpoint POST suit le contrat-api.yaml §Traveler-Bookings :
//   POST /bookings/{bookingId}/rating (bookingId dans l'URL).
//   La tâche mentionnait POST /ratings avec bookingId dans le body —
//   le contrat officiel a été retenu (bookingId dans le path).
// =====================================================================

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

function getUserId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

export default async function ratingsRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new RatingsService(prisma);

  // ------------------------------------------------------------------
  // POST /bookings/:bookingId/rating
  // Auth : voyageur (JWT)
  // RG-11 : Booking.status = COMPLETED
  // RG-12 : une note par voyage
  // ------------------------------------------------------------------
  fastify.post(
    '/bookings/:bookingId/rating',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      const { bookingId } = req.params as { bookingId: string };

      const parseResult = CreateRatingSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      try {
        const rating = await service.createRating(
          getUserId(req),
          bookingId,
          parseResult.data,
        );
        return reply.status(201).send(rating);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        if (code === 'FORBIDDEN') {
          return reply.status(403).send({ code: 'FORBIDDEN', message: (err as Error).message });
        }
        if (code === 'CONFLICT') {
          return reply.status(409).send({ code: 'ALREADY_RATED', message: (err as Error).message });
        }
        if (code === 'VALIDATION_ERROR') {
          return reply.status(400).send({ code: 'RATING_WINDOW_EXPIRED', message: (err as Error).message });
        }
        throw err;
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /ratings/cooperative/:cooperativeId
  // Public — liste des avis approuvés, paginée, anonymisée
  // ------------------------------------------------------------------
  fastify.get(
    '/ratings/cooperative/:cooperativeId',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { cooperativeId } = req.params as { cooperativeId: string };
      const parseResult = RatingListQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      try {
        const result = await service.listApprovedRatings(
          cooperativeId,
          parseResult.data,
        );
        reply.header('Cache-Control', 'public, max-age=60');
        return reply.status(200).send(result);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        throw err;
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /cooperatives/:cooperativeId/rating-summary
  // Public — moyenne, total, distribution
  // ------------------------------------------------------------------
  fastify.get(
    '/cooperatives/:cooperativeId/rating-summary',
    async (req: FastifyRequest<{ Params: { cooperativeId: string } }>, reply: FastifyReply) => {
      try {
        const summary = await service.getRatingSummary(req.params.cooperativeId);
        reply.header('Cache-Control', 'public, max-age=60');
        return reply.status(200).send(summary);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        throw err;
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /admin/ratings
  // Auth : ADMIN_SUPER | ADMIN_OPS | ADMIN_MODERATOR
  // Contrat : docs/contrat-api.yaml §Admin
  // ------------------------------------------------------------------
  fastify.get(
    '/admin/ratings',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      // Vérification du rôle admin (AdminProfile requis)
      const userId = getUserId(req);
      const adminProfile = await prisma.adminProfile.findUnique({ where: { userId } });
      if (!adminProfile) {
        return reply.status(403).send({ code: 'FORBIDDEN', message: 'Accès réservé aux administrateurs InsTRAM' });
      }

      const parseResult = AdminRatingListQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      const ratings = await service.listRatingsAdmin(parseResult.data);
      return reply.status(200).send(ratings);
    },
  );

  // ------------------------------------------------------------------
  // PATCH /admin/ratings/:ratingId
  // Auth : ADMIN_SUPER | ADMIN_OPS | ADMIN_MODERATOR
  // Contrat : docs/contrat-api.yaml §Admin
  // ------------------------------------------------------------------
  fastify.patch(
    '/admin/ratings/:ratingId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { ratingId } = req.params as { ratingId: string };
      const userId = getUserId(req);
      const adminProfile = await prisma.adminProfile.findUnique({ where: { userId } });
      if (!adminProfile) {
        return reply.status(403).send({ code: 'FORBIDDEN', message: 'Accès réservé aux administrateurs InsTRAM' });
      }

      const parseResult = ModerateRatingSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      try {
        const updated = await service.moderateRating(userId, ratingId, parseResult.data);
        return reply.status(200).send(updated);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        throw err;
      }
    },
  );
}

// Named exports des classes d'erreur pour usage dans les tests
export { NotFoundError, ForbiddenError, ConflictError, ValidationError };
