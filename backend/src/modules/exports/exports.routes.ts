import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { ExportsService, NotFoundError, ForbiddenError } from './exports.service';
import {
  CreateExportSchema,
  AdminExportListQuerySchema,
} from './exports.schema';
import prisma from '../../infra/db/prisma';

// =====================================================================
// Plugin Fastify — module exports
//
// Routes :
//   GET  /coop/exports              — liste des exports de la coopérative
//   POST /coop/exports              — demander un export (MANIFEST | FINANCIAL_REPORT)
//   GET  /coop/exports/:jobId       — statut + URL signée
//   GET  /admin/exports             — liste globale (admin InsTRAM)
//
// Auth coop : COOP_ADMIN | COOP_ASSISTANT (vérification via Membership)
// Auth admin : ADMIN_SUPER | ADMIN_OPS (vérification via AdminProfile)
// =====================================================================

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

function getUserId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

/** Résout l'ID de coopérative depuis le Membership de l'utilisateur. */
async function resolveCooperativeId(userId: string): Promise<string | null> {
  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      role: { in: ['COOP_ADMIN', 'COOP_ASSISTANT'] },
      active: true,
    },
    select: { cooperativeId: true },
  });
  return membership?.cooperativeId ?? null;
}

export default async function exportsRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ExportsService(prisma);

  // ------------------------------------------------------------------
  // GET /coop/exports
  // Auth : COOP_ADMIN | COOP_ASSISTANT
  // ------------------------------------------------------------------
  fastify.get(
    '/coop/exports',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = getUserId(req);
      const cooperativeId = await resolveCooperativeId(userId);

      if (!cooperativeId) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'Accès réservé aux membres COOP_ADMIN ou COOP_ASSISTANT',
        });
      }

      const jobs = await service.listCoopExports(cooperativeId);
      return reply.status(200).send(jobs);
    },
  );

  // ------------------------------------------------------------------
  // POST /coop/exports
  // Auth : COOP_ADMIN | COOP_ASSISTANT
  // Retourne 202 Accepted (job en file)
  // ------------------------------------------------------------------
  fastify.post(
    '/coop/exports',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');

      const userId = getUserId(req);
      const cooperativeId = await resolveCooperativeId(userId);

      if (!cooperativeId) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'Accès réservé aux membres COOP_ADMIN ou COOP_ASSISTANT',
        });
      }

      const parseResult = CreateExportSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      try {
        const job = await service.createExportJob(userId, cooperativeId, parseResult.data);
        return reply.status(202).send(job);
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
  // GET /coop/exports/:jobId
  // Auth : créateur ou COOP_ADMIN de la même coopérative
  // ------------------------------------------------------------------
  fastify.get(
    '/coop/exports/:jobId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { jobId } = req.params as { jobId: string };
      const userId = getUserId(req);
      const cooperativeId = await resolveCooperativeId(userId);

      // cooperativeId peut être null si l'utilisateur accède en tant que créateur
      // (l'accès est validé côté service par isCreator)
      try {
        const job = await service.getExportJob(
          jobId,
          userId,
          cooperativeId ?? '',
        );
        return reply.status(200).send(job);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        if (code === 'FORBIDDEN') {
          return reply.status(403).send({ code: 'FORBIDDEN', message: (err as Error).message });
        }
        throw err;
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /admin/exports
  // Auth : ADMIN_SUPER | ADMIN_OPS
  // Extension documentée (absent du contrat-api.yaml officiel)
  // ------------------------------------------------------------------
  fastify.get(
    '/admin/exports',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = getUserId(req);
      const adminProfile = await prisma.adminProfile.findUnique({ where: { userId } });

      if (!adminProfile || !['ADMIN_SUPER', 'ADMIN_OPS'].includes(adminProfile.role)) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'Accès réservé aux administrateurs InsTRAM (ADMIN_SUPER ou ADMIN_OPS)',
        });
      }

      const parseResult = AdminExportListQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      const jobs = await service.listAllExports(parseResult.data);
      return reply.status(200).send(jobs);
    },
  );
}

export { NotFoundError, ForbiddenError };
