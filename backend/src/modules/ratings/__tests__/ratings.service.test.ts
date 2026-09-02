/**
 * Tests unitaires — RatingsService
 *
 * Cas couverts :
 *   1. createRating — note créée avec succès (Booking COMPLETED, dans la fenêtre)
 *   2. createRating — doublon 409 ALREADY_RATED (contrainte unique bookingId)
 *   3. createRating — booking non COMPLETED → 403 FORBIDDEN
 *   4. createRating — booking n'appartient pas au userId → 403 FORBIDDEN
 *   5. createRating — fenêtre 30 jours expirée → 400 RATING_WINDOW_EXPIRED
 *   6. createRating — booking introuvable → 404 NOT_FOUND
 *   7. listApprovedRatings — liste publique anonymisée (firstName + 1ère lettre nom)
 *   8. getRatingSummary — distribution correcte (score 1 à 5)
 *   9. moderateRating — publie l'avis et recalcule la moyenne coopérative
 *  10. moderateRating — rejette l'avis et recalcule la moyenne coopérative
 */

import { RatingsService, NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../ratings.service';

// =====================================================================
// Fixtures
// =====================================================================

const USER_ID   = '00000000-0000-0000-0000-000000000001';
const OTHER_ID  = '00000000-0000-0000-0000-000000000002';
const ADMIN_ID  = '00000000-0000-0000-0000-000000000003';
const COOP_ID   = '00000000-0000-0000-0000-000000000020';
const TRIP_ID   = '00000000-0000-0000-0000-000000000010';
const BOOKING_ID = '00000000-0000-0000-0000-000000000050';
const RATING_ID  = '00000000-0000-0000-0000-000000000060';

// Booking COMPLETED dont le voyage était il y a 5 jours (dans la fenêtre)
const makeCompletedBooking = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: BOOKING_ID,
  buyerUserId: USER_ID,
  cooperativeId: COOP_ID,
  status: 'COMPLETED',
  tripInstance: {
    id: TRIP_ID,
    departureAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // il y a 5 j
  },
  ...overrides,
});

// Booking COMPLETED dont le voyage était il y a 35 jours (hors fenêtre)
const makeExpiredBooking = () => ({
  id: BOOKING_ID,
  buyerUserId: USER_ID,
  cooperativeId: COOP_ID,
  status: 'COMPLETED',
  tripInstance: {
    id: TRIP_ID,
    departureAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // il y a 35 j
  },
});

const makeRating = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: RATING_ID,
  bookingId: BOOKING_ID,
  cooperativeId: COOP_ID,
  userId: USER_ID,
  score: 4,
  commentFr: 'Très bien',
  commentMg: null,
  status: 'PENDING_REVIEW',
  moderatedAt: null,
  moderatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// =====================================================================
// Mock PrismaClient
// =====================================================================

function buildMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    booking: {
      findUnique: jest.fn(),
    },
    rating: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      update: jest.fn(),
    },
    cooperative: {
      findUnique: jest.fn().mockResolvedValue({ id: COOP_ID }),
      update: jest.fn().mockResolvedValue({}),
    },
    directoryEntry: {
      update: jest.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

// =====================================================================
// Tests
// =====================================================================

describe('RatingsService', () => {

  // ------------------------------------------------------------------
  // 1. createRating — succès
  // ------------------------------------------------------------------
  it('crée une note avec succès pour un voyage COMPLETED dans la fenêtre', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue(makeCompletedBooking());
    const newRating = makeRating();
    (mockPrisma.rating.create as jest.Mock).mockResolvedValue(newRating);

    const service = new RatingsService(mockPrisma as never);
    const result = await service.createRating(USER_ID, BOOKING_ID, { score: 4, comment: 'Très bien' });

    expect(result).toEqual(newRating);
    expect(mockPrisma.rating.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: BOOKING_ID,
          cooperativeId: COOP_ID,
          userId: USER_ID,
          score: 4,
          commentFr: 'Très bien',
          status: 'PENDING_REVIEW',
        }),
      }),
    );
  });

  // ------------------------------------------------------------------
  // 2. createRating — doublon 409
  // ------------------------------------------------------------------
  it('lève ConflictError si le bookingId est déjà noté (P2002)', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue(makeCompletedBooking());
    const prismaError = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    (mockPrisma.rating.create as jest.Mock).mockRejectedValue(prismaError);

    const service = new RatingsService(mockPrisma as never);

    await expect(
      service.createRating(USER_ID, BOOKING_ID, { score: 4 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // ------------------------------------------------------------------
  // 3. createRating — voyage non COMPLETED
  // ------------------------------------------------------------------
  it('lève ForbiddenError si Booking.status ≠ COMPLETED (RG-11)', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue(
      makeCompletedBooking({ status: 'CONFIRMED' }),
    );

    const service = new RatingsService(mockPrisma as never);

    await expect(
      service.createRating(USER_ID, BOOKING_ID, { score: 3 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ------------------------------------------------------------------
  // 4. createRating — booking n'appartient pas à l'utilisateur
  // ------------------------------------------------------------------
  it('lève ForbiddenError si buyerUserId ≠ userId', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue(
      makeCompletedBooking({ buyerUserId: OTHER_ID }),
    );

    const service = new RatingsService(mockPrisma as never);

    await expect(
      service.createRating(USER_ID, BOOKING_ID, { score: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ------------------------------------------------------------------
  // 5. createRating — fenêtre 30 jours expirée
  // ------------------------------------------------------------------
  it('lève ValidationError si la fenêtre de 30 jours est dépassée', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue(makeExpiredBooking());

    const service = new RatingsService(mockPrisma as never);

    await expect(
      service.createRating(USER_ID, BOOKING_ID, { score: 2 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // ------------------------------------------------------------------
  // 6. createRating — booking introuvable
  // ------------------------------------------------------------------
  it('lève NotFoundError si le booking n\'existe pas', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue(null);

    const service = new RatingsService(mockPrisma as never);

    await expect(
      service.createRating(USER_ID, BOOKING_ID, { score: 3 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // ------------------------------------------------------------------
  // 7. listApprovedRatings — anonymisation partielle
  // ------------------------------------------------------------------
  it('retourne une liste anonymisée (firstName + 1ère lettre de lastName)', async () => {
    const mockPrisma = buildMockPrisma();

    const ratingWithUser = {
      ...makeRating({ status: 'PUBLISHED' }),
      user: {
        travelerProfile: { firstName: 'Jean', lastName: 'Dupont' },
      },
    };

    (mockPrisma.rating.findMany as jest.Mock).mockResolvedValue([ratingWithUser]);

    const service = new RatingsService(mockPrisma as never);
    const result = await service.listApprovedRatings(COOP_ID, { limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.passenger).toEqual({
      firstName: 'Jean',
      firstLetterOfLastName: 'D',
    });
    // Le nom complet ne doit pas apparaître
    const raw = JSON.stringify(result.items[0]!.passenger);
    expect(raw).not.toContain('Dupont');
  });

  it('retourne nextCursor=null quand il n\'y a pas de page suivante', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.rating.findMany as jest.Mock).mockResolvedValue([]);

    const service = new RatingsService(mockPrisma as never);
    const result = await service.listApprovedRatings(COOP_ID, { limit: 20 });

    expect(result.nextCursor).toBeNull();
  });

  // ------------------------------------------------------------------
  // 8. getRatingSummary — distribution
  // ------------------------------------------------------------------
  it('retourne la distribution correcte des notes 1 à 5', async () => {
    const mockPrisma = buildMockPrisma();

    (mockPrisma.rating.aggregate as jest.Mock).mockResolvedValue({
      _avg: { score: 4.2 },
      _count: { score: 5 },
    });

    (mockPrisma.rating.groupBy as jest.Mock).mockResolvedValue([
      { score: 5, _count: { score: 2 } },
      { score: 4, _count: { score: 2 } },
      { score: 3, _count: { score: 1 } },
    ]);

    const service = new RatingsService(mockPrisma as never);
    const summary = await service.getRatingSummary(COOP_ID);

    expect(summary.totalRatings).toBe(5);
    expect(summary.averageScore).toBe(4.2);
    expect(summary.distribution[5]).toBe(2);
    expect(summary.distribution[4]).toBe(2);
    expect(summary.distribution[3]).toBe(1);
    expect(summary.distribution[1]).toBe(0);
    expect(summary.distribution[2]).toBe(0);
  });

  it('lève NotFoundError si la coopérative n\'existe pas', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.cooperative.findUnique as jest.Mock).mockResolvedValue(null);

    const service = new RatingsService(mockPrisma as never);

    await expect(service.getRatingSummary(COOP_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  // ------------------------------------------------------------------
  // 9. moderateRating — publication
  // ------------------------------------------------------------------
  it('publie un avis et met à jour Cooperative.ratingAverage', async () => {
    const mockPrisma = buildMockPrisma();

    const existingRating = makeRating({ status: 'PENDING_REVIEW' });
    (mockPrisma.rating.findUnique as jest.Mock).mockResolvedValue(existingRating);
    const updatedRating = makeRating({ status: 'PUBLISHED', moderatedAt: new Date(), moderatedBy: ADMIN_ID });
    (mockPrisma.rating.update as jest.Mock).mockResolvedValue(updatedRating);

    // Pour refreshCooperativeRating
    (mockPrisma.rating.aggregate as jest.Mock).mockResolvedValue({
      _avg: { score: 4 },
      _count: { score: 3 },
    });

    const service = new RatingsService(mockPrisma as never);
    const result = await service.moderateRating(ADMIN_ID, RATING_ID, { status: 'PUBLISHED' });

    expect(result.status).toBe('PUBLISHED');
    expect(mockPrisma.cooperative.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ratingAverage: 4, ratingCount: 3 }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RATING_MODERATED' }),
      }),
    );
  });

  // ------------------------------------------------------------------
  // 10. moderateRating — rejet
  // ------------------------------------------------------------------
  it('rejette un avis et recalcule la moyenne (exclusion de l\'avis rejeté)', async () => {
    const mockPrisma = buildMockPrisma();

    const existingRating = makeRating({ status: 'PENDING_REVIEW' });
    (mockPrisma.rating.findUnique as jest.Mock).mockResolvedValue(existingRating);
    const updatedRating = makeRating({ status: 'REJECTED', moderatedAt: new Date(), moderatedBy: ADMIN_ID });
    (mockPrisma.rating.update as jest.Mock).mockResolvedValue(updatedRating);

    // Après rejet : 0 notes approuvées
    (mockPrisma.rating.aggregate as jest.Mock).mockResolvedValue({
      _avg: { score: null },
      _count: { score: 0 },
    });

    const service = new RatingsService(mockPrisma as never);
    const result = await service.moderateRating(ADMIN_ID, RATING_ID, { status: 'REJECTED' });

    expect(result.status).toBe('REJECTED');
    // La moyenne doit être recalculée (ici 0 notes → average 0)
    expect(mockPrisma.cooperative.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ratingAverage: 0, ratingCount: 0 }),
      }),
    );
  });
});
