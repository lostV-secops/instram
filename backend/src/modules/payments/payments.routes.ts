import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError, z } from 'zod';
import { PaymentsService } from './payments.service';
import prisma from '../../infra/db/prisma';
import redis from '../../infra/cache/redis';
import { buildGatewayMap } from '../../infra/mobileMoney/gateway';
import type { GoalPayWebhookPayload } from '../../infra/payment/goalpay';

// Re-export pour bookings.routes.ts (délégation webhook)
export { WebhookSignatureError } from './payments.service';

// =====================================================================
// Plugin Fastify — module payments
// Périmètre :
//   POST   /v1/payments          — initier un paiement Mobile Money
//   GET    /v1/payments/:paymentId — statut d'un paiement (polling UI fenêtre paiement)
//
// Contrat : docs/contrat-api.yaml §/payments (POST + GET)
// Sécurité : rate-limit renforcé sur /payments (architecture §7.4 : 30 req/min/user)
// Cache-Control : no-store sur toutes les routes paiement
// =====================================================================

// =====================================================================
// Schémas Zod locaux
// =====================================================================

const InitiatePaymentSchema = z.object({
  bookingId: z.string().uuid({ message: 'bookingId doit être un UUID valide' }),
  provider: z.enum(['MVOLA', 'ORANGE_MONEY'], { message: 'Provider doit être MVOLA ou ORANGE_MONEY' }),
  payerPhone: z.string().min(1, { message: 'payerPhone requis' }),
});

// =====================================================================
// Helpers
// =====================================================================

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

function getUserId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

// =====================================================================
// Plugin
// =====================================================================

export default async function paymentsRoutes(fastify: FastifyInstance): Promise<void> {
  // Gateways Mobile Money (sandbox en dev/test, vrais adaptateurs en prod)
  const gateways = buildGatewayMap(redis);
  const paymentsService = new PaymentsService(prisma, redis, gateways);

  // ------------------------------------------------------------------
  // POST /payments — Initier le paiement Mobile Money d'une réservation
  // Auth obligatoire. Rate-limit renforcé (30 req/min/user — architecture §7.4).
  // Contrat : InitiatePaymentRequest → PaymentInitiation
  // ------------------------------------------------------------------
  fastify.post(
    '/payments',
    {
      onRequest: [fastify.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1m' } },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');

      const parseResult = InitiatePaymentSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      const { bookingId, provider, payerPhone } = parseResult.data;

      try {
        const result = await paymentsService.initiate({
          bookingId,
          userId: getUserId(req),
          provider,
          phone: payerPhone,
        });
        return reply.status(201).send(result);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        if (code === 'CONFLICT') {
          return reply.status(409).send({
            code: 'PAYMENT_ALREADY_EXISTS',
            message: (err as Error).message,
          });
        }
        req.log.error(err, 'initiate payment error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /payments/:paymentId — Statut d'un paiement
  // Pour le polling UI pendant la fenêtre de paiement (max 5 min).
  // Auth obligatoire. Cache-Control: no-store.
  // Contrat : Payment schema
  // ------------------------------------------------------------------
  fastify.get<{ Params: { paymentId: string } }>(
    '/payments/:paymentId',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { paymentId: string } }>,
      reply: FastifyReply,
    ) => {
      reply.header('Cache-Control', 'no-store');

      const { paymentId } = req.params;
      const userId = getUserId(req);

      // Vérifier que le paiement appartient à l'utilisateur (via booking)
      const payment = await prisma.payment.findFirst({
        where: {
          id: paymentId,
          booking: { buyerUserId: userId },
        },
        include: {
          booking: {
            select: {
              id: true,
              reference: true,
              status: true,
              buyerUserId: true,
            },
          },
        },
      });

      if (!payment) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Paiement introuvable',
        });
      }

      return reply.status(200).send({
        id: payment.id,
        bookingId: payment.bookingId,
        provider: payment.provider,
        amountMga: payment.amountMga,
        status: payment.status,
        providerTransactionId: payment.providerTransactionId ?? null,
        initiatedAt: payment.initiatedAt.toISOString(),
        confirmedAt: payment.confirmedAt?.toISOString() ?? null,
      });
    },
  );

  // ------------------------------------------------------------------
  // POST /payments/sms-webhook — Appelé par IFTTT quand un SMS MVola arrive
  // Pas d'auth JWT — sécurisé par SMS_WEBHOOK_SECRET dans le corps.
  // Corps attendu : { text: string, from?: string, secret: string }
  // ------------------------------------------------------------------
  fastify.post(
    '/payments/sms-webhook',
    {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');

      const webhookSecret = process.env.SMS_WEBHOOK_SECRET;
      if (!webhookSecret) {
        req.log.warn('SMS_WEBHOOK_SECRET non configuré — webhook désactivé');
        return reply.status(503).send({ code: 'NOT_CONFIGURED', message: 'SMS webhook not configured' });
      }

      const body = req.body as Record<string, unknown> | null;
      if (!body || body.secret !== webhookSecret) {
        return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Invalid webhook secret' });
      }

      const smsText = typeof body.text === 'string' ? body.text.trim() : '';
      const fromPhone = typeof body.from === 'string' ? body.from.trim() : undefined;

      if (!smsText) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'text requis' });
      }

      try {
        const result = await paymentsService.confirmViaSmsWebhook({ smsText, fromPhone });
        req.log.info({ smsText, fromPhone, result: result.status }, 'sms-webhook processed');
        return reply.status(200).send({ ok: true, matched: result.status === 'processed' });
      } catch (err) {
        req.log.error(err, 'sms-webhook: erreur confirmation');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /payments/goalpay — Initier un paiement via GoalPay
  // Auth obligatoire. Retourne checkoutUrl vers laquelle le frontend redirige.
  // Contrat : { bookingId } → GoalPayInitiationResponse
  // ------------------------------------------------------------------
  fastify.post(
    '/payments/goalpay',
    {
      onRequest: [fastify.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1m' } },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');

      const schema = z.object({
        bookingId: z.string().uuid({ message: 'bookingId doit être un UUID valide' }),
      });
      const parseResult = schema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      try {
        const result = await paymentsService.initiateGoalPay({
          bookingId: parseResult.data.bookingId,
          userId: getUserId(req),
        });
        return reply.status(201).send(result);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        if (code === 'CONFLICT') {
          return reply.status(409).send({ code: 'PAYMENT_ALREADY_EXISTS', message: (err as Error).message });
        }
        if (code === 'GATEWAY_ERROR' || code === 'MISCONFIGURATION') {
          return reply.status(502).send({ code: 'GATEWAY_ERROR', message: 'Erreur passerelle de paiement' });
        }
        req.log.error(err, 'initiate goalpay error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /webhooks/goalpay — Webhook GoalPay (payment.success/failed/...)
  // PAS d'auth JWT — sécurisé par signature HMAC x-gpay-signature.
  // Toujours retourner 200 pour éviter les relivraisons répétées GoalPay.
  // ------------------------------------------------------------------
  fastify.post(
    '/webhooks/goalpay',
    {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');

      const signature = req.headers['x-gpay-signature'];
      if (!signature || typeof signature !== 'string') {
        req.log.warn('GoalPay webhook: x-gpay-signature manquant');
        return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Signature manquante' });
      }

      const payload = req.body as GoalPayWebhookPayload;
      if (!payload?.event || !payload?.data) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Payload invalide' });
      }

      try {
        const result = await paymentsService.handleGoalPayWebhook({ signature, payload });
        req.log.info({ event: payload.event, status: result.status }, 'goalpay webhook processed');
        return reply.status(200).send({ ok: true, status: result.status });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'INVALID_SIGNATURE') {
          req.log.warn({ signature }, 'GoalPay webhook: signature invalide');
          return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Signature invalide' });
        }
        req.log.error(err, 'goalpay webhook error');
        // Retourner 200 pour éviter les relivraisons répétées
        return reply.status(200).send({ ok: false, error: 'Erreur interne' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /dev/payments/simulate-success — DEV/TEST UNIQUEMENT
  // Confirme instantanément un paiement PENDING sans passer par le provider.
  // Protégé : disponible uniquement si NODE_ENV !== 'production'.
  // ------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    fastify.post(
      '/dev/payments/simulate-success',
      { onRequest: [fastify.authenticate] },
      async (req: FastifyRequest, reply: FastifyReply) => {
        reply.header('Cache-Control', 'no-store');
        const body = req.body as { bookingId?: string };
        if (!body?.bookingId) {
          return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'bookingId requis' });
        }
        try {
          await paymentsService.devSimulateSuccess(body.bookingId);
          return reply.status(200).send({ ok: true });
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'NOT_FOUND') {
            return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
          }
          req.log.error(err, 'dev simulate-success error');
          return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
        }
      },
    );
  }
}

// =====================================================================
// Export du plugin webhook — appelé depuis bookings.routes.ts
// Permet de déléguer le traitement webhook à PaymentsService sans
// créer deux instances de service dans le même contexte Fastify.
// =====================================================================

/**
 * Crée une instance de PaymentsService avec les gateways par défaut.
 * Utilisé par bookings.routes.ts pour le webhook /webhooks/mobile-money/:provider.
 */
export function createPaymentsService(): PaymentsService {
  const gateways = buildGatewayMap(redis);
  return new PaymentsService(prisma, redis, gateways);
}
