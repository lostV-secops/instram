// =====================================================================
// admin.routes.ts — Plugin Fastify du module Admin
//
// Console admin InsTRAM : FR uniquement (CDC §5.6).
// Préfixe attendu : /v1/admin (enregistré depuis app.ts).
//
// Contrat de référence : docs/contrat-api.yaml §Admin
//
// Hypothèses documentées : voir admin.schema.ts (H-ADM-01 à H-ADM-08)
//
// Contrôle d'accès :
//   - Tous les endpoints : JWT valide + AdminProfile existant.
//   - requireAdminRole(roles) : factory de preHandler qui vérifie le rôle.
//     Rôles autorisés par endpoint :
//       ADMIN_SUPER, ADMIN_OPS : gestion coops, plans, abonnements, users
//       ADMIN_MODERATOR : uniquement /admin/ratings/*
//     L'AdminContext (actorUserId, ip, userAgent) est transmis au service
//     pour alimenter les AuditLogs.
//
// Discordances contrat vs tâche (implémentation des deux) :
//   - POST validate/suspend/reject (contrat POST, tâche PATCH → les deux)
//   - GET /admin/stats alias de GET /admin/dashboard (H-ADM-04)
//   - GET /admin/audit-log alias de GET /admin/audit-logs (H-ADM-05)
//   - PATCH /ratings/:id/approve|reject raccourcis (H-ADM-08)
//   - Endpoints mark-paid, reinstate, reject absents du contrat (H-ADM-06)
// =====================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { PlatformRole } from '@prisma/client';
import { AdminService } from './admin.service';
import {
  ListCooperativesQuerySchema,
  SuspendRejectBodySchema,
  CreatePricingPlanBodySchema,
  CreateSubscriptionBodySchema,
  ModerateRatingBodySchema,
  ListUsersQuerySchema,
  SuspendUserBodySchema,
  AuditLogQuerySchema,
  ListRatingsQuerySchema,
  ListTripsQuerySchema,
  ListPaymentsQuerySchema,
  UpdateSettingsBodySchema,
  CreateTemplateSchema,
  UpdateTemplateSchema,
} from './admin.schema';
import prisma from '../../infra/db/prisma';

// =====================================================================
// Helpers
// =====================================================================

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

function getUserId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

/**
 * requireAdminRole — factory de preHandler Fastify.
 * Vérifie que l'utilisateur authentifié possède un AdminProfile
 * avec l'un des rôles spécifiés.
 * S'utilise dans onRequest APRÈS fastify.authenticate :
 *   { onRequest: [fastify.authenticate, requireAdminRole(service, roles)] }
 */
function requireAdminRole(
  service: AdminService,
  roles: PlatformRole[],
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getUserId(req);
      const profile = await service.requireAdminProfile(userId, roles);
      // Expose le profil sur la requête pour usage éventuel dans les handlers
      (req as FastifyRequest & { adminProfile: typeof profile }).adminProfile = profile;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'FORBIDDEN') {
        return reply.status(403).send({ code: 'FORBIDDEN', message: (err as Error).message });
      }
      req.log.error(err, 'requireAdminRole: unexpected error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  };
}

/**
 * Extrait le contexte admin (actorUserId, ip, userAgent) pour AuditLog.
 */
function getAdminContext(req: FastifyRequest) {
  return {
    actorUserId: getUserId(req),
    ipAddress: req.ip ?? undefined,
    userAgent: req.headers['user-agent'] ?? undefined,
  };
}

/**
 * Handler d'erreur unifié pour les routes admin.
 */
function handleError(err: unknown, req: FastifyRequest, reply: FastifyReply, context: string) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: (err as Error).message });
  if (code === 'FORBIDDEN') return reply.status(403).send({ code, message: (err as Error).message });
  if (code === 'CONFLICT') return reply.status(409).send({ code, message: (err as Error).message });
  req.log.error(err, `admin/${context} error`);
  return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
}

// =====================================================================
// Plugin principal
// =====================================================================

export default async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new AdminService(prisma);

  // Hooks de rôle réutilisables
  const requireSuperOrOps = requireAdminRole(service, [
    PlatformRole.ADMIN_SUPER,
    PlatformRole.ADMIN_OPS,
  ]);
  const requireAnyAdmin = requireAdminRole(service, [
    PlatformRole.ADMIN_SUPER,
    PlatformRole.ADMIN_OPS,
    PlatformRole.ADMIN_MODERATOR,
  ]);
  const requireModerator = requireAdminRole(service, [
    PlatformRole.ADMIN_SUPER,
    PlatformRole.ADMIN_OPS,
    PlatformRole.ADMIN_MODERATOR,
  ]);

  // ==================================================================
  // GESTION DES COOPÉRATIVES
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/cooperatives — liste paginée
  // ------------------------------------------------------------------
  fastify.get(
    '/cooperatives',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parse = ListCooperativesQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }
      try {
        const result = await service.listCooperatives(parse.data);
        return reply.send(result);
      } catch (err) {
        return handleError(err, req, reply, 'listCooperatives');
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /admin/cooperatives/:cooperativeId — détail complet
  // ------------------------------------------------------------------
  fastify.get<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest<{ Params: { cooperativeId: string } }>, reply: FastifyReply) => {
      try {
        const detail = await service.getCooperativeDetail(req.params.cooperativeId);
        return reply.send(detail);
      } catch (err) {
        return handleError(err, req, reply, 'getCooperativeDetail');
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /admin/cooperatives/:cooperativeId/validate (contrat)
  // PATCH /admin/cooperatives/:cooperativeId/validate (tâche — H-ADM-01)
  // ------------------------------------------------------------------
  const validateHandler = async (
    req: FastifyRequest<{ Params: { cooperativeId: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      const coop = await service.validateCooperative(
        req.params.cooperativeId,
        getAdminContext(req),
      );
      return reply.send(coop);
    } catch (err) {
      return handleError(err, req, reply, 'validateCooperative');
    }
  };

  fastify.post<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/validate',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    validateHandler,
  );
  // Alias PATCH (H-ADM-01 — tâche)
  fastify.patch<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/validate',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    validateHandler,
  );

  // ------------------------------------------------------------------
  // POST /admin/cooperatives/:cooperativeId/suspend (contrat)
  // PATCH /admin/cooperatives/:cooperativeId/suspend (tâche — H-ADM-01)
  // ------------------------------------------------------------------
  const suspendCoopHandler = async (
    req: FastifyRequest<{ Params: { cooperativeId: string } }>,
    reply: FastifyReply,
  ) => {
    const parse = SuspendRejectBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
    }
    try {
      const coop = await service.suspendCooperative(
        req.params.cooperativeId,
        parse.data,
        getAdminContext(req),
      );
      return reply.send(coop);
    } catch (err) {
      return handleError(err, req, reply, 'suspendCooperative');
    }
  };

  fastify.post<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/suspend',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    suspendCoopHandler,
  );
  // Alias PATCH (H-ADM-01 — tâche)
  fastify.patch<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/suspend',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    suspendCoopHandler,
  );

  // ------------------------------------------------------------------
  // POST /admin/cooperatives/:cooperativeId/reject (tâche — H-ADM-02)
  // PATCH /admin/cooperatives/:cooperativeId/reject (tâche — H-ADM-02)
  // Non présent dans le contrat API — documenté comme extension.
  // ------------------------------------------------------------------
  const rejectCoopHandler = async (
    req: FastifyRequest<{ Params: { cooperativeId: string } }>,
    reply: FastifyReply,
  ) => {
    const parse = SuspendRejectBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
    }
    try {
      const coop = await service.rejectCooperative(
        req.params.cooperativeId,
        parse.data,
        getAdminContext(req),
      );
      return reply.send(coop);
    } catch (err) {
      return handleError(err, req, reply, 'rejectCooperative');
    }
  };

  fastify.post<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/reject',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    rejectCoopHandler,
  );
  fastify.patch<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/reject',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    rejectCoopHandler,
  );

  // ------------------------------------------------------------------
  // POST /admin/cooperatives/:cooperativeId/reactivate — SUSPENDED → VALIDATED
  // ------------------------------------------------------------------
  fastify.post<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/reactivate',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest<{ Params: { cooperativeId: string } }>, reply: FastifyReply) => {
      try {
        const coop = await service.reactivateCooperative(
          req.params.cooperativeId,
          getAdminContext(req),
        );
        return reply.send(coop);
      } catch (err) {
        return handleError(err, req, reply, 'reactivateCooperative');
      }
    },
  );

  // ==================================================================
  // PLANS TARIFAIRES
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/cooperatives/:cooperativeId/pricing — historique (tâche)
  // ------------------------------------------------------------------
  fastify.get<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/pricing',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest<{ Params: { cooperativeId: string } }>, reply: FastifyReply) => {
      try {
        const plans = await service.listPricingPlans(req.params.cooperativeId);
        return reply.send(plans);
      } catch (err) {
        return handleError(err, req, reply, 'listPricingPlans');
      }
    },
  );

  // ------------------------------------------------------------------
  // PUT /admin/cooperatives/:cooperativeId/pricing-plan (contrat)
  // POST /admin/cooperatives/:cooperativeId/pricing (tâche — alias)
  // Créer un nouveau plan, clôturer l'ancien. AuditLog COOP_PLAN_CHANGED.
  // ------------------------------------------------------------------
  const createPlanHandler = async (
    req: FastifyRequest<{ Params: { cooperativeId: string } }>,
    reply: FastifyReply,
  ) => {
    const parse = CreatePricingPlanBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
    }
    try {
      const plan = await service.createPricingPlan(
        req.params.cooperativeId,
        parse.data,
        getAdminContext(req),
      );
      return reply.status(201).send(plan);
    } catch (err) {
      return handleError(err, req, reply, 'createPricingPlan');
    }
  };

  fastify.put<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/pricing-plan',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    createPlanHandler,
  );
  // Alias POST (tâche)
  fastify.post<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/pricing',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    createPlanHandler,
  );

  // ==================================================================
  // ABONNEMENTS
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/cooperatives/:cooperativeId/subscriptions
  // ------------------------------------------------------------------
  fastify.get<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/subscriptions',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest<{ Params: { cooperativeId: string } }>, reply: FastifyReply) => {
      try {
        const subs = await service.listSubscriptions(req.params.cooperativeId);
        return reply.send(subs);
      } catch (err) {
        return handleError(err, req, reply, 'listSubscriptions');
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /admin/cooperatives/:cooperativeId/subscriptions
  // ------------------------------------------------------------------
  fastify.post<{ Params: { cooperativeId: string } }>(
    '/cooperatives/:cooperativeId/subscriptions',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest<{ Params: { cooperativeId: string } }>, reply: FastifyReply) => {
      const parse = CreateSubscriptionBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }
      try {
        const sub = await service.createSubscription(req.params.cooperativeId, parse.data);
        return reply.status(201).send(sub);
      } catch (err) {
        return handleError(err, req, reply, 'createSubscription');
      }
    },
  );

  // ------------------------------------------------------------------
  // PATCH /admin/subscriptions/:subscriptionId/mark-paid (tâche — H-ADM-06)
  // Non présent dans le contrat API.
  // ------------------------------------------------------------------
  fastify.patch<{ Params: { subscriptionId: string } }>(
    '/subscriptions/:subscriptionId/mark-paid',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest<{ Params: { subscriptionId: string } }>, reply: FastifyReply) => {
      try {
        const sub = await service.markSubscriptionPaid(req.params.subscriptionId);
        return reply.send(sub);
      } catch (err) {
        return handleError(err, req, reply, 'markSubscriptionPaid');
      }
    },
  );

  // ==================================================================
  // MODÉRATION DES AVIS
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/ratings — liste avec filtre statut (défaut : PENDING_REVIEW)
  // ------------------------------------------------------------------
  fastify.get(
    '/ratings',
    { onRequest: [fastify.authenticate, requireModerator] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parse = ListRatingsQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }
      try {
        const result = await service.listRatings(parse.data);
        return reply.send(result);
      } catch (err) {
        return handleError(err, req, reply, 'listRatings');
      }
    },
  );

  // ------------------------------------------------------------------
  // PATCH /admin/ratings/:ratingId — approuver ou rejeter (contrat)
  // Body : { status: 'PUBLISHED' | 'REJECTED', moderationNote?: string }
  // ------------------------------------------------------------------
  fastify.patch<{ Params: { ratingId: string } }>(
    '/ratings/:ratingId',
    { onRequest: [fastify.authenticate, requireModerator] },
    async (req: FastifyRequest<{ Params: { ratingId: string } }>, reply: FastifyReply) => {
      const parse = ModerateRatingBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }
      try {
        const rating = await service.moderateRating(
          req.params.ratingId,
          parse.data,
          getAdminContext(req),
        );
        return reply.send(rating);
      } catch (err) {
        return handleError(err, req, reply, 'moderateRating');
      }
    },
  );

  // ------------------------------------------------------------------
  // PATCH /admin/ratings/:ratingId/approve — raccourci tâche (H-ADM-08)
  // ------------------------------------------------------------------
  fastify.patch<{ Params: { ratingId: string } }>(
    '/ratings/:ratingId/approve',
    { onRequest: [fastify.authenticate, requireModerator] },
    async (req: FastifyRequest<{ Params: { ratingId: string } }>, reply: FastifyReply) => {
      try {
        const rating = await service.moderateRating(
          req.params.ratingId,
          { status: 'PUBLISHED' },
          getAdminContext(req),
        );
        return reply.send(rating);
      } catch (err) {
        return handleError(err, req, reply, 'approveRating');
      }
    },
  );

  // ------------------------------------------------------------------
  // PATCH /admin/ratings/:ratingId/reject — raccourci tâche (H-ADM-08)
  // ------------------------------------------------------------------
  fastify.patch<{ Params: { ratingId: string } }>(
    '/ratings/:ratingId/reject',
    { onRequest: [fastify.authenticate, requireModerator] },
    async (req: FastifyRequest<{ Params: { ratingId: string } }>, reply: FastifyReply) => {
      const parse = SuspendRejectBodySchema.safeParse(req.body);
      const moderationNote = parse.success ? parse.data.reason : undefined;
      try {
        const rating = await service.moderateRating(
          req.params.ratingId,
          { status: 'REJECTED', moderationNote },
          getAdminContext(req),
        );
        return reply.send(rating);
      } catch (err) {
        return handleError(err, req, reply, 'rejectRating');
      }
    },
  );

  // ==================================================================
  // GESTION DES UTILISATEURS
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/users — liste paginée avec filtres
  // ------------------------------------------------------------------
  fastify.get(
    '/users',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parse = ListUsersQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }
      try {
        const result = await service.listUsers(parse.data);
        return reply.send(result);
      } catch (err) {
        return handleError(err, req, reply, 'listUsers');
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /admin/users/:userId — profil d'un utilisateur
  // ------------------------------------------------------------------
  fastify.get(
    '/users/:userId',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
      try {
        const result = await service.getUser(req.params.userId);
        return reply.send(result);
      } catch (err) {
        return handleError(err, req, reply, 'getUser');
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /admin/users/:userId/suspend (contrat)
  // PATCH /admin/users/:userId/suspend (tâche — H-ADM-01)
  // ------------------------------------------------------------------
  const suspendUserHandler = async (
    req: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) => {
    const parse = SuspendUserBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
    }
    try {
      const user = await service.suspendUser(
        req.params.userId,
        parse.data,
        getAdminContext(req),
      );
      return reply.send(user);
    } catch (err) {
      return handleError(err, req, reply, 'suspendUser');
    }
  };

  fastify.post<{ Params: { userId: string } }>(
    '/users/:userId/suspend',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    suspendUserHandler,
  );
  // Alias PATCH (tâche — H-ADM-01)
  fastify.patch<{ Params: { userId: string } }>(
    '/users/:userId/suspend',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    suspendUserHandler,
  );

  // ------------------------------------------------------------------
  // PATCH /admin/users/:userId/reinstate (tâche — non dans le contrat)
  // ------------------------------------------------------------------
  fastify.patch<{ Params: { userId: string } }>(
    '/users/:userId/reinstate',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
      try {
        const user = await service.reinstateUser(req.params.userId, getAdminContext(req));
        return reply.send(user);
      } catch (err) {
        return handleError(err, req, reply, 'reinstateUser');
      }
    },
  );

  // ==================================================================
  // SUPERVISION
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/dashboard (contrat) + alias GET /admin/stats (tâche — H-ADM-04)
  // ------------------------------------------------------------------
  const statsHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await service.getStats();
      return reply.send(stats);
    } catch (err) {
      _req.log.error(err, 'admin/getStats error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  };

  fastify.get(
    '/dashboard',
    { onRequest: [fastify.authenticate, requireAnyAdmin] },
    statsHandler,
  );
  // Alias /stats (tâche — H-ADM-04)
  fastify.get(
    '/stats',
    { onRequest: [fastify.authenticate, requireAnyAdmin] },
    statsHandler,
  );

  // ------------------------------------------------------------------
  // GET /admin/audit-logs (contrat) + alias GET /admin/audit-log (H-ADM-05)
  // ------------------------------------------------------------------
  const auditLogHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = AuditLogQuerySchema.safeParse(req.query);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
    }
    try {
      const result = await service.getAuditLog(parse.data);
      return reply.send(result);
    } catch (err) {
      return handleError(err, req, reply, 'getAuditLog');
    }
  };

  fastify.get(
    '/audit-logs',
    { onRequest: [fastify.authenticate, requireAnyAdmin] },
    auditLogHandler,
  );
  // Alias /audit-log (tâche — H-ADM-05)
  fastify.get(
    '/audit-log',
    { onRequest: [fastify.authenticate, requireAnyAdmin] },
    auditLogHandler,
  );

  // ==================================================================
  // TRAJETS — SUPERVISION
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/trips — liste paginée de tous les trajets
  // ------------------------------------------------------------------
  fastify.get(
    '/trips',
    { onRequest: [fastify.authenticate, requireAnyAdmin] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parse = ListTripsQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }
      try {
        const result = await service.listTrips(parse.data);
        return reply.send(result);
      } catch (err) {
        return handleError(err, req, reply, 'listTrips');
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /admin/payments — supervision des paiements
  // ------------------------------------------------------------------
  fastify.get(
    '/payments',
    { onRequest: [fastify.authenticate, requireAnyAdmin] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parse = ListPaymentsQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }
      try {
        const result = await service.listPayments(parse.data);
        return reply.send(result);
      } catch (err) {
        return handleError(err, req, reply, 'listPayments');
      }
    },
  );

  // ==================================================================
  // PARAMÈTRES PLATEFORME
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/settings — politique de frais active + horaires SMS
  // ------------------------------------------------------------------
  fastify.get(
    '/settings',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        const settings = await service.getSettings();
        return reply.send(settings);
      } catch (err) {
        _req.log.error(err, 'admin/getSettings error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // PUT /admin/settings — mettre à jour la politique de frais plateforme
  // ------------------------------------------------------------------
  fastify.put(
    '/settings',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parse = UpdateSettingsBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }
      try {
        const result = await service.updateSettings(parse.data, getAdminContext(req));
        return reply.send(result);
      } catch (err) {
        return handleError(err, req, reply, 'updateSettings');
      }
    },
  );

  // =====================================================================
  // Templates de notifications (GAP 5 — CDC §5.5)
  // =====================================================================

  // GET /admin/notifications/templates — liste tous les templates
  fastify.get(
    '/notifications/templates',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        return reply.send(await service.listTemplates());
      } catch (err) {
        return handleError(err, _req, reply, 'listTemplates');
      }
    },
  );

  // GET /admin/notifications/templates/:code — détail d'un template
  fastify.get(
    '/notifications/templates/:code',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { code } = req.params as { code: string };
      try {
        return reply.send(await service.getTemplate(code));
      } catch (err) {
        return handleError(err, req, reply, 'getTemplate');
      }
    },
  );

  // POST /admin/notifications/templates — créer un template
  fastify.post(
    '/notifications/templates',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parse = CreateTemplateSchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }
      try {
        const template = await service.createTemplate(parse.data);
        return reply.status(201).send(template);
      } catch (err) {
        return handleError(err, req, reply, 'createTemplate');
      }
    },
  );

  // PATCH /admin/notifications/templates/:code — modifier un template
  fastify.patch(
    '/notifications/templates/:code',
    { onRequest: [fastify.authenticate, requireSuperOrOps] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { code } = req.params as { code: string };
      const parse = UpdateTemplateSchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }
      try {
        const updated = await service.updateTemplate(code, parse.data);
        return reply.send(updated);
      } catch (err) {
        return handleError(err, req, reply, 'updateTemplate');
      }
    },
  );
}
