import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { BookingChannel } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { HoldSeatsInput } from './seats.schema';
import { emitSeatHeld, emitSeatReleased } from '../ws/ws.publisher';

// =====================================================================
// SeatsService — module feuille (pas de dépendance vers d'autres modules métier)
// Implémente les 4 niveaux de protection zéro double réservation (architecture §5)
// =====================================================================

const HOLD_TTL_MS = 15 * 60 * 1000; // 15 minutes (VH-01 : sélection + paiement — hold unique, pas de split)
const REDIS_LOCK_TTL_PX = 3000; // 3 s — verrou Redis anti-concurrence rapide

// =====================================================================
// Types de retour
// =====================================================================

export type SeatStatusValue = 'AVAILABLE' | 'HELD' | 'HELD_BY_ME' | 'SOLD';

export interface SeatInfo {
  seatDefinitionId: string;
  code: string;
  category: string;
  row: number | null;
  column: number | null;
  status: SeatStatusValue;
  priceMga: number;
}

export interface SeatMapResult {
  tripInstanceId: string;
  layout: unknown;
  seats: SeatInfo[];
}

export interface HoldSeatItem {
  seatDefinitionId: string;
  code: string;
  priceMga: number;
}

export interface HoldResult {
  holdId: string;
  tripInstanceId: string;
  seats: HoldSeatItem[];
  expiresAt: Date;
}

// =====================================================================
// Erreurs métier
// =====================================================================

export class SeatConflictError extends Error {
  public readonly conflictingSeats: { seatDefinitionId: string; code: string; status: 'HELD' | 'SOLD' }[];

  constructor(
    conflictingSeats: { seatDefinitionId: string; code: string; status: 'HELD' | 'SOLD' }[],
  ) {
    super('SEAT_UNAVAILABLE');
    this.name = 'SeatConflictError';
    (this as NodeJS.ErrnoException).code = 'SEAT_UNAVAILABLE';
    this.conflictingSeats = conflictingSeats;
  }
}

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

// =====================================================================
// Service
// =====================================================================

export class SeatsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
  ) {}

  // ------------------------------------------------------------------
  // GET /trips/:tripInstanceId/seats
  // Cache-Control: no-store — temps réel
  // userId optionnel : si fourni, les propres holds deviennent HELD_BY_ME
  // ------------------------------------------------------------------

  async getSeats(tripInstanceId: string, userId?: string): Promise<SeatMapResult> {
    const trip = await this.db.tripInstance.findUnique({
      where: { id: tripInstanceId },
      include: {
        vehicle: {
          include: {
            seatMap: {
              include: { seats: true },
            },
          },
        },
        fares: true,
        bookingSeats: { where: { isActive: true }, select: { seatDefinitionId: true } },
        seatHolds: {
          where: { expiresAt: { gt: new Date() } },
          select: { seatDefinitionId: true, heldByUserId: true },
        },
      },
    });

    if (!trip) {
      throw new NotFoundError('Trajet introuvable');
    }

    const seatMap = trip.vehicle.seatMap;

    // Ensembles pour la résolution de statut
    const soldSet = new Set(trip.bookingSeats.map((bs) => bs.seatDefinitionId));

    // Map seatDefinitionId → holderId (userId ou null pour walk-in staff)
    const holdMap = new Map<string, string | null>();
    for (const hold of trip.seatHolds) {
      holdMap.set(hold.seatDefinitionId, hold.heldByUserId);
    }

    // Résolution des tarifs : siège précis prime sur catégorie
    const fareByDefId = new Map<string, number>();
    const fareByCat = new Map<string, number>();
    for (const fare of trip.fares) {
      if (fare.seatDefinitionId) {
        fareByDefId.set(fare.seatDefinitionId, fare.priceMga);
      } else if (fare.category) {
        fareByCat.set(fare.category, fare.priceMga);
      }
    }

    const seats: SeatInfo[] = seatMap.seats.map((seat) => {
      let status: SeatStatusValue = 'AVAILABLE';

      if (soldSet.has(seat.id)) {
        status = 'SOLD';
      } else if (holdMap.has(seat.id)) {
        const holderId = holdMap.get(seat.id);
        status = userId && holderId === userId ? 'HELD_BY_ME' : 'HELD';
      }

      return {
        seatDefinitionId: seat.id,
        code: seat.code,
        category: seat.category,
        row: seat.row ?? null,
        column: seat.column ?? null,
        status,
        priceMga: fareByDefId.get(seat.id) ?? fareByCat.get(seat.category) ?? 0,
      };
    });

    return {
      tripInstanceId,
      layout: seatMap.layout,
      seats,
    };
  }

  // ------------------------------------------------------------------
  // POST /trips/:tripInstanceId/seats/hold
  // 4 niveaux de protection (architecture §5) :
  //   1. Verrou Redis NX PX 3000 par siège
  //   2. Transaction PG + SELECT … FOR UPDATE par siège
  //   3. Vérification BookingSeat actif
  //   4. Vérification SeatHold non expiré
  // ------------------------------------------------------------------

  async holdSeats(
    tripInstanceId: string,
    userId: string,
    input: HoldSeatsInput,
  ): Promise<HoldResult> {
    const { seatDefinitionIds } = input;

    // Vérification préalable du trajet + récupération des sièges/tarifs
    const [trip, seatDefs] = await Promise.all([
      this.db.tripInstance.findUnique({
        where: { id: tripInstanceId },
        include: {
          fares: true,
          // C-3 : inclure seatMapId du véhicule pour valider que les sièges appartiennent au bon plan
          vehicle: { select: { seatMapId: true } },
        },
      }),
      this.db.seatDefinition.findMany({
        where: { id: { in: seatDefinitionIds } },
        // C-3 : inclure seatMapId pour vérifier l'appartenance au véhicule du trajet
        select: { id: true, code: true, category: true, seatMapId: true },
      }),
    ]);

    if (!trip) {
      throw new NotFoundError('Trajet introuvable');
    }

    if (seatDefs.length !== seatDefinitionIds.length) {
      throw new NotFoundError('Un ou plusieurs sièges introuvables');
    }

    // C-3 : rejeter les statuts non disponibles à la réservation
    const BOOKABLE_STATUSES: string[] = ['OPEN_FOR_BOOKING', 'BOARDING'];
    if (!BOOKABLE_STATUSES.includes(trip.status)) {
      throw new ForbiddenError(
        `Réservation impossible : le trajet est en statut "${trip.status}" (attendu: OPEN_FOR_BOOKING ou BOARDING)`,
      );
    }

    // C-3 : vérifier que tous les sièges demandés appartiennent au seatMap du véhicule du trajet
    const vehicleSeatMapId = trip.vehicle?.seatMapId;
    if (vehicleSeatMapId) {
      const wrongSeats = seatDefs.filter((s) => s.seatMapId !== vehicleSeatMapId);
      if (wrongSeats.length > 0) {
        throw new ForbiddenError(
          `Siège(s) n'appartenant pas au véhicule du trajet : ${wrongSeats.map((s) => s.code).join(', ')}`,
        );
      }
    }

    const seatCodeMap = new Map(seatDefs.map((s) => [s.id, s.code]));
    const seatCategoryMap = new Map(seatDefs.map((s) => [s.id, s.category]));

    // Résolution des tarifs
    const fareByDefId = new Map<string, number>();
    const fareByCat = new Map<string, number>();
    for (const fare of trip.fares) {
      if (fare.seatDefinitionId) {
        fareByDefId.set(fare.seatDefinitionId, fare.priceMga);
      } else if (fare.category) {
        fareByCat.set(fare.category, fare.priceMga);
      }
    }

    const acquiredLocks: string[] = [];
    const expiresAt = new Date(Date.now() + HOLD_TTL_MS);

    try {
      // ------- Niveau 1 : verrous Redis (rejet rapide) -------
      for (const seatId of seatDefinitionIds) {
        const lockKey = `lock:seat:${tripInstanceId}:${seatId}`;
        const result = await this.redis.set(lockKey, '1', 'PX', REDIS_LOCK_TTL_PX, 'NX');
        if (result === null) {
          // Siège verrouillé par une autre requête concurrente → conflit
          throw new SeatConflictError([
            {
              seatDefinitionId: seatId,
              code: seatCodeMap.get(seatId) ?? seatId,
              status: 'HELD',
            },
          ]);
        }
        acquiredLocks.push(lockKey);
      }

      // ------- Niveaux 2-4 : transaction PostgreSQL -------
      const holdIds = seatDefinitionIds.map(() => crypto.randomUUID());

      await this.db.$transaction(async (tx) => {
        // Niveau 2 : SELECT … FOR UPDATE sur chaque SeatDefinition
        for (const seatId of seatDefinitionIds) {
          await tx.$queryRaw`
            SELECT id FROM "SeatDefinition"
            WHERE id = ${seatId}::uuid
            FOR UPDATE
          `;
        }

        // Niveau 3 : vérifier l'absence de BookingSeat actif
        const activeBookingSeats = await tx.bookingSeat.findMany({
          where: {
            tripInstanceId,
            seatDefinitionId: { in: seatDefinitionIds },
            isActive: true,
          },
          select: { seatDefinitionId: true, seatCode: true },
        });

        // Niveau 4 : vérifier l'absence de SeatHold non expiré
        const activeHolds = await tx.seatHold.findMany({
          where: {
            tripInstanceId,
            seatDefinitionId: { in: seatDefinitionIds },
            expiresAt: { gt: new Date() },
          },
          select: { seatDefinitionId: true },
        });

        const conflicting: { seatDefinitionId: string; code: string; status: 'HELD' | 'SOLD' }[] = [
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
          throw new SeatConflictError(conflicting);
        }

        // Niveau 5 : INSERT des SeatHolds
        for (let i = 0; i < seatDefinitionIds.length; i++) {
          await tx.seatHold.create({
            data: {
              id: holdIds[i],
              tripInstanceId,
              seatDefinitionId: seatDefinitionIds[i],
              heldByUserId: userId,
              channel: BookingChannel.ONLINE,
              expiresAt,
            },
          });
        }
      });

      // ------- Pub/Sub Redis : diffusion SEAT_HELD (une émission par siège) -------
      for (const seatId of seatDefinitionIds) {
        await emitSeatHeld({
          tripInstanceId,
          seatDefinitionId: seatId,
          expiresAt,
        });
      }

      // Réponse
      const seats: HoldSeatItem[] = seatDefinitionIds.map((seatId) => {
        const category = seatCategoryMap.get(seatId);
        return {
          seatDefinitionId: seatId,
          code: seatCodeMap.get(seatId) ?? seatId,
          priceMga: fareByDefId.get(seatId) ?? (category ? fareByCat.get(category) ?? 0 : 0),
        };
      });

      return {
        holdId: holdIds[0], // ID du premier hold = identifiant de groupe (voir hypothèses)
        tripInstanceId,
        seats,
        expiresAt,
      };
    } finally {
      // Toujours libérer les verrous Redis (idempotent)
      await this._releaseLocks(acquiredLocks);
    }
  }

  // ------------------------------------------------------------------
  // DELETE /trips/:tripInstanceId/seats/hold/:holdId
  // Libération explicite — supprime tous les holds actifs du groupe (user+trip)
  // ------------------------------------------------------------------

  async releaseHold(
    tripInstanceId: string,
    holdId: string,
    userId: string,
  ): Promise<void> {
    // Vérifier que le hold principal appartient à cet utilisateur
    const hold = await this.db.seatHold.findFirst({
      where: {
        id: holdId,
        tripInstanceId,
        heldByUserId: userId,
      },
    });

    if (!hold) {
      throw new NotFoundError('Hold introuvable ou non autorisé');
    }

    // Trouver tous les holds non expirés de ce groupe (user+trip, non liés à un booking)
    const groupHolds = await this.db.seatHold.findMany({
      where: {
        tripInstanceId,
        heldByUserId: userId,
        expiresAt: { gt: new Date() },
        bookingId: null,
      },
      select: { id: true, seatDefinitionId: true },
    });

    const seatDefinitionIds = groupHolds.map((h) => h.seatDefinitionId);

    if (groupHolds.length > 0) {
      await this.db.seatHold.deleteMany({
        where: { id: { in: groupHolds.map((h) => h.id) } },
      });
    }

    // Pub/Sub : diffusion SEAT_RELEASED (une émission par siège, format ws.publisher)
    for (const seatId of seatDefinitionIds) {
      await emitSeatReleased({ tripInstanceId, seatDefinitionId: seatId });
    }
  }

  // ------------------------------------------------------------------
  // Helpers privés
  // ------------------------------------------------------------------

  private async _releaseLocks(lockKeys: string[]): Promise<void> {
    if (lockKeys.length === 0) return;
    try {
      await this.redis.del(...(lockKeys as [string, ...string[]]));
    } catch {
      // Perte de connexion Redis lors de la libération — toléré (TTL = 3 s)
    }
  }
}
