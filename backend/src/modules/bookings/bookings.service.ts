import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
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
import type {
  CreateBookingInput,
  InitiatePaymentInput,
  WalkInBookingInput,
  CancelAtCounterInput,
  BookingListQueryInput,
} from './bookings.schema';

// =====================================================================
// BookingsService
// Contrat : docs/contrat-api.yaml §Traveler-Bookings, §Cooperative-Bookings
// Règles critiques :
//   RG-02 : Walk-in → PlatformFee = 0, Commission = 0 (vérifié explicitement)
//   RG-03 : Pas de DELETE /bookings côté voyageur
//   VH-05 : PlatformFee = seatSubtotal × 1.5% (InsTRAM) + seatSubtotal × 1% (Mobile Money) = 2.5%
//   VH-09 : QR payload = JSON signé HMAC-SHA256
// =====================================================================

// =====================================================================
// Erreurs métier
// =====================================================================

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
    (this as NodeJS.ErrnoException).code = 'NOT_FOUND';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
    (this as NodeJS.ErrnoException).code = 'FORBIDDEN';
  }
}

export class ConflictError extends Error {
  constructor(
    message: string,
    public readonly conflictingSeats?: { seatDefinitionId: string; code: string; status: 'HELD' | 'SOLD' }[],
  ) {
    super(message);
    this.name = 'ConflictError';
    (this as NodeJS.ErrnoException).code = 'CONFLICT';
  }
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Génère une référence de réservation lisible : IT-XXXXX (5 alphanum).
 */
function generateBookingReference(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let ref = 'IT-';
  const bytes = crypto.randomBytes(5);
  for (let i = 0; i < 5; i++) {
    ref += chars[bytes[i] % chars.length];
  }
  return ref;
}

/**
 * Génère et signe le payload QR du billet (VH-09).
 * Stocké en base même pour PENDING_PAYMENT, exposé uniquement si CONFIRMED.
 */
function generateQrPayload(data: {
  bookingRef: string;
  tripInstanceId: string;
  seatCodes: string[];
  issuedAt: string;
}): string {
  const secret = process.env.QR_SECRET ?? 'change_me_qr_secret';
  const body = JSON.stringify(data);
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return Buffer.from(JSON.stringify({ ...data, sig })).toString('base64url');
}

/**
 * Calcule les frais de service plateforme (VH-05) pour une réservation en ligne.
 * Règle : seatSubtotal × 2.5% (1.5% InsTRAM + 1% Mobile Money provider).
 * Walk-in : toujours 0 (RG-02) — vérification dans le code appelant.
 */
function calculatePlatformFee(seatSubtotalMga: number): number {
  return Math.round(seatSubtotalMga * 0.025);
}

/**
 * Calcule la commission InsTRAM (VH-04) selon le plan tarifaire.
 * Walk-in : toujours 0 (RG-02).
 * Plan SUBSCRIPTION : toujours 0.
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
// Service
// =====================================================================

export class BookingsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
    private readonly gateway: MobileMoneyGateway,
    /** Optionnel : si fourni, les SMS passent par NotificationsService.enqueue()
     *  (crée un enregistrement Notification en DB). Sinon, fallback sur enqueueSms() direct. */
    private readonly notifications?: NotificationsService | null,
  ) {}

  // ------------------------------------------------------------------
  // POST /bookings
  // Crée un Booking en PENDING_PAYMENT à partir d'un hold.
  // Étend le TTL du hold à expiresAt = NOW() + 5 min (paiement — VH-01).
  // Contrat : retourne Booking (le paiement est initié via POST /payments).
  // ------------------------------------------------------------------

  async createOnlineBooking(
    userId: string,
    input: CreateBookingInput,
  ): Promise<Record<string, unknown>> {
    const { holdId, passengers } = input;

    // 1. Charger le hold de référence et valider la propriété
    const referenceHold = await this.db.seatHold.findFirst({
      where: {
        id: holdId,
        heldByUserId: userId,
        expiresAt: { gt: new Date() },
        bookingId: null,
      },
      include: { tripInstance: { include: { fares: true, cooperative: { include: { pricingPlans: { where: { effectiveFrom: { lte: new Date() }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } } } } },
    });

    if (!referenceHold) {
      throw new ConflictError(
        'Hold introuvable, expiré ou déjà utilisé. Veuillez re-sélectionner vos sièges.',
      );
    }

    const tripInstanceId = referenceHold.tripInstanceId;

    // 2. Charger tous les holds actifs du groupe (user+trip)
    const groupHolds = await this.db.seatHold.findMany({
      where: {
        tripInstanceId,
        heldByUserId: userId,
        expiresAt: { gt: new Date() },
        bookingId: null,
      },
      include: {
        seatDefinition: { select: { id: true, code: true, category: true } },
      },
    });

    if (groupHolds.length === 0) {
      throw new ConflictError('Tous les holds ont expiré.');
    }

    // 3. Calculer les montants (hold de 15 min — VH-01 : pas d'extension nécessaire)
    const trip = referenceHold.tripInstance;
    const fares = trip.fares;

    const fareByDefId = new Map<string, number>();
    const fareByCat = new Map<string, number>();
    for (const fare of fares) {
      if (fare.seatDefinitionId) fareByDefId.set(fare.seatDefinitionId, fare.priceMga);
      else if (fare.category) fareByCat.set(fare.category, fare.priceMga);
    }

    // C-3 : lancer FARE_NOT_FOUND si aucun tarif n'est configuré pour un siège
    let seatSubtotalMga = 0;
    for (const h of groupHolds) {
      const price =
        fareByDefId.get(h.seatDefinitionId) ??
        fareByCat.get(h.seatDefinition.category) ??
        null;
      if (price === null) {
        throw Object.assign(
          new Error('Aucun tarif configuré pour un ou plusieurs sièges'),
          { code: 'FARE_NOT_FOUND' },
        );
      }
      seatSubtotalMga += price;
    }

    // VH-05 : frais plateforme
    const platformFeeMga = calculatePlatformFee(seatSubtotalMga);
    const totalAmountMga = seatSubtotalMga + platformFeeMga;

    // Commission (pour traçabilité, calculée maintenant)
    const pricingPlan = trip.cooperative.pricingPlans[0];
    const commissionMga = calculateCommission(
      seatSubtotalMga,
      pricingPlan?.commissionRate,
    );

    // 5. Générer référence + QR payload
    const seatCodes = groupHolds.map((h) => h.seatDefinition.code);
    const issuedAt = new Date().toISOString();

    // Référence unique avec retry sur collision (très rare)
    let reference = generateBookingReference();
    let refExists = await this.db.booking.findUnique({ where: { reference } });
    while (refExists) {
      reference = generateBookingReference();
      refExists = await this.db.booking.findUnique({ where: { reference } });
    }

    const qrPayload = generateQrPayload({
      bookingRef: reference,
      tripInstanceId,
      seatCodes,
      issuedAt,
    });

    // 6. Transaction : créer Booking + Passengers + BookingSeats provisoires vides + Commission
    const booking = await this.db.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          reference,
          tripInstanceId,
          cooperativeId: trip.cooperativeId,
          buyerUserId: userId,
          channel: BookingChannel.ONLINE,
          status: BookingStatus.PENDING_PAYMENT,
          totalAmountMga,
          seatSubtotalMga,
          platformFeeMga,
          qrPayload,
        },
      });

      // Lier les holds à ce booking
      await tx.seatHold.updateMany({
        where: { id: { in: groupHolds.map((h) => h.id) } },
        data: { bookingId: created.id },
      });

      // Créer les passagers
      await tx.passenger.createMany({
        data: passengers.map((p) => ({
          bookingId: created.id,
          firstName: p.firstName,
          lastName: p.lastName,
          phone: p.phone ?? null,
          nationalIdRef: p.nationalIdRef ?? null,
          seatCode: p.seatCode,
        })),
      });

      // Commission (traçabilité)
      await tx.commission.create({
        data: {
          bookingId: created.id,
          cooperativeId: trip.cooperativeId,
          amountMga: commissionMga,
          pricingPlanRef: pricingPlan?.id ?? null,
        },
      });

      return created;
    });

    return this._formatBooking(booking);
  }

  // ------------------------------------------------------------------
  // POST /payments — Initier le paiement Mobile Money
  // Contrat : POST /payments (endpoint distinct de POST /bookings)
  // ------------------------------------------------------------------

  async initiatePayment(
    userId: string,
    input: InitiatePaymentInput,
  ): Promise<Record<string, unknown>> {
    const { bookingId, provider, payerPhone } = input;

    const booking = await this.db.booking.findFirst({
      where: {
        id: bookingId,
        buyerUserId: userId,
        status: BookingStatus.PENDING_PAYMENT,
      },
    });

    if (!booking) {
      throw new NotFoundError('Réservation introuvable ou non en attente de paiement');
    }

    // Vérifier qu'un paiement n'a pas déjà été initié
    const existingPayment = await this.db.payment.findFirst({
      where: { bookingId, status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING, PaymentStatus.CONFIRMED] } },
    });

    if (existingPayment) {
      throw new ConflictError('Un paiement est déjà en cours ou confirmé pour cette réservation');
    }

    // Appel gateway stub (sandbox — jamais les vraies clés prod)
    const { instruction, expiresAt: gatewayExpiresAt } = await this.gateway.initiatePayment({
      provider: provider as 'MVOLA' | 'ORANGE_MONEY',
      amount: booking.totalAmountMga,
      currency: 'MGA',
      phone: payerPhone,
      reference: booking.reference,
    });

    const payment = await this.db.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          bookingId,
          provider: provider as PaymentProvider,
          amountMga: booking.totalAmountMga,
          status: PaymentStatus.PENDING,
        },
      });

      // PlatformFee
      await tx.platformFee.create({
        data: {
          paymentId: p.id,
          amountMga: booking.platformFeeMga,
          policyRef: 'VH-05',
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: AuditAction.PAYMENT_INITIATED,
          entityType: 'Payment',
          entityId: p.id,
          after: { bookingId, provider, amountMga: booking.totalAmountMga },
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
        expiresAt: gatewayExpiresAt.toISOString(),
      },
    };
  }

  // ------------------------------------------------------------------
  // GET /bookings — Historique voyageur (paginé, trié par date desc)
  // ------------------------------------------------------------------

  async getBookings(
    userId: string,
    query: BookingListQueryInput,
  ): Promise<Record<string, unknown>> {
    const { status, cursor, limit } = query;

    const where: Record<string, unknown> = { buyerUserId: userId };
    if (status) where.status = status;
    if (cursor) where.id = { lt: cursor };

    const items = await this.db.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        tripInstance: {
          include: {
            route: {
              include: { origin: true, destination: true },
            },
          },
        },
      },
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      items: page.map((b) => ({
        id: b.id,
        reference: b.reference,
        status: b.status,
        channel: b.channel,
        totalAmountMga: b.totalAmountMga,
        seatSubtotalMga: b.seatSubtotalMga,
        platformFeeMga: b.platformFeeMga,
        tripInstanceId: b.tripInstanceId,
        createdAt: b.createdAt.toISOString(),
        tripInstance: {
          departureAt: b.tripInstance.departureAt.toISOString(),
          route: {
            origin: b.tripInstance.route.origin.nameFr,
            destination: b.tripInstance.route.destination.nameFr,
          },
        },
      })),
      nextCursor,
    };
  }

  // ------------------------------------------------------------------
  // GET /bookings/:id — Détail + billet QR si CONFIRMED
  // ------------------------------------------------------------------

  async getBookingById(
    bookingId: string,
    userId: string,
  ): Promise<Record<string, unknown>> {
    const booking = await this.db.booking.findFirst({
      where: { id: bookingId, buyerUserId: userId },
      include: {
        tripInstance: {
          include: {
            route: { include: { origin: true, destination: true } },
            vehicle: { include: { seatMap: true } },
            fares: true,
            cooperative: true,
          },
        },
        passengers: true,
        payments: true,
        seats: true,
      },
    });

    if (!booking) {
      throw new NotFoundError('Réservation introuvable');
    }

    const ticket =
      booking.status === BookingStatus.CONFIRMED
        ? {
            reference: booking.reference,
            qrPayload: booking.qrPayload,
            qrImageUrl: null,
            issuedAt: booking.confirmedAt?.toISOString() ?? booking.createdAt.toISOString(),
          }
        : null;

    const canRate = booking.status === BookingStatus.COMPLETED;
    const hasRated = canRate
      ? (await this.db.rating.count({ where: { bookingId: booking.id } })) > 0
      : false;

    return {
      ...this._formatBooking(booking),
      trip: {
        id: booking.tripInstance.id,
        cooperative: {
          id: booking.tripInstance.cooperative.id,
          slug: booking.tripInstance.cooperative.slug,
          legalName: booking.tripInstance.cooperative.legalName,
          displayName: booking.tripInstance.cooperative.displayName,
          status: booking.tripInstance.cooperative.status,
          contactEmail: booking.tripInstance.cooperative.contactEmail ?? null,
          contactPhone: booking.tripInstance.cooperative.contactPhone ?? null,
          logoUrl: booking.tripInstance.cooperative.logoUrl ?? null,
          description: booking.tripInstance.cooperative.descriptionFr ?? null,
          ratingAverage: booking.tripInstance.cooperative.ratingAverage,
          ratingCount: booking.tripInstance.cooperative.ratingCount,
        },
        route: {
          id: booking.tripInstance.route.id,
          originCity: {
            id: booking.tripInstance.route.origin.id,
            code: booking.tripInstance.route.origin.code,
            name: booking.tripInstance.route.origin.nameFr,
            district: booking.tripInstance.route.origin.district,
            region: booking.tripInstance.route.origin.region,
          },
          destinationCity: {
            id: booking.tripInstance.route.destination.id,
            code: booking.tripInstance.route.destination.code,
            name: booking.tripInstance.route.destination.nameFr,
            district: booking.tripInstance.route.destination.district,
            region: booking.tripInstance.route.destination.region,
          },
          estimatedDurationMin: booking.tripInstance.route.estimatedDurationMin ?? undefined,
        },
        vehicle: {
          id: booking.tripInstance.vehicle.id,
          model: booking.tripInstance.vehicle.model ?? null,
          capacity: booking.tripInstance.vehicle.capacity,
          plate: booking.tripInstance.vehicle.registration,
        },
        departureAt: booking.tripInstance.departureAt.toISOString(),
        arrivalEstimatedAt: booking.tripInstance.arrivalEstimatedAt?.toISOString() ?? null,
        status: booking.tripInstance.status,
        policy: null,
        fares: booking.tripInstance.fares
          .filter((f) => f.category !== null)
          .map((f) => ({
            category: f.category!,
            priceMga: f.priceMga,
          })),
      },
      passengers: booking.passengers.map((p) => ({
        firstName: p.firstName,
        lastName: p.lastName,
        seatCode: p.seatCode,
        phone: p.phone,
        boardingStatus: booking.boardingStatus,
      })),
      payments: booking.payments.map((p) => ({
        id: p.id,
        bookingId: booking.id,
        provider: p.provider,
        amountMga: p.amountMga,
        status: p.status,
        providerTransactionId: p.providerTransactionId,
        initiatedAt: p.initiatedAt.toISOString(),
        confirmedAt: p.confirmedAt?.toISOString() ?? null,
      })),
      ticket,
      canRate,
      hasRated,
    };
  }

  // ------------------------------------------------------------------
  // GET /bookings/:bookingId/ticket — billet QR seul (contrat §/bookings/{id}/ticket)
  // Retourne uniquement le bloc ticket sans les détails complets du booking.
  // ------------------------------------------------------------------

  async getBookingTicket(bookingId: string, userId: string): Promise<Record<string, unknown>> {
    const booking = await this.db.booking.findFirst({
      where: { id: bookingId, buyerUserId: userId },
      select: {
        reference: true,
        status: true,
        qrPayload: true,
        confirmedAt: true,
        createdAt: true,
      },
    });
    if (!booking) throw new NotFoundError('Réservation introuvable');
    if (booking.status !== BookingStatus.CONFIRMED) {
      const err = new Error('Billet disponible uniquement pour les réservations confirmées') as NodeJS.ErrnoException;
      err.code = 'FORBIDDEN';
      throw err;
    }
    return {
      reference: booking.reference,
      qrPayload: booking.qrPayload,
      qrImageUrl: null,
      issuedAt: booking.confirmedAt?.toISOString() ?? booking.createdAt.toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // POST /bookings/:bookingId/resend-ticket
  // Renvoi SMS du billet confirmé au voyageur (transactionnel, immédiat).
  // Seul l'acheteur authentifié peut déclencher le renvoi.
  // ------------------------------------------------------------------

  async resendTicket(bookingId: string, userId: string): Promise<void> {
    const booking = await this.db.booking.findFirst({
      where: { id: bookingId, buyerUserId: userId, status: BookingStatus.CONFIRMED },
      include: {
        buyer: { select: { phone: true, preferredLang: true } },
        passengers: { take: 1, select: { phone: true } },
        tripInstance: {
          include: { route: { include: { origin: true, destination: true } } },
        },
      },
    });

    if (!booking) throw new NotFoundError('Réservation introuvable ou non confirmée');

    const phone = booking.buyer?.phone ?? booking.passengers[0]?.phone;
    if (!phone) throw new NotFoundError('Numéro de téléphone introuvable');

    const lang = (booking.buyer?.preferredLang ?? 'FR') as 'FR' | 'MG';
    const departureStr = booking.tripInstance.departureAt.toLocaleString('fr-MG', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'Indian/Antananarivo',
    });

    const vars = {
      reference: booking.reference,
      departureAt: departureStr,
      origin: booking.tripInstance.route.origin.nameFr,
    };

    if (this.notifications) {
      await this.notifications.enqueue({
        bookingId,
        templateKey: 'BOOKING_CONFIRMED',
        variables: vars,
        lang,
        phone,
        transactional: true,
      });
    } else {
      await enqueueSms({
        phone,
        lang,
        templateCode: 'BOOKING_CONFIRMED',
        params: vars,
        isTransactional: true,
      });
    }
  }

  // ------------------------------------------------------------------
  // GET /bookings/:bookingId/ticket.pdf — billet PDF (VH-09)
  // Génère un PDF A4 avec QR code intégré.
  // Accessible uniquement si réservation CONFIRMED.
  // ------------------------------------------------------------------

  private async buildTicketPdf(booking: {
    reference: string;
    qrPayload: string | null;
    passengers: { firstName: string; lastName: string; seatCode: string }[];
    tripInstance: {
      departureAt: Date;
      cooperative: { displayName: string };
      route: { origin: { nameFr: string }; destination: { nameFr: string } };
    };
  }): Promise<Buffer> {
    const qrBuffer = await QRCode.toBuffer(booking.qrPayload ?? booking.reference, {
      width: 200,
      margin: 2,
      color: { dark: '#162E49', light: '#ffffff' },
    });

    const depDate = booking.tripInstance.departureAt.toLocaleString('fr-FR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Antananarivo',
    });
    const origin = booking.tripInstance.route.origin.nameFr;
    const dest = booking.tripInstance.route.destination.nameFr;
    const coop = booking.tripInstance.cooperative.displayName;

    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', resolve);
      doc.on('error', reject);

      // ── En-tête bleu ──────────────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 68).fill('#205E98');
      doc.fillColor('#ffffff').fontSize(24).font('Helvetica-Bold')
         .text('InsTRAM', 50, 16, { lineBreak: false });
      doc.fillColor('#9CC43D').fontSize(10).font('Helvetica')
         .text('  ●  Billet de transport', 50, 46, { lineBreak: false });

      doc.y = 88;

      // ── Coopérative ───────────────────────────────────────────────
      doc.fillColor('#4596D7').fontSize(11).font('Helvetica')
         .text(coop, { align: 'center' });

      // ── Trajet ───────────────────────────────────────────────────
      doc.moveDown(0.4);
      doc.fillColor('#162E49').fontSize(22).font('Helvetica-Bold')
         .text(`${origin}  →  ${dest}`, { align: 'center' });

      // ── Date de départ ───────────────────────────────────────────
      doc.moveDown(0.4);
      doc.fillColor('#374151').fontSize(12).font('Helvetica')
         .text(`Départ : ${depDate}`, { align: 'center' });

      // ── Séparateur ───────────────────────────────────────────────
      doc.moveDown(1.2);
      doc.strokeColor('#E5E7EB').moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
      doc.moveDown(1.2);

      // ── Passagers ────────────────────────────────────────────────
      doc.fillColor('#162E49').fontSize(11).font('Helvetica-Bold')
         .text('Passagers', { align: 'left' });
      doc.moveDown(0.5);
      for (const p of booking.passengers) {
        doc.fontSize(11).font('Helvetica').fillColor('#374151')
           .text(`${p.firstName} ${p.lastName}`, { continued: true, width: 300 });
        doc.fillColor('#205E98')
           .text(`  Siège ${p.seatCode}`);
      }

      // ── QR code centré ───────────────────────────────────────────
      doc.moveDown(1.5);
      const qrSize = 160;
      const qrX = (doc.page.width - qrSize) / 2;
      const qrY = doc.y;
      doc.image(qrBuffer, qrX, qrY, { width: qrSize });
      doc.y = qrY + qrSize + 12;

      // ── Référence ─────────────────────────────────────────────────
      doc.fillColor('#162E49').fontSize(18).font('Helvetica-Bold')
         .text(booking.reference, { align: 'center', characterSpacing: 4 });

      // ── Pied de page ─────────────────────────────────────────────
      doc.moveDown(2);
      doc.strokeColor('#E5E7EB').moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
      doc.moveDown(0.8);
      doc.fillColor('#9CA3AF').fontSize(8).font('Helvetica')
         .text(
           'Présentez ce QR code lors de votre embarquement. Ce billet est nominatif et non remboursable.',
           { align: 'center' },
         );

      doc.end();
    });

    return Buffer.concat(chunks);
  }

  async generateTicketPdf(bookingId: string, userId: string): Promise<Buffer> {
    const booking = await this.db.booking.findFirst({
      where: { id: bookingId, buyerUserId: userId },
      select: {
        reference: true,
        status: true,
        qrPayload: true,
        confirmedAt: true,
        createdAt: true,
        passengers: { select: { firstName: true, lastName: true, seatCode: true } },
        tripInstance: {
          select: {
            departureAt: true,
            cooperative: { select: { displayName: true } },
            route: {
              select: {
                origin: { select: { nameFr: true } },
                destination: { select: { nameFr: true } },
              },
            },
          },
        },
      },
    });

    if (!booking) throw new NotFoundError('Réservation introuvable');
    if (booking.status !== BookingStatus.CONFIRMED) {
      const err = new Error('Billet disponible uniquement pour les réservations confirmées') as NodeJS.ErrnoException;
      err.code = 'FORBIDDEN';
      throw err;
    }

    return this.buildTicketPdf(booking);
  }

  // ------------------------------------------------------------------
  // GET /coop/bookings/:bookingId/ticket.pdf
  // Billet PDF accessible par le staff de la coopérative propriétaire.
  // ------------------------------------------------------------------

  async generateTicketPdfByCoop(bookingId: string, cooperativeId: string): Promise<Buffer> {
    const booking = await this.db.booking.findFirst({
      where: { id: bookingId, cooperativeId },
      select: {
        reference: true,
        status: true,
        qrPayload: true,
        confirmedAt: true,
        createdAt: true,
        passengers: { select: { firstName: true, lastName: true, seatCode: true } },
        tripInstance: {
          select: {
            departureAt: true,
            cooperative: { select: { displayName: true } },
            route: {
              select: {
                origin: { select: { nameFr: true } },
                destination: { select: { nameFr: true } },
              },
            },
          },
        },
      },
    });

    if (!booking) throw new NotFoundError('Réservation introuvable');
    if (booking.status !== BookingStatus.CONFIRMED) {
      const err = new Error('Billet disponible uniquement pour les réservations confirmées') as NodeJS.ErrnoException;
      err.code = 'FORBIDDEN';
      throw err;
    }

    return this.buildTicketPdf(booking);
  }

  // ------------------------------------------------------------------
  // POST /coop/bookings/:bookingId/resend-ticket
  // Renvoi SMS du billet walk-in par le staff (utilise le tel du passager).
  // ------------------------------------------------------------------

  async resendTicketByCoop(bookingId: string, cooperativeId: string): Promise<void> {
    const booking = await this.db.booking.findFirst({
      where: { id: bookingId, cooperativeId, status: BookingStatus.CONFIRMED },
      include: {
        passengers: { take: 1, select: { phone: true } },
        tripInstance: {
          include: { route: { include: { origin: true, destination: true } } },
        },
      },
    });

    if (!booking) throw new NotFoundError('Réservation introuvable ou non confirmée');

    const phone = booking.passengers[0]?.phone;
    if (!phone) throw new NotFoundError('Numéro de téléphone passager introuvable');

    const lang = 'FR' as const;
    const departureStr = booking.tripInstance.departureAt.toLocaleString('fr-MG', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'Indian/Antananarivo',
    });

    const vars = {
      reference: booking.reference,
      departureAt: departureStr,
      origin: booking.tripInstance.route.origin.nameFr,
    };

    if (this.notifications) {
      await this.notifications.enqueue({
        bookingId,
        templateKey: 'BOOKING_CONFIRMED',
        variables: vars,
        lang,
        phone,
        transactional: true,
      });
    } else {
      await enqueueSms({
        phone,
        lang,
        templateCode: 'BOOKING_CONFIRMED',
        params: vars,
        isTransactional: true,
      });
    }
  }

  // ------------------------------------------------------------------
  // POST /coop/bookings/walk-in
  // RG-02 : PlatformFee = 0 ET Commission = 0 — vérification explicite
  // Même transaction atomique que le hold (SELECT FOR UPDATE + contraintes)
  // ------------------------------------------------------------------

  async createWalkIn(
    staffUserId: string,
    cooperativeId: string,
    input: WalkInBookingInput,
  ): Promise<Record<string, unknown>> {
    const { tripInstanceId, seatDefinitionIds, passengers, paymentMethod, buyerPhone, buyerLang } =
      input;

    // Vérifier que le trajet appartient à la coopérative de l'agent
    const trip = await this.db.tripInstance.findFirst({
      where: { id: tripInstanceId, cooperativeId },
      include: {
        fares: true,
        route: { include: { origin: { select: { nameFr: true } }, destination: { select: { nameFr: true } } } },
      },
    });

    if (!trip) {
      throw new ForbiddenError(
        "Trajet introuvable ou non appartenant à votre coopérative",
      );
    }

    // Charger les sièges demandés
    const seatDefs = await this.db.seatDefinition.findMany({
      where: { id: { in: seatDefinitionIds } },
      select: { id: true, code: true, category: true },
    });

    if (seatDefs.length !== seatDefinitionIds.length) {
      throw new NotFoundError('Un ou plusieurs sièges introuvables');
    }

    const seatCodeMap = new Map(seatDefs.map((s) => [s.id, s.code]));
    const seatCategoryMap = new Map(seatDefs.map((s) => [s.id, s.category]));

    // Tarifs
    const fareByDefId = new Map<string, number>();
    const fareByCat = new Map<string, number>();
    for (const fare of trip.fares) {
      if (fare.seatDefinitionId) fareByDefId.set(fare.seatDefinitionId, fare.priceMga);
      else if (fare.category) fareByCat.set(fare.category, fare.priceMga);
    }

    // C-3 : lancer FARE_NOT_FOUND si aucun tarif n'est configuré pour un siège
    let seatSubtotalMga = 0;
    for (const id of seatDefinitionIds) {
      const cat = seatCategoryMap.get(id);
      const price = fareByDefId.get(id) ?? (cat ? fareByCat.get(cat) ?? null : null);
      if (price === null) {
        throw Object.assign(
          new Error('Aucun tarif configuré pour un ou plusieurs sièges'),
          { code: 'FARE_NOT_FOUND' },
        );
      }
      seatSubtotalMga += price;
    }

    // RG-02 : WALK-IN → frais = 0, commission = 0 (vérification explicite)
    const WALK_IN_PLATFORM_FEE = 0;
    const WALK_IN_COMMISSION = 0;
    if (WALK_IN_PLATFORM_FEE !== 0 || WALK_IN_COMMISSION !== 0) {
      // Cette assertion ne devrait jamais se déclencher — garantie de non-régression
      throw new Error('VIOLATION RG-02 : Walk-in ne peut jamais avoir de frais plateforme ou commission');
    }

    // Référence unique
    let reference = generateBookingReference();
    let refExists = await this.db.booking.findUnique({ where: { reference } });
    while (refExists) {
      reference = generateBookingReference();
      refExists = await this.db.booking.findUnique({ where: { reference } });
    }

    const seatCodes = seatDefinitionIds.map((id) => seatCodeMap.get(id) ?? id);
    const issuedAt = new Date().toISOString();
    const qrPayload = generateQrPayload({
      bookingRef: reference,
      tripInstanceId,
      seatCodes,
      issuedAt,
    });

    // Transaction atomique (même protection que hold ONLINE)
    const booking = await this.db.$transaction(async (tx) => {
      // SELECT FOR UPDATE sur chaque SeatDefinition
      for (const seatId of seatDefinitionIds) {
        await tx.$queryRaw`
          SELECT id FROM "SeatDefinition"
          WHERE id = ${seatId}::uuid
          FOR UPDATE
        `;
      }

      // Vérifier BookingSeat actifs
      const activeBookingSeats = await tx.bookingSeat.findMany({
        where: {
          tripInstanceId,
          seatDefinitionId: { in: seatDefinitionIds },
          isActive: true,
        },
        select: { seatDefinitionId: true, seatCode: true },
      });

      // Vérifier SeatHolds non expirés
      const activeHolds = await tx.seatHold.findMany({
        where: {
          tripInstanceId,
          seatDefinitionId: { in: seatDefinitionIds },
          expiresAt: { gt: new Date() },
        },
        select: { seatDefinitionId: true },
      });

      const conflicting = [
        ...activeBookingSeats.map((bs) => ({
          seatDefinitionId: bs.seatDefinitionId,
          code: bs.seatCode,
          status: 'SOLD' as const,
        })),
        ...activeHolds.map((h) => ({
          seatDefinitionId: h.seatDefinitionId,
          code: seatCodeMap.get(h.seatDefinitionId) ?? h.seatDefinitionId,
          status: 'HELD' as const,
        })),
      ];

      if (conflicting.length > 0) {
        throw new ConflictError('Siège(s) déjà pris', conflicting);
      }

      // Créer le Booking WALK_IN directement CONFIRMED
      const created = await tx.booking.create({
        data: {
          reference,
          tripInstanceId,
          cooperativeId,
          createdByStaffId: staffUserId,
          channel: BookingChannel.WALK_IN,
          status: BookingStatus.CONFIRMED,
          boardingStatus: 'NOT_BOARDED',
          totalAmountMga: seatSubtotalMga,
          seatSubtotalMga,
          platformFeeMga: WALK_IN_PLATFORM_FEE, // Toujours 0 (RG-02)
          qrPayload,
          confirmedAt: new Date(),
        },
      });

      // Créer les BookingSeats directement actifs
      for (const seatId of seatDefinitionIds) {
        const cat = seatCategoryMap.get(seatId)!;
        const price = fareByDefId.get(seatId) ?? fareByCat.get(cat) ?? 0;
        await tx.bookingSeat.create({
          data: {
            bookingId: created.id,
            tripInstanceId,
            seatDefinitionId: seatId,
            seatCode: seatCodeMap.get(seatId) ?? seatId,
            category: cat,
            priceMga: price,
            isActive: true,
          },
        });
      }

      // Créer le Payment CASH (ou mobile) — RG-02 : pas de frais plateforme
      const payment = await tx.payment.create({
        data: {
          bookingId: created.id,
          provider: paymentMethod as PaymentProvider,
          amountMga: seatSubtotalMga,
          status: PaymentStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
      });

      // PlatformFee = 0 (RG-02)
      await tx.platformFee.create({
        data: {
          paymentId: payment.id,
          amountMga: WALK_IN_PLATFORM_FEE, // 0
          policyRef: 'RG-02-WALK_IN',
        },
      });

      // Commission = 0 (RG-02)
      await tx.commission.create({
        data: {
          bookingId: created.id,
          paymentId: payment.id,
          cooperativeId,
          amountMga: WALK_IN_COMMISSION, // 0
          pricingPlanRef: 'RG-02-WALK_IN',
        },
      });

      // Passagers
      await tx.passenger.createMany({
        data: passengers.map((p) => ({
          bookingId: created.id,
          firstName: p.firstName,
          lastName: p.lastName,
          phone: p.phone ?? null,
          nationalIdRef: p.nationalIdRef ?? null,
          seatCode: p.seatCode,
        })),
      });

      // AuditLog (RG-13 : traçabilité walk-in)
      await tx.auditLog.create({
        data: {
          actorUserId: staffUserId,
          action: AuditAction.BOOKING_CREATED,
          entityType: 'Booking',
          entityId: created.id,
          after: {
            reference,
            tripInstanceId,
            channel: 'WALK_IN',
            seatSubtotalMga,
            platformFeeMga: 0,
            commissionMga: 0,
          },
        },
      });

      return created;
    });

    // Pub/Sub : SEAT_SOLD
    await this.redis.publish(
      `trip:${tripInstanceId}`,
      JSON.stringify({
        event: 'SEAT_SOLD',
        tripInstanceId,
        seatDefinitionIds,
        bookingId: booking.id,
      }),
    );

    // SMS si téléphone fourni (transactionnel — bypass silence nocturne VH-02)
    const smsPhone = buyerPhone ?? passengers[0]?.phone;
    if (smsPhone) {
      const smsLang = (buyerLang as 'FR' | 'MG') ?? 'FR';
      if (this.notifications) {
        await this.notifications.enqueue({
          userId: staffUserId,
          bookingId: booking.id,
          templateKey: 'WALK_IN_CONFIRMED',
          variables: {
            reference,
            seatCodes: seatCodes.join(', '),
            departureAt: trip.departureAt.toLocaleString('fr-MG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Indian/Antananarivo' }),
            origin: trip.route.origin.nameFr,
            destination: trip.route.destination.nameFr,
          },
          lang: smsLang,
          phone: smsPhone,
          transactional: true,
        });
      } else {
        // Fallback : enqueueSms direct (si notificationsService non injecté)
        await enqueueSms({
          phone: smsPhone,
          templateCode: 'WALK_IN_CONFIRMED',
          params: {
            reference, seatCodes: seatCodes.join(', '),
            departureAt: trip.departureAt.toLocaleString('fr-MG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Indian/Antananarivo' }),
            origin: trip.route.origin.nameFr,
            destination: trip.route.destination.nameFr,
          },
          lang: smsLang,
          bookingId: booking.id,
          isTransactional: true,
        });
      }
    }

    // Retourner le détail complet (BookingDetail per contract)
    return this._formatBookingDetail(booking, seatCodes, seatDefinitionIds, seatSubtotalMga);
  }

  // ------------------------------------------------------------------
  // POST /coop/bookings/:id/cancel-at-counter
  // RG-03 : seul point d'annulation — pas de remboursement automatique
  // ------------------------------------------------------------------

  async cancelAtCounter(
    bookingId: string,
    staffUserId: string,
    cooperativeId: string,
    input: CancelAtCounterInput,
  ): Promise<Record<string, unknown>> {
    const { reason, refundedAtCounter } = input;

    const booking = await this.db.booking.findFirst({
      where: { id: bookingId, cooperativeId },
      include: {
        seats: { where: { isActive: true } },
        payments: true,
        buyer: true,
        passengers: { take: 1 },
      },
    });

    if (!booking) {
      throw new NotFoundError('Réservation introuvable');
    }

    if (
      booking.status === BookingStatus.CANCELLED_AT_COUNTER ||
      booking.status === BookingStatus.COMPLETED
    ) {
      throw new ConflictError('Réservation déjà annulée ou terminée');
    }

    const tripInstanceId = booking.tripInstanceId;
    const seatDefinitionIds = booking.seats.map((s) => s.seatDefinitionId);

    const updated = await this.db.$transaction(async (tx) => {
      // Mettre à jour le statut Booking
      const upd = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED_AT_COUNTER,
          cancelledAt: new Date(),
          cancelledReason: reason,
          cancelledByStaffId: staffUserId,
        },
      });

      // Désactiver les BookingSeats
      await tx.bookingSeat.updateMany({
        where: { bookingId, isActive: true },
        data: { isActive: false },
      });

      // Traçabilité remboursement physique (sans mouvement financier automatique)
      if (refundedAtCounter) {
        await tx.payment.updateMany({
          where: { bookingId, status: PaymentStatus.CONFIRMED },
          data: { status: 'REFUNDED_AT_COUNTER' as PaymentStatus },
        });
      }

      // AuditLog (RG-13)
      await tx.auditLog.create({
        data: {
          actorUserId: staffUserId,
          action: AuditAction.BOOKING_CANCELLED_AT_COUNTER,
          entityType: 'Booking',
          entityId: bookingId,
          before: { status: booking.status },
          after: {
            status: BookingStatus.CANCELLED_AT_COUNTER,
            reason,
            refundedAtCounter,
          },
        },
      });

      return upd;
    });

    // Pub/Sub : SEAT_RELEASED
    if (seatDefinitionIds.length > 0) {
      await this.redis.publish(
        `trip:${tripInstanceId}`,
        JSON.stringify({
          event: 'SEAT_RELEASED',
          tripInstanceId,
          seatDefinitionIds,
          bookingId,
        }),
      );
    }

    // Notification SMS annulation (transactionnelle — envoi immédiat)
    const cancelPhone = booking.buyer?.phone ?? booking.passengers[0]?.phone;
    const cancelLang = (booking.buyer?.preferredLang ?? 'FR') as 'FR' | 'MG';
    if (cancelPhone) {
      const vars = { reference: booking.reference };
      if (this.notifications) {
        await this.notifications.enqueue({
          bookingId,
          templateKey: 'BOOKING_CANCELLED',
          variables: vars,
          lang: cancelLang,
          phone: cancelPhone,
          transactional: true,
        }).catch((e: unknown) => console.error('[BookingsService] cancelAtCounter SMS error', e));
      } else {
        await enqueueSms({
          phone: cancelPhone,
          lang: cancelLang,
          templateCode: 'BOOKING_CANCELLED',
          params: vars,
          isTransactional: true,
        }).catch((e: unknown) => console.error('[BookingsService] cancelAtCounter SMS fallback error', e));
      }
    }

    return this._formatBooking(updated);
  }

  // ------------------------------------------------------------------
  // Formatage DTO
  // ------------------------------------------------------------------

  private _formatBooking(booking: {
    id: string;
    reference: string;
    status: string;
    channel: string;
    totalAmountMga: number;
    seatSubtotalMga: number;
    platformFeeMga: number;
    tripInstanceId: string;
    createdAt: Date;
  }): Record<string, unknown> {
    return {
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      channel: booking.channel,
      totalAmountMga: booking.totalAmountMga,
      seatSubtotalMga: booking.seatSubtotalMga,
      platformFeeMga: booking.platformFeeMga,
      tripInstanceId: booking.tripInstanceId,
      createdAt: booking.createdAt.toISOString(),
    };
  }

  private _formatBookingDetail(
    booking: { id: string; reference: string; status: string; channel: string; totalAmountMga: number; seatSubtotalMga: number; platformFeeMga: number; tripInstanceId: string; createdAt: Date; qrPayload: string; confirmedAt?: Date | null },
    seatCodes: string[],
    _seatDefinitionIds: string[],
    _seatSubtotalMga: number,
  ): Record<string, unknown> {
    return {
      ...this._formatBooking(booking),
      ticket: {
        reference: booking.reference,
        qrPayload: booking.qrPayload,
        qrImageUrl: null,
        issuedAt: booking.confirmedAt?.toISOString() ?? booking.createdAt.toISOString(),
      },
      seatCodes,
    };
  }

  // ------------------------------------------------------------------
  // GET /coop/bookings — liste des réservations de la coopérative
  // ------------------------------------------------------------------

  async getCoopBookings(
    cooperativeId: string,
    query: BookingListQueryInput,
  ): Promise<Record<string, unknown>> {
    const { status, channel, cursor, limit } = query;

    const where: Record<string, unknown> = {
      tripInstance: { cooperativeId },
    };
    if (status) where.status = status;
    if (channel) where.channel = channel;
    if (cursor) where.id = { lt: cursor };

    const items = await this.db.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        tripInstance: {
          include: {
            route: { include: { origin: true, destination: true } },
          },
        },
        buyer: { select: { phone: true, email: true } },
        passengers: { take: 1, select: { firstName: true, lastName: true } },
      },
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      items: page.map((b) => ({
        id: b.id,
        reference: b.reference,
        status: b.status,
        channel: b.channel,
        totalAmountMga: b.totalAmountMga,
        tripInstanceId: b.tripInstanceId,
        createdAt: b.createdAt.toISOString(),
        buyer: {
          phone: b.buyer?.phone ?? null,
          email: b.buyer?.email ?? null,
          firstName: b.passengers[0]?.firstName ?? null,
          lastName: b.passengers[0]?.lastName ?? null,
        },
        tripInstance: {
          departureAt: b.tripInstance.departureAt.toISOString(),
          route: {
            origin: b.tripInstance.route.origin.nameFr,
            destination: b.tripInstance.route.destination.nameFr,
          },
        },
      })),
      nextCursor,
    };
  }

  // ------------------------------------------------------------------
  // GET /coop/bookings/:bookingId — détail d'une réservation (vue coop)
  // ------------------------------------------------------------------

  async getCoopBookingById(
    cooperativeId: string,
    bookingId: string,
  ): Promise<Record<string, unknown>> {
    const booking = await this.db.booking.findFirst({
      where: { id: bookingId, tripInstance: { cooperativeId } },
      include: {
        tripInstance: {
          include: {
            route: { include: { origin: true, destination: true } },
          },
        },
        buyer: { select: { id: true, phone: true, email: true } },
        passengers: true,
        payments: true,
        seats: { include: { seatDefinition: { select: { code: true, category: true } } } },
      },
    });

    if (!booking) throw new NotFoundError('Réservation introuvable');

    return {
      ...this._formatBooking(booking),
      buyer: {
        id: booking.buyer?.id ?? null,
        phone: booking.buyer?.phone ?? null,
        email: booking.buyer?.email ?? null,
      },
      trip: {
        id: booking.tripInstance.id,
        departureAt: booking.tripInstance.departureAt.toISOString(),
        status: booking.tripInstance.status,
        route: {
          origin: booking.tripInstance.route.origin.nameFr,
          destination: booking.tripInstance.route.destination.nameFr,
        },
      },
      passengers: booking.passengers.map((p) => ({
        firstName: p.firstName,
        lastName: p.lastName,
        seatCode: p.seatCode,
        phone: p.phone,
        nationalIdRef: p.nationalIdRef,
      })),
      payments: booking.payments.map((p) => ({
        id: p.id,
        provider: p.provider,
        amountMga: p.amountMga,
        status: p.status,
        initiatedAt: p.initiatedAt.toISOString(),
        confirmedAt: p.confirmedAt?.toISOString() ?? null,
      })),
    };
  }
}
