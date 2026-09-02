/**
 * Routes Notifications — contrat-api.yaml §Notifications
 *
 * GET  /v1/notifications              — historique paginé
 * GET  /v1/notifications/preferences  — préférences SMS
 * PUT  /v1/notifications/preferences  — mettre à jour les préférences
 *
 * Note : le contrat dit PUT (pas PATCH) pour la mise à jour des préférences.
 * La spec de tâche mentionnait PATCH, mais docs/contrat-api.yaml est la
 * source de vérité — PUT est utilisé ici.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { SmsProvider } from '../../infra/sms/provider';
import { NotificationsService } from './notifications.service';

// =====================================================================
// Schémas Zod
// =====================================================================

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const preferencesBodySchema = z.object({
  smsEnabled: z.boolean().optional(),
  optedOutTemplates: z.array(z.string()).optional(),
});

// =====================================================================
// Plugin Fastify
// =====================================================================

export default async function notificationsRoutes(
  fastify: FastifyInstance,
  opts: { db: PrismaClient; redis: Redis; smsProvider: SmsProvider },
): Promise<void> {
  const svc = new NotificationsService(opts.db, opts.redis, opts.smsProvider);

  // ------------------------------------------------------------------
  // GET /v1/notifications
  // Historique des notifications de l'utilisateur connecté (paginé).
  // ------------------------------------------------------------------
  fastify.get(
    '/notifications',
    { preHandler: fastify.authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user as { userId: string };

      const queryParsed = listQuerySchema.safeParse(req.query);
      if (!queryParsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Paramètres de requête invalides',
          details: queryParsed.error.flatten(),
        });
      }

      const { cursor, limit } = queryParsed.data;
      const result = await svc.listForUser(user.userId, cursor, limit);
      return reply.status(200).send(result);
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/notifications/preferences
  // Préférences SMS de l'utilisateur connecté.
  // ------------------------------------------------------------------
  fastify.get(
    '/notifications/preferences',
    { preHandler: fastify.authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user as { userId: string };
      const prefs = await svc.getPreferences(user.userId);
      return reply.status(200).send(prefs);
    },
  );

  // ------------------------------------------------------------------
  // PUT /v1/notifications/preferences
  // Mettre à jour les préférences SMS (ex : opt-out TRIP_REMINDER).
  // ------------------------------------------------------------------
  fastify.put(
    '/notifications/preferences',
    { preHandler: fastify.authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user as { userId: string };

      const bodyParsed = preferencesBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Corps de requête invalide',
          details: bodyParsed.error.flatten(),
        });
      }

      await svc.updatePreferences(user.userId, bodyParsed.data);
      const updated = await svc.getPreferences(user.userId);
      return reply.status(200).send(updated);
    },
  );
}
