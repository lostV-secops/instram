import type { PrismaClient } from '@prisma/client';
import {
  BookingChannel,
  BookingStatus,
  PaymentStatus,
  PaymentProvider,
  AuditAction,
} from '@prisma/client';
import type { Redis } from 'ioredis';
import type { MobileMoneyGateway } from '../../infra/mobileMoney/gateway';
import { enqueueSms } from '../../infra/queue/sms.queue';
import type { NotificationsService } from '../notifications/notifications.service';
import type { WebhookPayload } from '../bookings/bookings.schema';
import { bookingChannel } from '../../infra/ws/channels';
import { publishToChannel } from '../../infra/ws/pubsub';
import {
  createGoalPayOrder,
  verifyGoalPaySignature,
  type GoalPayWebhookPayload,
} from '../../infra/payment/goalpay';

// =====================================================================
// PaymentsService
// Contrat : docs/contrat-api.yaml §Payments-Webhooks, §Traveler-Bookings (POST /payments)
// Architecture §2.6, §6.3, §7.4
//
// Règles critiques :
//   RG-02 : WALK_IN → PlatformFee = 0, Commission = 0 (double vérification channel)
//   VH-05 : PlatformFee = seatSubtotal × 2.5% (1.5% InsTRAM + 1% Mobile Money)
//   VH-04 : Commission par défaut = 8% (plan COMMISSION)
//   Plan SUBSCRIPTION → Commission = 0
//   Signature webhook vérifiée AVANT tout traitement (§7.4)
//   Idempotence par providerTransactionId (contrainte unique DB)
//   Pub/Sub émis APRÈS commit transaction (§5.5)
//   AuditLog sur chaque paiement confirmé et chaque échec (RG-13)
//
// Hypothèses documentées :
//   H1 : providerRef de l'initiation stocké dans Payment.providerRawPayload.initRef
//        pour permettre la réconciliation sans providerTransactionId confirmé.
//   H2 : Pour WALK_IN en PENDING_PAYMENT (état hypothétique — ne devrait pas arriver
//        car createWalkIn crée directement CONFIRMED), les frais sont tout de même 0.
//   H3 : Lors de la réconciliation, les SeatHolds peuvent être expirés ; on les charge
//        sans filtre de date pour créer les BookingSeats.
// =====================================================================

// =====================================================================
// Erreurs métier
// =====================================================================

export class WebhookSignatureError extends Error {
  constructor() {
    super('Signature webhook invalide');
    this.name = 'WebhookSignatureError';
    (this as NodeJS.ErrnoException).code = 'INVALID_SIGNATURE';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
    (this as NodeJS.ErrnoException).code = 'NOT_FOUND';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
    (this as NodeJS.ErrnoException).code = 'CONFLICT';
  }
}

// =====================================================================
// Helpers de calcul des frais
// =====================================================================

/**
 * Calcule les frais de service plateforme (VH-05).
 * Règle : seatSubtotal × 2.5% (1.5% InsTRAM + 1% Mobile Money provider).
 * WALK_IN : toujours 0 — appliqué par le code appelant.
 */
function calculatePlatformFee(seatSubtotalMga: number): number {
  return Math.round(seatSubtotalMga * 0.025);
}

/**
 * Calcule la commission InsTRAM (VH-04).
 * WALK_IN ou plan SUBSCRIPTION : toujours 0 — appliqué par le code appelant.
 * Plan COMMISSION : commissionRate% du montant siège.
 */
function calculateCommission(
  seatSubtotalMga: number,
  commissionRate: number | null | undefined,
): number {
  if (!commissionRate) return 0;
  return Math.round(seatSubtotalMga * (commissionRate / 100));
}

// =====================================================================
// Types
// =====================================================================

export interface FinancialSummary {
  tripInstanceId: string;
  totalRevenueMga: number;
  totalPlatformFeesMga: number;
  totalCommissionsMga: number;
  confirmedBookings: number;
  pendingBookings: number;
}

export interface PaymentInitiationResponse {
  paymentId: string;
  status: string;
  instructions: {
    messageFr: string;
    messageMg: string;
    ussdCode: string | null;
    expiresAt: string;
  };
}

export interface GoalPayInitiationResponse {
  paymentId: string;
  checkoutUrl: string;
  expiresInMinutes: number;
}

// Type interne pour les bookings chargés dans les méthodes privées
type BookingForConfirm = {
  id: string;
  reference: string;
  tripInstanceId: string;
  cooperativeId: string;
  channel: string;
  buyerUserId: string | null;
  // H-4 : totalAmountMga pour validation finale du montant webhook
  totalAmountMga: number;
  seatHolds: { seatDefinitionId: string }[];
  // H-4 : status pour filtrer sur PENDING dans handleWebhook
  payments: { id: string; amountMga: number; status: string }[];
};

// =====================================================================
// Helpers module-level
// =====================================================================

/** Normalise un numéro malgache vers +261XXXXXXXXX (sans espaces ni tirets). */
function _normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-.()]/g, '');
  if (cleaned.startsWith('+261')) return cleaned;
  if (cleaned.startsWith('261') && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.startsWith('0') && cleaned.length === 10) return `+261${cleaned.slice(1)}`;
  return cleaned;
}

// =====================================================================
// Service
// =====================================================================

export class PaymentsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
    /** Map provider (ex. 'MVOLA', 'ORANGE_MONEY') → adaptateur */
    private readonly gateways: Map<string, MobileMoneyGateway>,
    private readonly notifications?: NotificationsService | null,
  ) {}

  private _getGateway(provider: string): MobileMoneyGateway {
    // M-2 : tout provider non enregistré est rejeté explicitement —
    // pas de fallback silencieux qui masquerait un mauvais paramètre de webhook.
    const gateway = this.gateways.get(provider.toUpperCase());
    if (!gateway) {
      throw Object.assign(new Error(`Unknown payment provider: ${provider}`), {
        code: 'UNKNOWN_PROVIDER',
      });
    }
    return gateway;
  }

  // ------------------------------------------------------------------
  // initiate — Initie un paiement Mobile Money pour un booking existant
  // Contrat : POST /v1/payments
  // ------------------------------------------------------------------

  async initiate(params: {
    bookingId: string;
    userId: string;
    provider: string;
    phone: string;
  }): Promise<PaymentInitiationResponse> {
    const { bookingId, userId, provider, phone } = params;

    // 1. Vérifier que le booking appartient à l'userId et est en PENDING_PAYMENT
    const booking = await this.db.booking.findFirst({
      where: {
        id: bookingId,
        buyerUserId: userId,
        status: BookingStatus.PENDING_PAYMENT,
      },
      include: {
        tripInstance: {
          include: {
            cooperative: {
              include: {
                pricingPlans: {
                  where: {
                    effectiveFrom: { lte: new Date() },
                    OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
                  },
                  orderBy: { effectiveFrom: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundError('Réservation introuvable ou non en attente de paiement');
    }

    // 2. Vérifier qu'aucun paiement n'est déjà en cours ou confirmé
    const existingPayment = await this.db.payment.findFirst({
      where: {
        bookingId,
        status: {
          in: [PaymentStatus.INITIATED, PaymentStatus.PENDING, PaymentStatus.CONFIRMED],
        },
      },
    });

    if (existingPayment) {
      throw new ConflictError('Un paiement est déjà en cours ou confirmé pour cette réservation');
    }

    // 3. Calcul des frais — double vérification RG-02 (WALK_IN gratuit sans exception)
    const isWalkIn = booking.channel === BookingChannel.WALK_IN;
    const pricingPlan = booking.tripInstance.cooperative.pricingPlans[0];
    const isSubscriptionPlan = pricingPlan?.type === 'SUBSCRIPTION';

    // PlatformFee = 0 si WALK_IN (RG-02 — vérification explicite canal WALK_IN)
    const platformFeeMga = isWalkIn ? 0 : calculatePlatformFee(booking.seatSubtotalMga);

    // Commission = 0 si WALK_IN ou plan SUBSCRIPTION
    const commissionMga =
      isWalkIn || isSubscriptionPlan
        ? 0
        : calculateCommission(booking.seatSubtotalMga, pricingPlan?.commissionRate);

    // Assertion de non-régression RG-02 — ne doit JAMAIS se déclencher
    if (isWalkIn && (platformFeeMga !== 0 || commissionMga !== 0)) {
      throw new Error(
        'VIOLATION RG-02 : Walk-in ne peut jamais avoir de frais plateforme ou commission',
      );
    }

    // 4. Appel MobileMoneyGateway.initiatePayment (sandbox en dev/test)
    const gateway = this._getGateway(provider);
    const {
      instruction,
      expiresAt,
      providerRef,
    } = await gateway.initiatePayment({
      provider: provider as 'MVOLA' | 'ORANGE_MONEY',
      amount: booking.totalAmountMga,
      currency: 'MGA',
      phone,
      reference: booking.reference,
    });

    // 5. Transaction : Payment + PlatformFee + mise à jour Commission + AuditLog
    const payment = await this.db.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          bookingId,
          provider: provider as PaymentProvider,
          amountMga: booking.totalAmountMga,
          status: PaymentStatus.PENDING,
          // H1 : stockage du providerRef d'initiation pour la réconciliation
          providerRawPayload: providerRef ? { initRef: providerRef } : undefined,
        },
      });

      // PlatformFee — 0 pour WALK_IN par construction (RG-02)
      await tx.platformFee.create({
        data: {
          paymentId: p.id,
          amountMga: platformFeeMga,
          policyRef: isWalkIn ? 'RG-02-WALK_IN' : 'VH-05',
        },
      });

      // Mettre à jour la commission existante (créée dans createOnlineBooking) si différente
      if (!isWalkIn) {
        await tx.commission.updateMany({
          where: { bookingId, paymentId: null },
          data: { amountMga: commissionMga },
        });
      }

      // AuditLog (RG-13 — traçabilité paiement initié)
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: AuditAction.PAYMENT_INITIATED,
          entityType: 'Payment',
          entityId: p.id,
          after: {
            bookingId,
            provider,
            amountMga: booking.totalAmountMga,
            platformFeeMga,
            commissionMga,
          },
        },
      });

      return p;
    });

    return {
      paymentId: payment.id,
      status: payment.status,
      instructions: {
        messageFr: instruction,
        messageMg: instruction,
        ussdCode: null,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  // ------------------------------------------------------------------
  // handleWebhook — Traite un webhook Mobile Money entrant
  // Architecture §7.4 : signature vérifiée AVANT tout traitement
  // Idempotence par providerTransactionId (contrainte unique DB)
  // ------------------------------------------------------------------

  async handleWebhook(params: {
    provider: string;
    rawBody: Buffer;
    signature: string;
    payload: WebhookPayload;
  }): Promise<{ status: 'processed' | 'duplicate' | 'failed' | 'ignored' }> {
    const { provider, rawBody, signature, payload } = params;

    // 1. Vérification signature HMAC — rejet 401 immédiat si invalide (§7.4)
    const gateway = this._getGateway(provider);
    const isValid = gateway.verifyWebhookSignature(provider, rawBody, signature);
    if (!isValid) {
      throw new WebhookSignatureError();
    }

    const { providerTransactionId, status, bookingReference } = payload;

    // 2. Idempotence : providerTransactionId déjà CONFIRMED → 200 sans retraitement
    const existingConfirmed = await this.db.payment.findFirst({
      where: { providerTransactionId, status: PaymentStatus.CONFIRMED },
    });
    if (existingConfirmed) {
      return { status: 'duplicate' };
    }

    // 3. Retrouver le Booking (via référence dans le payload ou via Payment PENDING)
    let booking: BookingForConfirm | null = null;

    if (bookingReference) {
      booking = await this.db.booking.findUnique({
        where: { reference: bookingReference },
        include: {
          // H3 : tous les holds sans filtre de date (réconciliation peut arriver après expiry)
          seatHolds: true,
          payments: true,
        },
      }) as BookingForConfirm | null;
    }

    if (!booking) {
      // Webhook orphelin sans bookingReference déterministe — rejeté (sécurité IDOR)
      await this.db.auditLog.create({
        data: {
          action: AuditAction.PAYMENT_FAILED,
          entityType: 'Payment',
          entityId: 'unknown',
          before: { provider, reason: 'no_matching_booking', providerTransactionId },
        },
      });
      return { status: 'ignored' as const };
    }

    // C-2 Fix 1 : statuts intermédiaires — no-op, pas d'échec
    if (status === 'PENDING' || status === 'INITIATED') {
      return { status: 'ignored' as const };
    }

    if (status === 'SUCCESS') {
      // H-4 : filtrer sur PENDING et comparer à booking.totalAmountMga
      const pendingPayment = booking.payments.find((p) => p.status === 'PENDING');
      if (pendingPayment && payload.amountMga !== pendingPayment.amountMga) {
        await this.db.auditLog.create({
          data: {
            action: AuditAction.PAYMENT_FAILED,
            entityType: 'Payment',
            entityId: booking.id,
            before: { expected: pendingPayment.amountMga, received: payload.amountMga, provider },
          },
        });
        return this._failPayment(booking, providerTransactionId);
      }
      // Validation finale vs totalAmountMga (double vérification — paiement partiel refusé)
      if (payload.amountMga !== booking.totalAmountMga) {
        await this.db.auditLog.create({
          data: {
            action: AuditAction.PAYMENT_FAILED,
            entityType: 'Payment',
            entityId: booking.id,
            before: { expected: booking.totalAmountMga, received: payload.amountMga, provider, reason: 'totalAmountMga_mismatch' },
          },
        });
        return this._failPayment(booking, providerTransactionId);
      }
      return this._confirmPayment(booking, providerTransactionId, provider);
    } else {
      return this._failPayment(booking, providerTransactionId);
    }
  }

  // ------------------------------------------------------------------
  // reconcilePending — Requête statut pour paiements PENDING > 5 min
  // Architecture §2.7 : worker payment.reconcile (toutes les 5 min)
  // ------------------------------------------------------------------

  async reconcilePending(): Promise<{ checked: number; confirmed: number; failed: number; expired: number }> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Paiements PENDING initiés il y a plus de 5 min et sans providerTransactionId confirmé
    const pendingPayments = await this.db.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        initiatedAt: { lt: fiveMinutesAgo },
        providerTransactionId: null,
      },
      include: {
        // H3 : tous les holds (possiblement expirés) pour pouvoir créer BookingSeats
        booking: {
          include: {
            seatHolds: true,
            payments: true,
          },
        },
      },
    });

    let confirmed = 0;
    let failed = 0;

    for (const payment of pendingPayments) {
      if (!payment.booking) continue;

      // H1 : extraire l'initRef depuis providerRawPayload
      const rawPayload = payment.providerRawPayload as Record<string, unknown> | null;
      const initRef = rawPayload?.initRef as string | undefined;
      if (!initRef) continue;

      try {
        const gateway = this._getGateway(payment.provider);
        const result = await gateway.queryStatus(initRef);

        if (result.status === 'SUCCESS') {
          await this._confirmPayment(
            payment.booking as BookingForConfirm,
            result.providerTransactionId,
            payment.provider,
          );
          confirmed++;

          // AuditLog réconciliation
          await this.db.auditLog.create({
            data: {
              action: AuditAction.PAYMENT_CONFIRMED,
              entityType: 'Payment',
              entityId: payment.id,
              after: {
                source: 'reconciliation',
                providerTransactionId: result.providerTransactionId,
                provider: payment.provider,
              },
            },
          });
        } else if (result.status === 'FAILED' || result.status === 'EXPIRED') {
          await this._failPayment(
            payment.booking as BookingForConfirm,
            initRef,
          );
          failed++;

          // AuditLog réconciliation
          await this.db.auditLog.create({
            data: {
              action: AuditAction.PAYMENT_FAILED,
              entityType: 'Payment',
              entityId: payment.id,
              after: {
                source: 'reconciliation',
                status: result.status,
                provider: payment.provider,
              },
            },
          });
        }
        // status === 'PENDING' → on laisse, prochain cycle de réconciliation
      } catch (_err) {
        // Erreur isolée — ne bloque pas les autres réconciliations
      }
    }

    // Expirer les réservations abandonnées (PENDING_PAYMENT > 30 min sans paiement actif)
    const expired = await this.expireStaleBookings();

    return { checked: pendingPayments.length, confirmed, failed, expired };
  }

  // ------------------------------------------------------------------
  // expireStaleBookings — Expire les réservations PENDING_PAYMENT abandonnées
  // Appelé automatiquement depuis reconcilePending() toutes les 5 minutes.
  // Délai : 30 minutes sans paiement confirmé → PAYMENT_EXPIRED
  // ------------------------------------------------------------------

  async expireStaleBookings(): Promise<number> {
    const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000);

    // Expirer les réservations PENDING_PAYMENT de plus de 4 min qui n'ont :
    //   - aucun paiement CONFIRMED (paiement réussi)
    //   - aucun paiement PENDING/INITIATED initié récemment (< 4 min)
    // Cela couvre MVola/Orange Money (sans paiement actif) ET GoalPay
    // (paiement PENDING mais initié il y a > 4 min = utilisateur a abandonné).
    const staleBookings = await this.db.booking.findMany({
      where: {
        status: BookingStatus.PENDING_PAYMENT,
        createdAt: { lt: fourMinutesAgo },
        payments: {
          none: {
            OR: [
              { status: PaymentStatus.CONFIRMED },
              {
                status: { in: [PaymentStatus.PENDING, PaymentStatus.INITIATED] },
                initiatedAt: { gt: fourMinutesAgo },
              },
            ],
          },
        },
      },
      include: {
        seatHolds: { where: { releasedAt: null } },
      },
    });

    for (const booking of staleBookings) {
      await this.db.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.PAYMENT_EXPIRED },
        });

        await tx.seatHold.updateMany({
          where: { bookingId: booking.id, releasedAt: null },
          data: { releasedAt: new Date(), expiresAt: new Date() },
        });

        await tx.auditLog.create({
          data: {
            action: AuditAction.PAYMENT_FAILED,
            entityType: 'Booking',
            entityId: booking.id,
            after: { source: 'expireStaleBookings', status: 'PAYMENT_EXPIRED' },
          },
        });
      });

      // Libérer les sièges en temps réel
      const seatIds = booking.seatHolds.map((h) => h.seatDefinitionId);
      if (seatIds.length > 0) {
        await this.redis.publish(
          `trip:${booking.tripInstanceId}`,
          JSON.stringify({
            event: 'SEAT_RELEASED',
            tripInstanceId: booking.tripInstanceId,
            seatDefinitionIds: seatIds,
            bookingId: booking.id,
          }),
        );
      }
    }

    if (staleBookings.length > 0) {
      process.stdout.write(
        `[expireStaleBookings] ${staleBookings.length} réservation(s) expirée(s)\n`,
      );
    }

    return staleBookings.length;
  }

  // ------------------------------------------------------------------
  // getTripFinancialSummary — Résumé financier d'un trajet (dashboard coop)
  // ------------------------------------------------------------------

  async getTripFinancialSummary(
    tripInstanceId: string,
    cooperativeId: string,
  ): Promise<FinancialSummary> {
    const confirmedBookings = await this.db.booking.findMany({
      where: {
        tripInstanceId,
        cooperativeId,
        status: {
          in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW],
        },
      },
      include: {
        commissions: true,
      },
    });

    const pendingCount = await this.db.booking.count({
      where: {
        tripInstanceId,
        cooperativeId,
        status: BookingStatus.PENDING_PAYMENT,
      },
    });

    let totalRevenueMga = 0;
    let totalPlatformFeesMga = 0;
    let totalCommissionsMga = 0;

    for (const b of confirmedBookings) {
      totalRevenueMga += b.totalAmountMga;
      totalPlatformFeesMga += b.platformFeeMga;
      totalCommissionsMga += b.commissions.reduce((s, c) => s + c.amountMga, 0);
    }

    return {
      tripInstanceId,
      totalRevenueMga,
      totalPlatformFeesMga,
      totalCommissionsMga,
      confirmedBookings: confirmedBookings.length,
      pendingBookings: pendingCount,
    };
  }

  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // devSimulateSuccess — DEV/TEST UNIQUEMENT
  // Force la confirmation d'un paiement sans passer par le provider.
  // À n'utiliser qu'avec NODE_ENV !== 'production'.
  // ------------------------------------------------------------------
  async devSimulateSuccess(bookingId: string): Promise<void> {
    const payment = await this.db.payment.findFirst({
      where: { bookingId, status: PaymentStatus.PENDING },
      include: {
        booking: {
          include: { seatHolds: true, payments: true },
        },
      },
    });

    if (!payment || !payment.booking) {
      throw Object.assign(new Error('Aucun paiement PENDING pour cette réservation'), { code: 'NOT_FOUND' });
    }

    await this._confirmPayment(
      payment.booking as BookingForConfirm,
      `dev-stub-${Date.now()}`,
      payment.provider,
    );
  }

  // ------------------------------------------------------------------
  // confirmViaSmsWebhook — Appelé par POST /payments/sms-webhook (IFTTT)
  // Parse le texte SMS MVola, retrouve le paiement PENDING correspondant
  // et déclenche _confirmPayment.
  // ------------------------------------------------------------------
  async confirmViaSmsWebhook(params: {
    smsText: string;
    fromPhone?: string;
  }): Promise<{ status: 'processed' | 'no_match' }> {
    const { smsText, fromPhone } = params;

    // Extraire le montant — MVola envoie "25 000 Ar" ou "25000 Ar"
    const amountMatch = smsText.match(/(\d[\d\s]*)\s*(?:Ar|MGA|ariary)/i);
    if (!amountMatch) return { status: 'no_match' };
    const amountMga = parseInt(amountMatch[1].replace(/\s/g, ''), 10);
    if (isNaN(amountMga) || amountMga <= 0) return { status: 'no_match' };

    // Normaliser le numéro expéditeur (fourni par IFTTT ou extrait du texte)
    const rawPhone =
      fromPhone ??
      smsText.match(/(?:\+261|0)(3[2-9]\d{7})/)?.[0] ??
      null;
    const phoneCandidates: string[] = [];
    if (rawPhone) {
      const norm = _normalizePhone(rawPhone);
      phoneCandidates.push(norm);
      // Ajouter la forme locale (034XXXXXXX) pour correspondre aux deux formats stockés
      if (norm.startsWith('+261') && norm.length === 13) {
        phoneCandidates.push('0' + norm.slice(4));
      }
    }

    // Chercher d'abord avec le numéro de téléphone (plus précis)
    let payment = phoneCandidates.length > 0
      ? await this.db.payment.findFirst({
          where: {
            status: PaymentStatus.PENDING,
            amountMga,
            booking: {
              status: BookingStatus.PENDING_PAYMENT,
              buyer: { phone: { in: phoneCandidates } },
            },
          },
          include: { booking: { include: { seatHolds: true, payments: true } } },
          orderBy: { initiatedAt: 'desc' },
        })
      : null;

    // Fallback : correspondance par montant uniquement (sans téléphone)
    if (!payment) {
      payment = await this.db.payment.findFirst({
        where: {
          status: PaymentStatus.PENDING,
          amountMga,
          booking: { status: BookingStatus.PENDING_PAYMENT },
        },
        include: { booking: { include: { seatHolds: true, payments: true } } },
        orderBy: { initiatedAt: 'desc' },
      });
    }

    if (!payment?.booking) return { status: 'no_match' };

    const txId = `sms-ifttt-${Date.now()}-${payment.id.slice(0, 8)}`;
    await this._confirmPayment(payment.booking as BookingForConfirm, txId, payment.provider);
    return { status: 'processed' };
  }

  // ------------------------------------------------------------------
  // initiateGoalPay — Crée une commande de paiement GoalPay
  // Retourne l'URL checkout vers laquelle le frontend redirige l'utilisateur.
  // ------------------------------------------------------------------

  async initiateGoalPay(params: {
    bookingId: string;
    userId: string;
    returnUrl?: string;
  }): Promise<GoalPayInitiationResponse> {
    const { bookingId, userId } = params;

    const booking = await this.db.booking.findFirst({
      where: {
        id: bookingId,
        buyerUserId: userId,
        status: BookingStatus.PENDING_PAYMENT,
      },
      include: {
        passengers: { take: 1, select: { firstName: true, lastName: true } },
        tripInstance: {
          include: {
            route: { include: { origin: true, destination: true } },
            cooperative: {
              include: {
                pricingPlans: {
                  where: {
                    effectiveFrom: { lte: new Date() },
                    OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
                  },
                  orderBy: { effectiveFrom: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundError('Réservation introuvable ou non en attente de paiement');
    }

    const existingPayment = await this.db.payment.findFirst({
      where: {
        bookingId,
        status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING, PaymentStatus.CONFIRMED] },
      },
    });
    if (existingPayment) {
      throw new ConflictError('Un paiement est déjà en cours ou confirmé pour cette réservation');
    }

    const isWalkIn = booking.channel === BookingChannel.WALK_IN;
    const pricingPlan = booking.tripInstance.cooperative.pricingPlans[0];
    const isSubscriptionPlan = pricingPlan?.type === 'SUBSCRIPTION';
    const platformFeeMga = isWalkIn ? 0 : calculatePlatformFee(booking.seatSubtotalMga);
    const commissionMga =
      isWalkIn || isSubscriptionPlan
        ? 0
        : calculateCommission(booking.seatSubtotalMga, pricingPlan?.commissionRate);

    const origin = booking.tripInstance.route.origin.nameFr;
    const dest = booking.tripInstance.route.destination.nameFr;
    const description = `Billet ${origin} > ${dest} — Réf. ${booking.reference}`;

    const gpOrder = await createGoalPayOrder({
      description,
      reference: booking.reference,
      amount: booking.totalAmountMga,
      metadata: [
        {
          label: `Billet ${origin} > ${dest}`,
          unit_price: booking.seatSubtotalMga,
          quantity: booking.passengers.length || 1,
        },
        ...(platformFeeMga > 0
          ? [{ label: 'Frais de service InsTRAM', unit_price: platformFeeMga, quantity: 1 }]
          : []),
      ],
      ...(params.returnUrl ? { return_url: params.returnUrl } : {}),
    });

    const payment = await this.db.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          bookingId,
          provider: 'GOALPAY' as PaymentProvider,
          amountMga: booking.totalAmountMga,
          status: PaymentStatus.PENDING,
          goalpayOrderRef: gpOrder.orderReference,
          checkoutUrl: gpOrder.checkoutUrl,
        },
      });

      await tx.platformFee.create({
        data: {
          paymentId: p.id,
          amountMga: platformFeeMga,
          policyRef: isWalkIn ? 'RG-02-WALK_IN' : 'VH-05',
        },
      });

      if (!isWalkIn) {
        await tx.commission.updateMany({
          where: { bookingId, paymentId: null },
          data: { amountMga: commissionMga },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: AuditAction.PAYMENT_INITIATED,
          entityType: 'Payment',
          entityId: p.id,
          after: {
            bookingId,
            provider: 'GOALPAY',
            amountMga: booking.totalAmountMga,
            platformFeeMga,
            commissionMga,
            goalpayOrderRef: gpOrder.orderReference,
          },
        },
      });

      return p;
    });

    return {
      paymentId: payment.id,
      checkoutUrl: gpOrder.checkoutUrl,
      expiresInMinutes: gpOrder.expiresInMinutes,
    };
  }

  // ------------------------------------------------------------------
  // handleGoalPayWebhook — Traite un événement webhook GoalPay
  // Architecture §7.4 : signature vérifiée AVANT tout traitement
  // ------------------------------------------------------------------

  async handleGoalPayWebhook(params: {
    signature: string;
    payload: GoalPayWebhookPayload;
  }): Promise<{ status: 'processed' | 'duplicate' | 'failed' | 'ignored' }> {
    const { signature, payload } = params;

    if (!verifyGoalPaySignature(signature)) {
      throw new WebhookSignatureError();
    }

    const { event, data } = payload;
    const { order_reference } = data;

    if (!order_reference) {
      return { status: 'ignored' };
    }

    // Idempotence : paiement déjà confirmé
    const existingConfirmed = await this.db.payment.findFirst({
      where: { goalpayOrderRef: order_reference, status: PaymentStatus.CONFIRMED },
    });
    if (existingConfirmed) {
      return { status: 'duplicate' };
    }

    const payment = await this.db.payment.findFirst({
      where: { goalpayOrderRef: order_reference },
      include: {
        booking: {
          include: { seatHolds: true, payments: true },
        },
      },
    });

    if (!payment?.booking) {
      await this.db.auditLog.create({
        data: {
          action: AuditAction.PAYMENT_FAILED,
          entityType: 'Payment',
          entityId: 'unknown',
          before: { provider: 'GOALPAY', reason: 'no_matching_payment', order_reference },
        },
      });
      return { status: 'ignored' };
    }

    if (event === 'payment.success') {
      return this._confirmPayment(
        payment.booking as BookingForConfirm,
        `goalpay-${order_reference}`,
        'GOALPAY',
      );
    } else {
      return this._failPayment(
        payment.booking as BookingForConfirm,
        `goalpay-${order_reference}`,
      );
    }
  }

  // _confirmPayment — BEGIN TRANSACTION : Payment CONFIRMED + BookingSeats + Booking CONFIRMED
  // PUIS : Pub/Sub SEAT_SOLD, SMS BOOKING_CONFIRMED (après commit)
  // ------------------------------------------------------------------

  private async _confirmPayment(
    booking: BookingForConfirm,
    providerTransactionId: string,
    provider: string,
  ): Promise<{ status: 'processed' }> {
    await this.db.$transaction(async (tx) => {
      const pendingPayment = await tx.payment.findFirst({
        where: { bookingId: booking.id, status: PaymentStatus.PENDING },
        include: { platformFee: true },
      });

      if (!pendingPayment) {
        // C-2 Fix 2 : erreur explicite au lieu de return silencieux
        throw Object.assign(new Error('No PENDING payment found for booking'), { code: 'NO_PENDING_PAYMENT' });
      }

      // Payment.status = CONFIRMED, confirmedAt
      await tx.payment.update({
        where: { id: pendingPayment.id },
        data: {
          status: PaymentStatus.CONFIRMED,
          confirmedAt: new Date(),
          providerTransactionId,
        },
      });

      // SeatHold → BookingSeat isActive = true (pour chaque siège du booking)
      for (const hold of booking.seatHolds) {
        const seatDef = await tx.seatDefinition.findUnique({
          where: { id: hold.seatDefinitionId },
          select: { id: true, code: true, category: true },
        });
        if (!seatDef) continue;

        // Idempotence : ne pas créer si BookingSeat existe déjà
        const existingBs = await tx.bookingSeat.findFirst({
          where: { bookingId: booking.id, seatDefinitionId: seatDef.id },
        });
        if (existingBs) continue;

        const fare = await tx.fare.findFirst({
          where: {
            tripInstanceId: booking.tripInstanceId,
            OR: [
              { seatDefinitionId: seatDef.id },
              { seatDefinitionId: null, category: seatDef.category },
            ],
          },
          orderBy: { seatDefinitionId: 'desc' }, // siège précis prime sur catégorie
        });

        await tx.bookingSeat.create({
          data: {
            bookingId: booking.id,
            tripInstanceId: booking.tripInstanceId,
            seatDefinitionId: seatDef.id,
            seatCode: seatDef.code,
            category: seatDef.category,
            priceMga: fare?.priceMga ?? 0,
            isActive: true,
          },
        });
      }

      // Booking.status = CONFIRMED
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
      });

      // Lier Commission au Payment (Commission créée sans paymentId dans createOnlineBooking)
      await tx.commission.updateMany({
        where: { bookingId: booking.id, paymentId: null },
        data: { paymentId: pendingPayment.id },
      });

      // AuditLog (RG-13)
      await tx.auditLog.create({
        data: {
          action: AuditAction.PAYMENT_CONFIRMED,
          entityType: 'Payment',
          entityId: pendingPayment.id,
          after: { bookingId: booking.id, providerTransactionId, provider },
        },
      });
    });

    // Pub/Sub SEAT_SOLD — APRÈS commit transaction (architecture §5.5)
    const seatDefinitionIds = booking.seatHolds.map((h) => h.seatDefinitionId);
    await this.redis.publish(
      `trip:${booking.tripInstanceId}`,
      JSON.stringify({
        event: 'SEAT_SOLD',
        tripInstanceId: booking.tripInstanceId,
        seatDefinitionIds,
        bookingId: booking.id,
      }),
    );

    // Pub/Sub PAYMENT_CONFIRMED → canal privé voyageur (booking:{userId})
    if (booking.buyerUserId) {
      await publishToChannel(bookingChannel(booking.buyerUserId), {
        type: 'PAYMENT_CONFIRMED',
        bookingId: booking.id,
        at: new Date().toISOString(),
      });
    }

    // SMS BOOKING_CONFIRMED (transactionnel — immédiat, bypass silence nocturne VH-02)
    // Charger les données nécessaires au SMS (non incluses dans BookingForConfirm)
    const bookingForSms = await this.db.booking.findUnique({
      where: { id: booking.id },
      select: {
        reference: true,
        buyer: { select: { phone: true, preferredLang: true } },
        passengers: { take: 1, select: { phone: true } },
        tripInstance: {
          select: {
            departureAt: true,
            route: { select: { origin: { select: { nameFr: true } } } },
          },
        },
      },
    });
    if (bookingForSms) {
      const smsPhone = bookingForSms.buyer?.phone ?? bookingForSms.passengers[0]?.phone;
      const smsLang = (bookingForSms.buyer?.preferredLang ?? 'FR') as 'FR' | 'MG';
      if (smsPhone) {
        const departureStr = bookingForSms.tripInstance?.departureAt
          .toLocaleString('fr-MG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Indian/Antananarivo' }) ?? '';
        const origin = bookingForSms.tripInstance?.route.origin.nameFr ?? '';
        const vars = { reference: bookingForSms.reference, departureAt: departureStr, origin };
        if (this.notifications) {
          await this.notifications.enqueue({
            bookingId: booking.id, templateKey: 'BOOKING_CONFIRMED',
            variables: vars, lang: smsLang, phone: smsPhone, transactional: true,
          });
        } else {
          await enqueueSms({
            phone: smsPhone, templateCode: 'BOOKING_CONFIRMED',
            params: vars, lang: smsLang, bookingId: booking.id, isTransactional: true,
          });
        }
      }
    }

    return { status: 'processed' };
  }

  // ------------------------------------------------------------------
  // _failPayment — Booking PAYMENT_FAILED, SeatHold libéré, Pub/Sub SEAT_RELEASED
  // SMS PAYMENT_FAILED si template disponible (non bloquant)
  // ------------------------------------------------------------------

  private async _failPayment(
    booking: { id: string; tripInstanceId: string; seatHolds: { seatDefinitionId: string }[] },
    providerTransactionId: string,
  ): Promise<{ status: 'failed' }> {
    await this.db.$transaction(async (tx) => {
      // C-2 Fix 3 : ne pas écrire providerTransactionId sur un paiement FAILED
      await tx.payment.updateMany({
        where: { bookingId: booking.id, status: PaymentStatus.PENDING },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
        },
      });

      // Booking.status = PAYMENT_FAILED
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.PAYMENT_FAILED },
      });

      // SeatHold libéré : expiration immédiate + releasedAt
      await tx.seatHold.updateMany({
        where: { bookingId: booking.id, releasedAt: null },
        data: { releasedAt: new Date(), expiresAt: new Date() },
      });

      // AuditLog (RG-13)
      await tx.auditLog.create({
        data: {
          action: AuditAction.PAYMENT_FAILED,
          entityType: 'Booking',
          entityId: booking.id,
          after: { providerTransactionId, status: 'FAILED' },
        },
      });
    });

    // Pub/Sub SEAT_RELEASED — APRÈS commit (§5.5)
    const seatDefinitionIds = booking.seatHolds.map((h) => h.seatDefinitionId);
    if (seatDefinitionIds.length > 0) {
      await this.redis.publish(
        `trip:${booking.tripInstanceId}`,
        JSON.stringify({
          event: 'SEAT_RELEASED',
          tripInstanceId: booking.tripInstanceId,
          seatDefinitionIds,
          bookingId: booking.id,
        }),
      );
    }

    // SMS PAYMENT_FAILED (non bloquant)
    try {
      const failedBooking = await this.db.booking.findUnique({
        where: { id: booking.id },
        select: {
          reference: true,
          buyer: { select: { phone: true, preferredLang: true } },
          passengers: { take: 1, select: { phone: true } },
        },
      });
      const smsPhone = failedBooking?.buyer?.phone ?? failedBooking?.passengers[0]?.phone;
      const smsLang = (failedBooking?.buyer?.preferredLang ?? 'FR') as 'FR' | 'MG';
      if (smsPhone && failedBooking) {
        const vars = { reference: failedBooking.reference };
        if (this.notifications) {
          await this.notifications.enqueue({
            bookingId: booking.id, templateKey: 'PAYMENT_FAILED',
            variables: vars, lang: smsLang, phone: smsPhone, transactional: true,
          });
        } else {
          await enqueueSms({
            phone: smsPhone, templateCode: 'PAYMENT_FAILED',
            params: vars, lang: smsLang, bookingId: booking.id, isTransactional: true,
          });
        }
      }
    } catch (_err) {
      // Non bloquant
    }

    return { status: 'failed' };
  }
}
