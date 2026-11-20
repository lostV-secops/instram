import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { BoardInput, NoShowInput, DepartInput } from './driver.schema';
import {
  emitDriverBoardingUpdate,
  emitCoopDashboardUpdate,
} from '../ws/ws.publisher';

// =====================================================================
// InsTRAM — DriverService
// Contrat : docs/contrat-api.yaml §Driver
// Architecture §3 : driver lit bookings, écrit boardingStatus + events.
// Architecture §6.5 : flux embarquement conducteur.
//
// Règles absolues :
//   - Signature QR vérifiée HMAC-SHA256 (clé QR_SECRET env, jamais trust client)
//   - Émettre WS APRÈS commit de la transaction
//   - Zéro improvisation hors contrat
// =====================================================================

// =====================================================================
// Erreurs métier
// =====================================================================

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class InvalidQrError extends Error {
  readonly code = 'INVALID_QR';
  readonly httpStatus = 403;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQrError';
  }
}

export class WrongTripError extends Error {
  readonly code = 'WRONG_TRIP';
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message);
    this.name = 'WrongTripError';
  }
}

export class AlreadyBoardedError extends Error {
  readonly code = 'ALREADY_BOARDED';
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyBoardedError';
  }
}

export class NoShowBeforeDepartureError extends Error {
  readonly code = 'NO_SHOW_BEFORE_DEPARTURE';
  readonly httpStatus = 400;
  constructor(message: string) {
    super(message);
    this.name = 'NoShowBeforeDepartureError';
  }
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Décalage UTC+3 pour Madagascar (VH-02 et calcul du « aujourd'hui »).
 */
const MADA_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Retourne la plage UTC correspondant au « aujourd'hui » en heure Madagascar.
 */
function getMadagascarTodayRange(): { start: Date; end: Date } {
  const nowUtc = Date.now();
  const nowMada = new Date(nowUtc + MADA_OFFSET_MS);

  // Minuit et 23:59:59.999 en heure Madagascar → converti en UTC
  const startMada = Date.UTC(
    nowMada.getUTCFullYear(),
    nowMada.getUTCMonth(),
    nowMada.getUTCDate(),
    0, 0, 0, 0,
  );
  const endMada = Date.UTC(
    nowMada.getUTCFullYear(),
    nowMada.getUTCMonth(),
    nowMada.getUTCDate(),
    23, 59, 59, 999,
  );

  return {
    start: new Date(startMada - MADA_OFFSET_MS),
    end: new Date(endMada - MADA_OFFSET_MS),
  };
}

/**
 * Vérifie la signature HMAC-SHA256 du payload QR (VH-09).
 * Le payload est un objet base64url encodé :
 *   { bookingRef, tripInstanceId, seatCodes, issuedAt, sig }
 * où sig = HMAC-SHA256 de JSON.stringify({ bookingRef, tripInstanceId, seatCodes, issuedAt }).
 *
 * Lance InvalidQrError si le format ou la signature est invalide.
 */
function verifyQrPayload(qrPayload: string): {
  bookingRef: string;
  tripInstanceId: string;
  seatCodes: string[];
  issuedAt: string;
} {
  const secret = process.env.QR_SECRET ?? 'change_me_qr_secret';

  let decoded: {
    bookingRef: string;
    tripInstanceId: string;
    seatCodes: string[];
    issuedAt: string;
    sig: string;
  };

  try {
    const raw = Buffer.from(qrPayload, 'base64url').toString('utf-8');
    decoded = JSON.parse(raw) as typeof decoded;
  } catch {
    throw new InvalidQrError('QR payload impossible à décoder');
  }

  if (
    typeof decoded.bookingRef !== 'string' ||
    typeof decoded.tripInstanceId !== 'string' ||
    !Array.isArray(decoded.seatCodes) ||
    typeof decoded.issuedAt !== 'string' ||
    typeof decoded.sig !== 'string'
  ) {
    throw new InvalidQrError('Structure QR invalide');
  }

  // Reconstitue le corps signé (sans la signature) dans le même ordre que lors de l'émission
  const { sig, ...data } = decoded;
  const body = JSON.stringify(data);

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  // Comparaison à temps constant (évite les timing attacks)
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    throw new InvalidQrError('Signature QR invalide');
  }

  return data;
}

// =====================================================================
// Service
// =====================================================================

export class DriverService {
  constructor(private readonly db: PrismaClient) {}

  // ------------------------------------------------------------------
  // Helpers privés
  // ------------------------------------------------------------------

  /**
   * Vérifie que l'utilisateur est un conducteur actif de la coopérative
   * propriétaire du trajet. Retourne l'objet Membership.
   * Lance ForbiddenError si le rôle est absent ou inactif.
   */
  private async assertDriverForCoop(
    userId: string,
    cooperativeId: string,
  ): Promise<{ id: string; cooperativeId: string }> {
    const membership = await this.db.membership.findFirst({
      where: {
        userId,
        cooperativeId,
        role: 'COOP_DRIVER',
        active: true,
      },
      select: { id: true, cooperativeId: true },
    });

    if (!membership) {
      throw new ForbiddenError(
        'Accès refusé : rôle COOP_DRIVER actif requis pour cette coopérative',
      );
    }

    return membership;
  }

  // ------------------------------------------------------------------
  // GET /v1/driver/trips/today
  // ------------------------------------------------------------------

  /**
   * Retourne les TripInstance du jour (heure Madagascar) pour les
   * coopératives où l'utilisateur est conducteur actif.
   * Projection légère : tripInstanceId, departureAt, route, status,
   * boardedCount, totalPassengers.
   */
  async getTripsToday(userId: string): Promise<
    {
      tripInstanceId: string;
      departureAt: Date;
      route: { origin: string; destination: string };
      vehicleRegistration?: string;
      status: string;
      boardedCount: number;
      totalPassengers: number;
    }[]
  > {
    // Trouve les memberships COOP_DRIVER actifs de l'utilisateur
    const memberships = await this.db.membership.findMany({
      where: { userId, role: 'COOP_DRIVER', active: true },
      select: { cooperativeId: true },
    });

    if (memberships.length === 0) {
      throw new ForbiddenError("Aucun rôle conducteur actif pour cet utilisateur");
    }

    const coopIds = memberships.map((m) => m.cooperativeId);
    const { start, end } = getMadagascarTodayRange();

    const trips = await this.db.tripInstance.findMany({
      where: {
        cooperativeId: { in: coopIds },
        departureAt: { gte: start, lte: end },
        status: { not: 'CANCELLED' },
      },
      include: {
        route: {
          include: {
            origin: { select: { nameFr: true } },
            destination: { select: { nameFr: true } },
          },
        },
        vehicle: { select: { registration: true } },
        // Embarqués : nombre de BoardingEvent pour ce trajet
        boardingEvents: { select: { id: true } },
        // Passagers confirmés : bookings avec statut CONFIRMED ou COMPLETED
        bookings: {
          where: { status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } },
          select: { id: true },
        },
      },
      orderBy: { departureAt: 'asc' },
    });

    return trips.map((t) => ({
      tripInstanceId: t.id,
      departureAt: t.departureAt,
      route: {
        origin: t.route.origin.nameFr,
        destination: t.route.destination.nameFr,
      },
      vehicleRegistration: t.vehicle.registration ?? undefined,
      status: t.status,
      boardedCount: t.boardingEvents.length,
      totalPassengers: t.bookings.length,
    }));
  }

  // ------------------------------------------------------------------
  // GET /v1/driver/trips/:tripInstanceId/manifest
  // ------------------------------------------------------------------

  /**
   * Manifeste complet des passagers confirmés d'un trajet, trié par
   * numéro de siège. Auth : conducteur de la coop propriétaire.
   */
  async getManifest(
    userId: string,
    tripInstanceId: string,
  ): Promise<{
    tripInstanceId: string;
    departureAt: string;
    passengers: {
      bookingId: string;
      reference: string;
      passenger: { firstName: string; lastName: string };
      seatCode: string;
      boardingStatus: string;
      paymentMethod: string;
    }[];
    totalPassengers: number;
    boarded: number;
    absent: number;
    pending: number;
  }> {
    const trip = await this.db.tripInstance.findUnique({
      where: { id: tripInstanceId },
      select: { id: true, cooperativeId: true, departureAt: true },
    });
    if (!trip) throw new NotFoundError('Trajet introuvable');

    await this.assertDriverForCoop(userId, trip.cooperativeId);

    // Récupère les réservations embarquables (confirmées, terminées, absentes)
    const bookings = await this.db.booking.findMany({
      where: { tripInstanceId, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } },
      include: {
        // Passenger records sont toujours créés à la réservation (contrairement à BookingSeat)
        passengers: {
          select: { firstName: true, lastName: true, seatCode: true },
        },
        payments: {
          select: { provider: true, status: true },
          orderBy: { initiatedAt: 'desc' },
          take: 1,
        },
      },
    });

    // Construit une entrée par passager (source primaire, toujours disponible)
    const entries: {
      bookingId: string;
      reference: string;
      passenger: { firstName: string; lastName: string };
      seatCode: string;
      boardingStatus: string;
      paymentMethod: string;
    }[] = [];

    for (const booking of bookings) {
      const paymentMethod = booking.payments[0]?.provider ?? 'CASH';

      for (const pass of booking.passengers) {
        entries.push({
          bookingId: booking.id,
          reference: booking.reference,
          passenger: {
            firstName: pass.firstName,
            lastName: pass.lastName,
          },
          seatCode: pass.seatCode ?? '',
          boardingStatus: booking.boardingStatus,
          paymentMethod,
        });
      }
    }

    // Tri par numéro de siège (tri naturel : "1A" < "2A" < "10A")
    entries.sort((a, b) =>
      a.seatCode.localeCompare(b.seatCode, undefined, { numeric: true }),
    );

    // Totaux calculés par booking (boardingStatus est au niveau booking)
    const boarded = bookings.filter((b) => b.boardingStatus === 'BOARDED').length;
    const absent = bookings.filter((b) => b.boardingStatus === 'ABSENT').length;
    const pending = bookings.filter((b) => b.boardingStatus === 'NOT_BOARDED').length;

    return {
      tripInstanceId,
      departureAt: trip.departureAt.toISOString(),
      passengers: entries,
      totalPassengers: entries.length,
      boarded,
      absent,
      pending,
    };
  }

  // ------------------------------------------------------------------
  // POST /v1/driver/trips/:tripInstanceId/board
  // ------------------------------------------------------------------

  /**
   * Valide l'embarquement d'un passager (scan QR ou saisie référence).
   * - qrPayload : vérifie signature HMAC, extrait bookingRef
   * - bookingReference : lookup direct
   * - Crée BoardingEvent et met à jour Booking.boardingStatus = BOARDED
   * - Émet DRIVER_BOARDING_UPDATE sur driver:{tripInstanceId}
   */
  async board(
    userId: string,
    tripInstanceId: string,
    input: BoardInput,
  ): Promise<{
    bookingId: string;
    reference: string;
    passenger: { firstName: string; lastName: string };
    seatCode: string;
    boardedAt: Date;
  }> {
    // Résolution de la référence selon la méthode d'input
    let bookingRef: string;
    let method: 'SCAN' | 'MANUAL_REF';

    if (input.qrPayload) {
      // Vérification HMAC obligatoire — jamais de trust client
      const qrData = verifyQrPayload(input.qrPayload); // lance InvalidQrError si invalide

      if (qrData.tripInstanceId !== tripInstanceId) {
        throw new WrongTripError(
          'Le QR code correspond à un trajet différent',
        );
      }

      bookingRef = qrData.bookingRef;
      method = 'SCAN';
    } else {
      bookingRef = input.bookingReference!;
      method = 'MANUAL_REF';
    }

    // Récupère la réservation
    const booking = await this.db.booking.findUnique({
      where: { reference: bookingRef },
      include: {
        passengers: {
          select: { firstName: true, lastName: true, seatCode: true },
          take: 1,
        },
        seats: {
          where: { isActive: true },
          select: { seatCode: true },
          take: 1,
        },
      },
    });

    if (!booking) {
      throw new NotFoundError('Réservation introuvable');
    }

    // Vérifie que le booking appartient à ce tripInstanceId
    if (booking.tripInstanceId !== tripInstanceId) {
      throw new WrongTripError('La réservation appartient à un autre trajet');
    }

    // Vérifie le statut du booking
    if (booking.status !== 'CONFIRMED') {
      throw new WrongTripError(
        `Réservation non confirmée (statut actuel : ${booking.status})`,
      );
    }

    // Vérifie que le passager n'est pas déjà embarqué
    if (booking.boardingStatus === 'BOARDED') {
      throw new AlreadyBoardedError('Ce passager est déjà embarqué');
    }

    // Vérifie le rôle conducteur pour cette coopérative
    const membership = await this.assertDriverForCoop(
      userId,
      booking.cooperativeId,
    );

    const now = new Date();

    // Transaction : crée BoardingEvent + met à jour boardingStatus
    // La contrainte @@unique([bookingId]) sur BoardingEvent protège contre
    // les doubles embarquements concurrents (P2002 capté ci-dessous).
    let boardingEvent: { id: string; bookingId: string; boardedAt: Date };
    try {
      boardingEvent = await this.db.$transaction(async (tx) => {
        const event = await tx.boardingEvent.create({
          data: {
            bookingId: booking.id,
            tripInstanceId,
            driverMembershipId: membership.id,
            method,
            boardedAt: now,
          },
          select: { id: true, bookingId: true, boardedAt: true },
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: { boardingStatus: 'BOARDED' },
        });

        return event;
      });
    } catch (err) {
      // Contrainte unique violée = double embarquement concurrent
      const prismaErr = err as { code?: string };
      if (prismaErr.code === 'P2002') {
        throw new AlreadyBoardedError('Ce passager a été embarqué en parallèle');
      }
      throw err;
    }

    // Émission WS APRÈS le commit (règle absolue)
    await emitDriverBoardingUpdate(tripInstanceId, {
      type: 'BOARDED',
      bookingId: booking.id,
      reference: booking.reference,
      seatCode: booking.seats[0]?.seatCode ?? null,
      boardedAt: now.toISOString(),
    });

    return {
      bookingId: booking.id,
      reference: booking.reference,
      passenger: {
        firstName: booking.passengers[0]?.firstName ?? '',
        lastName: booking.passengers[0]?.lastName ?? '',
      },
      seatCode: booking.seats[0]?.seatCode ?? '',
      boardedAt: boardingEvent.boardedAt,
    };
  }

  // ------------------------------------------------------------------
  // POST /v1/driver/trips/:tripInstanceId/no-show
  // ------------------------------------------------------------------

  /**
   * Marque un passager absent. Seulement si le départ a été signalé
   * (TripDepartureEvent existant). Crée AbsenceEvent + met à jour
   * Booking.boardingStatus = ABSENT.
   */
  async noShow(
    userId: string,
    tripInstanceId: string,
    input: NoShowInput,
  ): Promise<{
    id: string;
    bookingId: string;
    tripInstanceId: string;
    markedAt: Date;
    reason?: string | null;
  }> {
    const trip = await this.db.tripInstance.findUnique({
      where: { id: tripInstanceId },
      select: { id: true, cooperativeId: true },
    });
    if (!trip) throw new NotFoundError('Trajet introuvable');

    await this.assertDriverForCoop(userId, trip.cooperativeId);

    // Vérifie que le départ a bien été signalé
    const departureEvent = await this.db.tripDepartureEvent.findFirst({
      where: { tripInstanceId },
      select: { id: true },
    });
    if (!departureEvent) {
      throw new NoShowBeforeDepartureError(
        'Le no-show ne peut être enregistré qu\'après le signalement du départ',
      );
    }

    // Récupère la réservation
    const booking = await this.db.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        tripInstanceId: true,
        cooperativeId: true,
        status: true,
        boardingStatus: true,
      },
    });
    if (!booking) throw new NotFoundError('Réservation introuvable');

    if (booking.tripInstanceId !== tripInstanceId) {
      throw new ForbiddenError('La réservation appartient à un autre trajet');
    }

    if (booking.status !== 'CONFIRMED') {
      throw new WrongTripError(
        `Réservation non confirmée (statut actuel : ${booking.status})`,
      );
    }

    const membership = await this.assertDriverForCoop(userId, booking.cooperativeId);
    const now = new Date();

    const absenceEvent = await this.db.$transaction(async (tx) => {
      const event = await tx.absenceEvent.create({
        data: {
          bookingId: input.bookingId,
          tripInstanceId,
          markedByMembershipId: membership.id,
          reason: input.reason,
          markedAt: now,
        },
        select: { id: true, bookingId: true, tripInstanceId: true, markedAt: true, reason: true },
      });

      await tx.booking.update({
        where: { id: input.bookingId },
        data: { boardingStatus: 'ABSENT' },
      });

      return event;
    });

    // Émission WS APRÈS le commit
    await emitDriverBoardingUpdate(tripInstanceId, {
      type: 'NO_SHOW',
      bookingId: input.bookingId,
      markedAt: now.toISOString(),
    });

    return absenceEvent;
  }

  // ------------------------------------------------------------------
  // POST /v1/driver/trips/:tripInstanceId/depart
  // ------------------------------------------------------------------

  /**
   * Signale le départ effectif du véhicule.
   * Idempotent : si TripDepartureEvent existe déjà, retourne 200 sans doublon.
   * Crée TripDepartureEvent + met à jour TripInstance.status = DEPARTED.
   * Émet DRIVER_BOARDING_UPDATE et COOP_DASHBOARD_UPDATE.
   */
  async depart(
    userId: string,
    tripInstanceId: string,
    input: DepartInput,
  ): Promise<{
    id: string;
    tripInstanceId: string;
    departedAt: Date;
    notes?: string | null;
    alreadyDeparted: boolean;
  }> {
    const trip = await this.db.tripInstance.findUnique({
      where: { id: tripInstanceId },
      select: { id: true, cooperativeId: true, status: true },
    });
    if (!trip) throw new NotFoundError('Trajet introuvable');

    await this.assertDriverForCoop(userId, trip.cooperativeId);

    const membership = await this.assertDriverForCoop(userId, trip.cooperativeId);
    const now = new Date();

    // Transaction idempotente : vérifie l'existence avant de créer
    const { event, isNew } = await this.db.$transaction(async (tx) => {
      // Vérifie si un TripDepartureEvent existe déjà
      const existing = await tx.tripDepartureEvent.findFirst({
        where: { tripInstanceId },
        select: { id: true, tripInstanceId: true, departedAt: true, notes: true },
      });

      if (existing) {
        return { event: existing, isNew: false };
      }

      // Crée l'événement de départ
      const newEvent = await tx.tripDepartureEvent.create({
        data: {
          tripInstanceId,
          reportedByMembershipId: membership.id,
          departedAt: now,
          notes: input?.notes,
        },
        select: { id: true, tripInstanceId: true, departedAt: true, notes: true },
      });

      // Met à jour le statut du trajet (DEPARTED = schéma TripStatus enum)
      await tx.tripInstance.update({
        where: { id: tripInstanceId },
        data: {
          status: 'DEPARTED',
          actualDepartedAt: now,
        },
      });

      return { event: newEvent, isNew: true };
    });

    // Émissions WS uniquement si c'est un nouveau départ (idempotence WS aussi)
    if (isNew) {
      await emitDriverBoardingUpdate(tripInstanceId, {
        type: 'DEPARTED',
        departedAt: now.toISOString(),
      });

      await emitCoopDashboardUpdate(trip.cooperativeId, {
        type: 'TRIP_DEPARTED',
        tripInstanceId,
        departedAt: now.toISOString(),
      });
    }

    return { ...event, alreadyDeparted: !isNew };
  }
}
