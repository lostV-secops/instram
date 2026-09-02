import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError, z } from 'zod';
import { PaymentsService } from './payments.service';
import prisma from '../../infra/db/prisma';
import redis from '../../infra/cache/redis';
import { buildGatewayMap } from '../../infra/mobileMoney/gateway';

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
