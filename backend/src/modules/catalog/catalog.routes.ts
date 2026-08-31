import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CatalogService } from './catalog.service';
import { ListCitiesQuerySchema, CityIdParamSchema } from './catalog.schema';
import prisma from '../../infra/db/prisma';

// =====================================================================
// Plugin Fastify — routes Catalog (lecture seule, pas d'auth requise)
// Préfixe attendu : /v1/catalog (enregistré depuis app.ts)
// Contrat : docs/contrat-api.yaml §/catalog/cities
// =====================================================================

export default async function catalogRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new CatalogService(prisma);

  // ------------------------------------------------------------------
  // GET /cities
  // Cache HTTP public 1 heure (contrat : Cache-Control public max-age=3600)
  // ------------------------------------------------------------------
  fastify.get('/cities', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = ListCitiesQuerySchema.safeParse(req.query);
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
      const result = await service.listCities(parseResult.data, lang);
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.status(200).send(result);
    } catch (err) {
      req.log.error(err, 'catalog listCities error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  });

  // ------------------------------------------------------------------
  // GET /cities/:id
  // ------------------------------------------------------------------
  fastify.get('/cities/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CityIdParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join('; '),
      });
    }

    const lang = resolveLanguage(req.headers['accept-language']);

    try {
      const city = await service.getCityById(parseResult.data.id, lang);
      if (!city) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Ville introuvable' });
      }
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.status(200).send(city);
    } catch (err) {
      req.log.error(err, 'catalog getCityById error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  });
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
