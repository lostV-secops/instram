import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DirectoryService } from './directory.service';
import { RatingsService } from '../ratings/ratings.service';
import { RatingListQuerySchema } from '../ratings/ratings.schema';
import prisma from '../../infra/db/prisma';

// =====================================================================
// Plugin Fastify — routes Directory (public, pas d'auth)
// Préfixe attendu : /v1/directory (enregistré depuis app.ts)
// Contrat : docs/contrat-api.yaml §Directory
//
//   GET /cooperatives                    → liste paginée des coopératives validées
//   GET /cooperatives/:slug              → fiche détail
//   GET /cooperatives/:slug/ratings      → avis publics paginés
// =====================================================================

const ListQuerySchema = z.object({
  q: z.string().optional(),
  region: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export default async function directoryRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new DirectoryService(prisma);
  const ratingsService = new RatingsService(prisma);

  // ------------------------------------------------------------------
  // GET /cooperatives
  // Cache public 60 s — l'annuaire change peu souvent (ISR frontend)
  // ------------------------------------------------------------------
  fastify.get(
    '/cooperatives',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parse = ListQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: parse.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        });
      }

      const lang = resolveLanguage(req.headers['accept-language']);

      try {
        const result = await service.listCooperatives(parse.data, lang);
        reply.header('Cache-Control', 'public, max-age=60');
        return reply.status(200).send(result);
      } catch (err) {
        req.log.error(err, 'directory listCooperatives error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /cooperatives/:slug
  // Cache public 60 s
  // ------------------------------------------------------------------
  fastify.get(
    '/cooperatives/:slug',
    async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const { slug } = req.params;
      if (!slug || slug.length > 200) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'slug invalide' });
      }

      const lang = resolveLanguage(req.headers['accept-language']);

      try {
        const entry = await service.getCooperativeBySlug(slug, lang);
        if (!entry) {
          return reply.status(404).send({ code: 'NOT_FOUND', message: 'Coopérative introuvable' });
        }
        reply.header('Cache-Control', 'public, max-age=60');
        return reply.status(200).send(entry);
      } catch (err) {
        req.log.error(err, 'directory getCooperativeBySlug error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );
  // ------------------------------------------------------------------
  // GET /cooperatives/:slug/trips
  // Tous les trajets OPEN_FOR_BOOKING à venir pour une coopérative
  // Public, sans auth, cache 60 s
  // ------------------------------------------------------------------
  fastify.get(
    '/cooperatives/:slug/trips',
    async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const { slug } = req.params;
      if (!slug || slug.length > 200) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'slug invalide' });
      }

      const lang = resolveLanguage(req.headers['accept-language']);

      try {
        const entry = await prisma.directoryEntry.findUnique({
          where: { slug },
          select: {
            cooperativeId: true,
            cooperative: { select: { status: true } },
          },
        });

        if (!entry || entry.cooperative.status !== 'VALIDATED') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: 'Coopérative introuvable' });
        }

        const trips = await prisma.tripInstance.findMany({
          where: {
            cooperativeId: entry.cooperativeId,
            status: 'OPEN_FOR_BOOKING',
            departureAt: { gte: new Date() },
          },
          select: {
            id: true,
            departureAt: true,
            arrivalEstimatedAt: true,
            cooperative: {
              select: { id: true, displayName: true, ratingAverage: true, ratingCount: true },
            },
            route: {
              select: {
                estimatedDurationMin: true,
                origin: { select: { id: true, nameFr: true, nameMg: true } },
                destination: { select: { id: true, nameFr: true, nameMg: true } },
              },
            },
            vehicle: { select: { model: true, capacity: true } },
            fares: { select: { priceMga: true } },
            _count: { select: { bookingSeats: { where: { isActive: true } } } },
          },
          orderBy: { departureAt: 'asc' },
        });

        const items = trips.map((trip) => {
          const prices = trip.fares.map((f) => f.priceMga);
          const fareMinMga = prices.length > 0 ? Math.min(...prices) : 0;
          const fareMaxMga = prices.length > 0 ? Math.max(...prices) : 0;
          const seatsAvailable = Math.max(0, trip.vehicle.capacity - trip._count.bookingSeats);
          return {
            tripInstanceId: trip.id,
            cooperative: {
              id: trip.cooperative.id,
              displayName: trip.cooperative.displayName,
              ratingAverage: trip.cooperative.ratingAverage,
              ratingCount: trip.cooperative.ratingCount,
            },
            route: {
              originCity: {
                id: trip.route.origin.id,
                name: lang === 'mg' ? trip.route.origin.nameMg : trip.route.origin.nameFr,
              },
              destinationCity: {
                id: trip.route.destination.id,
                name: lang === 'mg' ? trip.route.destination.nameMg : trip.route.destination.nameFr,
              },
              estimatedDurationMin: trip.route.estimatedDurationMin,
            },
            departureAt: trip.departureAt.toISOString(),
            arrivalEstimatedAt: trip.arrivalEstimatedAt?.toISOString() ?? null,
            fareMinMga,
            fareMaxMga,
            seatsAvailable,
            vehicle: { model: trip.vehicle.model, capacity: trip.vehicle.capacity },
          };
        });

        reply.header('Cache-Control', 'public, max-age=60');
        return reply.status(200).send({ items, nextCursor: null });
      } catch (err) {
        req.log.error(err, 'directory trips error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /cooperatives/:slug/ratings
  // Public — avis approuvés et anonymisés, paginés
  // Contrat : docs/contrat-api.yaml §Directory GET /directory/cooperatives/{slug}/ratings
  // ------------------------------------------------------------------
  fastify.get(
    '/cooperatives/:slug/ratings',
    async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const { slug } = req.params;
      if (!slug || slug.length > 200) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'slug invalide' });
      }

      const parseResult = RatingListQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        });
      }

      try {
        const entry = await prisma.directoryEntry.findUnique({
          where: { slug },
          select: {
            cooperativeId: true,
            cooperative: { select: { status: true } },
          },
        });

        if (!entry || entry.cooperative.status !== 'VALIDATED') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: 'Coopérative introuvable' });
        }

        const result = await ratingsService.listApprovedRatings(entry.cooperativeId, parseResult.data);
        reply.header('Cache-Control', 'public, max-age=60');
        return reply.status(200).send(result);
      } catch (err) {
        req.log.error(err, 'directory ratings error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Helper : résolution langue FR/MG depuis Accept-Language header
// ---------------------------------------------------------------------------
function resolveLanguage(header: string | undefined): string {
  if (!header) return 'fr';
  const normalized = header.toLowerCase().split(',')[0].trim();
  if (normalized === 'mg' || normalized.startsWith('mg-')) return 'mg';
  return 'fr';
}
