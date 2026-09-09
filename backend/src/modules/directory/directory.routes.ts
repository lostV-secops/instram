import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DirectoryService } from './directory.service';
import prisma from '../../infra/db/prisma';

// =====================================================================
// Plugin Fastify — routes Directory (public, pas d'auth)
// Préfixe attendu : /v1/directory (enregistré depuis app.ts)
// Contrat : docs/contrat-api.yaml §Directory
//
//   GET /cooperatives        → liste paginée des coopératives validées
//   GET /cooperatives/:slug  → fiche détail
// =====================================================================

const ListQuerySchema = z.object({
  q: z.string().optional(),
  region: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export default async function directoryRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new DirectoryService(prisma);

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
