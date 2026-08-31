import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SearchService } from './search.service';
import { SearchTripsQuerySchema } from './search.schema';
import prisma from '../../infra/db/prisma';
import redis from '../../infra/cache/redis';

// =====================================================================
// Plugin Fastify — routes Search
// Préfixe attendu : /v1/search (enregistré depuis app.ts)
// Contrat : docs/contrat-api.yaml §/search/trips
// Pas d'authentification requise (security: [])
// =====================================================================

export default async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new SearchService(prisma, redis);

  // ------------------------------------------------------------------
  // GET /trips
  // Cache Redis 60 s côté serveur (architecture §6.1)
  // Cache HTTP : no-store car la réponse est déjà gérée par Redis
  // ------------------------------------------------------------------
  fastify.get('/trips', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = SearchTripsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join('; '),
      });
    }

    // Langue depuis Accept-Language header (fr par défaut)
    const lang = resolveLanguage(req.headers['accept-language']);

    try {
      const result = await service.searchTrips(parseResult.data, lang);
      // Cache HTTP court : le vrai cache est Redis côté serveur
      reply.header('Cache-Control', 'public, max-age=60');
      return reply.status(200).send(result);
    } catch (err) {
      req.log.error(err, 'search searchTrips error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  });
}

// ---------------------------------------------------------------------------
// Helper : résolution langue FR/MG
// ---------------------------------------------------------------------------
function resolveLanguage(header: string | undefined): string {
  if (!header) return 'fr';
  const normalized = header.toLowerCase().split(',')[0].trim();
  if (normalized === 'mg' || normalized.startsWith('mg-')) return 'mg';
  return 'fr';
}
