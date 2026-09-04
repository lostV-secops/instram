import type { PrismaClient, Rating } from '@prisma/client';
import { BookingStatus, RatingStatus, AuditAction } from '@prisma/client';
import type {
  CreateRatingInput,
  RatingListQueryInput,
  AdminRatingListQueryInput,
  ModerateRatingInput,
} from './ratings.schema';

// =====================================================================
// RatingsService
// Contrat : docs/contrat-api.yaml §Traveler-Bookings, §Admin
//
// Règles critiques :
//   RG-11 : notation possible uniquement si Booking.status = COMPLETED
//   RG-12 : une note par voyage — contrainte unique Rating.bookingId
//
// Fenêtre de notation : 30 jours après TripInstance.departureAt (architecture §6.7)
//
// Hypothèse ambiguë résolue :
//   - `comment` est stocké dans Rating.commentFr (champ bilingue).
//     En V2, Accept-Language peut router vers commentMg.
//   - La modération PUBLISHED déclenche le recalcul de Cooperative.ratingAverage.
//   - Le cache Redis n'est pas utilisé ici : le champ dénormalisé (ratingAverage,
//     ratingCount) sur Cooperative et DirectoryEntry sert de "cache" DB.
// =====================================================================

const RATING_WINDOW_DAYS = 30;

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
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
    (this as NodeJS.ErrnoException).code = 'CONFLICT';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
    (this as NodeJS.ErrnoException).code = 'VALIDATION_ERROR';
  }
}

// =====================================================================
// DTOs de sortie
// =====================================================================

export interface RatingPublicItem {
  id: string;
  score: number;
  comment: string | null;
  createdAt: Date;
  passenger: {
    firstName: string;
    firstLetterOfLastName: string;
  };
}

export interface RatingListResult {
  items: RatingPublicItem[];
  nextCursor: string | null;
}

export interface RatingSummary {
  averageScore: number;
  totalRatings: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

// =====================================================================
// RatingsService
// =====================================================================

export class RatingsService {
  constructor(private readonly prisma: PrismaClient) {}

  // ------------------------------------------------------------------
  // createRating — POST /bookings/{bookingId}/rating
  // RG-11 : Booking.status doit être COMPLETED
  // RG-12 : une seule note par bookingId (contrainte unique DB)
  // Fenêtre 30 j : TripInstance.departureAt + 30j > maintenant
  // ------------------------------------------------------------------
  async createRating(userId: string, bookingId: string, input: CreateRatingInput): Promise<Rating> {
    // 1. Charger le booking avec le trip
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { tripInstance: true },
    });

    if (!booking) {
      throw new NotFoundError('Réservation introuvable');
    }

    // 2. Vérifier que le userId correspond (RG-11)
    if (booking.buyerUserId !== userId) {
      throw new ForbiddenError('Cette réservation ne vous appartient pas');
    }

    // 3. Vérifier que le voyage est COMPLETED (RG-11)
    if (booking.status !== BookingStatus.COMPLETED) {
      throw new ForbiddenError('Notation impossible : le voyage n\'est pas encore terminé (statut : ' + booking.status + ')');
    }

    // 4. Vérifier la fenêtre de 30 jours (architecture §6.7)
    const departureAt = booking.tripInstance.departureAt;
    const windowEnd = new Date(departureAt.getTime() + RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (new Date() > windowEnd) {
      throw new ValidationError('Fenêtre de notation expirée (30 jours après le départ)');
    }

    // 5. Créer la notation (la contrainte unique sur bookingId est gérée par la DB)
    try {
      const rating = await this.prisma.rating.create({
        data: {
          bookingId,
          cooperativeId: booking.cooperativeId,
          userId,
          score: input.score,
          commentFr: input.comment ?? null,
          status: RatingStatus.PENDING_REVIEW,
        },
      });

      return rating;
    } catch (err) {
      // Prisma P2002 = contrainte unique violée (RG-12)
      const prismaErr = err as { code?: string };
      if (prismaErr.code === 'P2002') {
        throw new ConflictError('Vous avez déjà noté ce voyage');
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // listApprovedRatings — GET /ratings/cooperative/:cooperativeId
  // Public — liste des avis PUBLISHED, anonymisée, paginée
  // ------------------------------------------------------------------
  async listApprovedRatings(
    cooperativeId: string,
    query: RatingListQueryInput,
  ): Promise<RatingListResult> {
    const { limit, cursor } = query;

    // H-5 : exclure les avis des comptes qui ont demandé la suppression/anonymisation.
    // Le filtre passe par la relation directe `user` sur Rating (champ userId).
    // Hypothèse résolue : l'instruction mentionnait `booking.traveler` mais le schema
    // expose la relation `user` directement sur Rating et `buyer` (non `traveler`) sur
    // Booking — on utilise donc `user: { anonymizedAt: null }`, plus direct et exact.
    const ratings = await this.prisma.rating.findMany({
      where: {
        cooperativeId,
        status: RatingStatus.PUBLISHED,
        user: { anonymizedAt: null },
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      include: {
        user: {
          include: { travelerProfile: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // +1 pour détecter la page suivante
    });

    const hasNext = ratings.length > limit;
    const items = (hasNext ? ratings.slice(0, limit) : ratings).map((r) => ({
      id: r.id,
      score: r.score,
      comment: r.commentFr,
      createdAt: r.createdAt,
      // Anonymisation partielle (architecture §règles)
      passenger: {
        firstName: r.user.travelerProfile?.firstName ?? 'Anonyme',
        firstLetterOfLastName: r.user.travelerProfile?.lastName?.[0]?.toUpperCase() ?? '?',
      },
    }));

    return {
      items,
      nextCursor: hasNext ? ratings[limit - 1]!.id : null,
    };
  }

  // ------------------------------------------------------------------
  // getRatingSummary — GET /cooperatives/:cooperativeId/rating-summary
  // Public — moyenne, total, distribution par score
  // ------------------------------------------------------------------
  async getRatingSummary(cooperativeId: string): Promise<RatingSummary> {
    const cooperative = await this.prisma.cooperative.findUnique({
      where: { id: cooperativeId },
      select: { id: true },
    });

    if (!cooperative) {
      throw new NotFoundError('Coopérative introuvable');
    }

    // Agréger les notes PUBLISHED
    const [aggregates, distribution] = await Promise.all([
      this.prisma.rating.aggregate({
        where: { cooperativeId, status: RatingStatus.PUBLISHED },
        _avg: { score: true },
        _count: { score: true },
      }),
      this.prisma.rating.groupBy({
        by: ['score'],
        where: { cooperativeId, status: RatingStatus.PUBLISHED },
        _count: { score: true },
      }),
    ]);

    const dist: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of distribution) {
      const k = row.score as 1 | 2 | 3 | 4 | 5;
      if (k >= 1 && k <= 5) dist[k] = row._count.score;
    }

    return {
      averageScore: Math.round((aggregates._avg.score ?? 0) * 10) / 10,
      totalRatings: aggregates._count.score,
      distribution: dist,
    };
  }

  // ------------------------------------------------------------------
  // listRatingsAdmin — GET /admin/ratings
  // Admin InsTRAM (ADMIN_MODERATOR, ADMIN_OPS, ADMIN_SUPER)
  // ------------------------------------------------------------------
  async listRatingsAdmin(query: AdminRatingListQueryInput): Promise<Rating[]> {
    const { status, cursor, limit } = query;

    return this.prisma.rating.findMany({
      where: {
        ...(status ? { status: status as RatingStatus } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      include: {
        user: { select: { id: true, email: true, phone: true } },
        booking: { select: { reference: true, cooperativeId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ------------------------------------------------------------------
  // moderateRating — PATCH /admin/ratings/{ratingId}
  // Admin InsTRAM — publie ou rejette un avis
  // Après PUBLISHED : recalcul Cooperative.ratingAverage (dénormalisation)
  // ------------------------------------------------------------------
  async moderateRating(
    adminUserId: string,
    ratingId: string,
    input: ModerateRatingInput,
  ): Promise<Rating> {
    const existing = await this.prisma.rating.findUnique({ where: { id: ratingId } });
    if (!existing) throw new NotFoundError('Avis introuvable');

    const updated = await this.prisma.rating.update({
      where: { id: ratingId },
      data: {
        status: input.status as RatingStatus,
        moderatedAt: new Date(),
        moderatedBy: adminUserId,
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: AuditAction.RATING_MODERATED,
        entityType: 'Rating',
        entityId: ratingId,
        before: { status: existing.status },
        after: { status: input.status },
      },
    });

    // Recalcul de la note moyenne si l'avis est publié ou rejeté
    await this.refreshCooperativeRating(existing.cooperativeId);

    return updated;
  }

  // ------------------------------------------------------------------
  // refreshCooperativeRating — recalcule et dénormalise
  // Appelé après modération (PUBLISHED/REJECTED)
  // ------------------------------------------------------------------
  async refreshCooperativeRating(cooperativeId: string): Promise<void> {
    const aggregates = await this.prisma.rating.aggregate({
      where: { cooperativeId, status: RatingStatus.PUBLISHED },
      _avg: { score: true },
      _count: { score: true },
    });

    const avg = Math.round((aggregates._avg.score ?? 0) * 100) / 100;
    const count = aggregates._count.score;

    await this.prisma.cooperative.update({
      where: { id: cooperativeId },
      data: { ratingAverage: avg, ratingCount: count },
    });

    // Mettre à jour le DirectoryEntry si présent
    try {
      await this.prisma.directoryEntry.update({
        where: { cooperativeId },
        data: { ratingAverage: avg, ratingCount: count },
      });
    } catch {
      // DirectoryEntry peut ne pas exister (pas une erreur bloquante)
    }
  }
}
