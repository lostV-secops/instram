import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import {
  BookingsService,
  ConflictError,
} from './bookings.service';
import {
  CreateBookingSchema,
  WalkInBookingSchema,
  CancelAtCounterSchema,
  BookingListQuerySchema,
  WebhookPayloadSchema,
} from './bookings.schema';
import prisma from '../../infra/db/prisma';
import redis from '../../infra/cache/redis';
import { mobileMoneyGateway } from '../../infra/mobileMoney/gateway';
import { WebhookSignatureError, createPaymentsService } from '../payments/payments.routes';

// =====================================================================
// Plugin Fastify — module bookings
// Périmètre :
//   POST   /v1/bookings
//   GET    /v1/bookings
//   GET    /v1/bookings/:bookingId
//   POST   /v1/coop/bookings/walk-in
//   POST   /v1/coop/bookings/:bookingId/cancel-at-counter
//   POST   /v1/webhooks/mobile-money/:provider
//
// POST /v1/payments et GET /v1/payments/:paymentId sont dans payments.routes.ts.
// Le webhook délègue à PaymentsService.handleWebhook() (refactoring §3 architecture).
//
// Contrat : docs/contrat-api.yaml §Traveler-Bookings, §Cooperative-Bookings
// RG-03 : PAS de DELETE /bookings côté voyageur — endpoint délibérément absent
// =====================================================================

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

/** Extrait le userId depuis le JWT vérifié. */
function getUserId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

export default async function bookingsRoutes(fastify: FastifyInstance): Promise<void> {
  const bookingsService = new BookingsService(prisma, redis, mobileMoneyGateway);
  // PaymentsService pour le webhook (délégation — POST /payments est dans payments.routes.ts)
  const paymentsService = createPaymentsService();

  // ------------------------------------------------------------------
  // POST /bookings — Créer une réservation en ligne (PENDING_PAYMENT)
  // Auth obligatoire. Cache-Control: no-store.
  // ------------------------------------------------------------------
  fastify.post(
    '/bookings',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');

      const parseResult = CreateBookingSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      try {
        const booking = await bookingsService.createOnlineBooking(
          getUserId(req),
          parseResult.data,
        );
        return reply.status(201).send(booking);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'CONFLICT') {
          return reply.status(409).send({
            code: 'HOLD_EXPIRED_OR_CONFLICT',
            message: (err as Error).message,
          });
        }
        req.log.error(err, 'createOnlineBooking error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /bookings — Historique voyageur (paginé)
  // Auth obligatoire.
  // ------------------------------------------------------------------
  fastify.get(
    '/bookings',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseResult = BookingListQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      try {
        const result = await bookingsService.getBookings(getUserId(req), parseResult.data);
        return reply.status(200).send(result);
      } catch (err) {
        req.log.error(err, 'getBookings error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /bookings/:bookingId — Détail + billet (QR si CONFIRMED)
  // Auth obligatoire. Cache-Control: no-store.
  // ------------------------------------------------------------------
  fastify.get<{ Params: { bookingId: string } }>(
    '/bookings/:bookingId',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { bookingId: string } }>,
      reply: FastifyReply,
    ) => {
      reply.header('Cache-Control', 'no-store');

      try {
        const result = await bookingsService.getBookingById(
          req.params.bookingId,
          getUserId(req),
        );
        return reply.status(200).send(result);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        if (code === 'FORBIDDEN') {
          return reply.status(403).send({ code: 'FORBIDDEN', message: (err as Error).message });
        }
        req.log.error(err, 'getBookingById error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /bookings/:bookingId/ticket — billet QR (contrat §/bookings/{id}/ticket)
  // ------------------------------------------------------------------
  fastify.get<{ Params: { bookingId: string } }>(
    '/bookings/:bookingId/ticket',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { bookingId: string } }>,
      reply: FastifyReply,
    ) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const ticket = await bookingsService.getBookingTicket(req.params.bookingId, getUserId(req));
        return reply.status(200).send(ticket);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        if (code === 'FORBIDDEN') return reply.status(403).send({ code: 'FORBIDDEN', message: (err as Error).message });
        req.log.error(err, 'getBookingTicket error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /bookings/:bookingId/resend-ticket
  // Renvoi SMS du billet — voyageur authentifié uniquement.
  // ------------------------------------------------------------------
  fastify.post<{ Params: { bookingId: string } }>(
    '/bookings/:bookingId/resend-ticket',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { bookingId: string } }>,
      reply: FastifyReply,
    ) => {
      reply.header('Cache-Control', 'no-store');
      try {
        await bookingsService.resendTicket(req.params.bookingId, getUserId(req));
        return reply.status(200).send({ message: 'Billet renvoyé par SMS' });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        req.log.error(err, 'resendTicket error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // NOTE : POST /payments est dans payments.routes.ts (refactoring PaymentsService §3)

  // ------------------------------------------------------------------
  // GET /coop/bookings — liste des réservations de la coopérative (paginée)
  // Auth + rôle coop requis.
  // ------------------------------------------------------------------
  fastify.get(
    '/coop/bookings',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseResult = BookingListQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parseResult.error) });
      }

      const user = req.user as { sub: string; roles: string[] };
      const hasCoopRole = user.roles.some((r) => r.startsWith('COOP_'));
      if (!hasCoopRole) {
        return reply.status(403).send({ code: 'FORBIDDEN', message: 'Rôle coopérative requis' });
      }

      const membership = await prisma.membership.findFirst({
        where: { userId: user.sub, active: true },
        select: { cooperativeId: true },
      });
      if (!membership) {
        return reply.status(403).send({ code: 'FORBIDDEN', message: 'Membership coopérative actif introuvable' });
      }

      try {
        const result = await bookingsService.getCoopBookings(membership.cooperativeId, parseResult.data);
        return reply.send(result);
      } catch (err) {
        req.log.error(err, 'getCoopBookings error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /coop/bookings/:bookingId — détail d'une réservation (vue coop)
  // ------------------------------------------------------------------
  fastify.get<{ Params: { bookingId: string } }>(
    '/coop/bookings/:bookingId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { bookingId: string } }>, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');

      const user = req.user as { sub: string; roles: string[] };
      const hasCoopRole = user.roles.some((r) => r.startsWith('COOP_'));
      if (!hasCoopRole) {
        return reply.status(403).send({ code: 'FORBIDDEN', message: 'Rôle coopérative requis' });
      }

      const membership = await prisma.membership.findFirst({
        where: { userId: user.sub, active: true },
        select: { cooperativeId: true },
      });
      if (!membership) {
        return reply.status(403).send({ code: 'FORBIDDEN', message: 'Membership coopérative actif introuvable' });
      }

      try {
        const result = await bookingsService.getCoopBookingById(membership.cooperativeId, req.params.bookingId);
        return reply.send(result);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: (err as Error).message });
        req.log.error(err, 'getCoopBookingById error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /coop/bookings/walk-in
  // Auth obligatoire + rôle COOP_ADMIN ou COOP_ASSISTANT requis
  // RG-02 : PlatformFee = 0, Commission = 0
  // ------------------------------------------------------------------
  fastify.post(
    '/coop/bookings/walk-in',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');

      // Vérification du rôle coop
      const user = req.user as { sub: string; roles: string[] };
      const hasCoopRole =
        user.roles.includes('COOP_ADMIN') || user.roles.includes('COOP_ASSISTANT');

      if (!hasCoopRole) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'Rôle COOP_ADMIN ou COOP_ASSISTANT requis',
        });
      }

      const parseResult = WalkInBookingSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      // Retrouver la coopérative active de l'utilisateur
      const membership = await prisma.membership.findFirst({
        where: {
          userId: user.sub,
          role: { in: ['COOP_ADMIN', 'COOP_ASSISTANT'] },
          active: true,
        },
        select: { cooperativeId: true },
      });

      if (!membership) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'Membership coopérative actif introuvable',
        });
      }

      try {
        const result = await bookingsService.createWalkIn(
          user.sub,
          membership.cooperativeId,
          parseResult.data,
        );
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof ConflictError) {
          return reply.status(409).send({
            code: 'SEAT_UNAVAILABLE',
            message: err.message,
            conflictingSeats: err.conflictingSeats ?? [],
          });
        }
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        if (code === 'FORBIDDEN') {
          return reply.status(403).send({ code: 'FORBIDDEN', message: (err as Error).message });
        }
        req.log.error(err, 'createWalkIn error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /coop/bookings/:bookingId/cancel-at-counter
  // Seul point d'annulation autorisé (RG-03).
  // Auth obligatoire + rôle COOP_ADMIN ou COOP_ASSISTANT.
  // Pas de remboursement automatique — processus physique uniquement.
  // ------------------------------------------------------------------
  fastify.post<{ Params: { bookingId: string } }>(
    '/coop/bookings/:bookingId/cancel-at-counter',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { bookingId: string } }>,
      reply: FastifyReply,
    ) => {
      const user = req.user as { sub: string; roles: string[] };
      const hasCoopRole =
        user.roles.includes('COOP_ADMIN') || user.roles.includes('COOP_ASSISTANT');

      if (!hasCoopRole) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'Rôle COOP_ADMIN ou COOP_ASSISTANT requis',
        });
      }

      const parseResult = CancelAtCounterSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      const membership = await prisma.membership.findFirst({
        where: {
          userId: user.sub,
          role: { in: ['COOP_ADMIN', 'COOP_ASSISTANT'] },
          active: true,
        },
        select: { cooperativeId: true },
      });

      if (!membership) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'Membership coopérative actif introuvable',
        });
      }

      try {
        const result = await bookingsService.cancelAtCounter(
          req.params.bookingId,
          user.sub,
          membership.cooperativeId,
          parseResult.data,
        );
        return reply.status(200).send(result);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        if (code === 'CONFLICT') {
          return reply.status(409).send({ code: 'BOOKING_ALREADY_CANCELLED_OR_COMPLETED', message: (err as Error).message });
        }
        req.log.error(err, 'cancelAtCounter error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /webhooks/mobile-money/:provider
  // Pas d'auth JWT — signature vérifiée via HMAC (architecture §7.4).
  // Délègue à PaymentsService.handleWebhook() (refactoring architecture §3).
  // Idempotence garantie par providerTransactionId unique en base.
  // ------------------------------------------------------------------
  fastify.post<{ Params: { provider: string } }>(
    '/webhooks/mobile-money/:provider',
    {
      // Pas de authenticate — webhook entrant opérateur Mobile Money
      config: { rateLimit: { max: 100, timeWindow: '1m' } },
    },
    async (
      req: FastifyRequest<{ Params: { provider: string } }>,
      reply: FastifyReply,
    ) => {
      // Vérifier présence signature (X-Signature ou X-Orange-Signature)
      const signature =
        (req.headers['x-signature'] as string | undefined) ??
        (req.headers['x-orange-signature'] as string | undefined);

      if (!signature) {
        return reply.status(400).send({
          code: 'MISSING_SIGNATURE',
          message: "En-tête X-Signature manquant",
        });
      }

      // rawBody pour la vérification HMAC — buffer brut injecté par le parser app.ts
      const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        return reply.status(400).send({ code: 'MISSING_RAW_BODY', message: 'Corps brut manquant' });
      }

      const parseResult = WebhookPayloadSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'INVALID_PAYLOAD',
          message: formatZodError(parseResult.error),
        });
      }

      try {
        // Délégation à PaymentsService.handleWebhook() (refactoring §3)
        const result = await paymentsService.handleWebhook({
          provider: req.params.provider,
          rawBody,
          signature,
          payload: parseResult.data,
        });

        if (result.status === 'duplicate') {
          return reply.status(200).send({ code: 'DUPLICATE', message: 'Déjà traité' });
        }

        return reply.status(200).send({ code: 'OK', status: result.status });
      } catch (err) {
        if (err instanceof WebhookSignatureError) {
          return reply.status(401).send({
            code: 'INVALID_SIGNATURE',
            message: 'Signature webhook invalide',
          });
        }
        req.log.error(err, 'handleWebhook error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // Sécurité : DELETE /bookings/:id volontairement absent (RG-03)
  // Si un client tente ce verb, il obtient 404 via le gestionnaire global.
  // ------------------------------------------------------------------
}
