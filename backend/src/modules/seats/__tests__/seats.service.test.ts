/**
 * Tests unitaires — SeatsService
 * Couvre : hold succès, conflit 409, hold expiré ignoré, libération
 * Mocks : PrismaClient, Redis
 */

import { SeatsService, SeatConflictError, NotFoundError } from '../seats.service';

// Mock ws.publisher — seats.service appelle emitSeatHeld/emitSeatReleased
// après la migration Pub/Sub (plus de redis.publish direct dans le service)
jest.mock('../../ws/ws.publisher', () => ({
  emitSeatHeld: jest.fn().mockResolvedValue(undefined),
  emitSeatReleased: jest.fn().mockResolvedValue(undefined),
  emitSeatSold: jest.fn().mockResolvedValue(undefined),
  emitBookingConfirmed: jest.fn().mockResolvedValue(undefined),
}));

import * as wsPublisher from '../../ws/ws.publisher';

// =====================================================================
// Mocks
// =====================================================================

const mockTx = {
  $queryRaw: jest.fn().mockResolvedValue([]),
  bookingSeat: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  seatHold: {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
};

const mockPrisma = {
  tripInstance: {
    findUnique: jest.fn(),
  },
  seatDefinition: {
    findMany: jest.fn(),
  },
  seatHold: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  bookingSeat: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) =>
    fn(mockTx),
  ),
} as unknown as import('@prisma/client').PrismaClient;

const mockRedis = {
  set: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
} as unknown as import('ioredis').Redis;

// =====================================================================
// Fixtures
// =====================================================================

const TRIP_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const SEAT_ID_1 = '00000000-0000-0000-0000-000000000010';
const SEAT_ID_2 = '00000000-0000-0000-0000-000000000011';
const HOLD_ID_1 = '00000000-0000-0000-0000-000000000020';

const fakeSeatDef1 = { id: SEAT_ID_1, code: '1A', category: 'STANDARD', row: 1, column: 1 };
const fakeSeatDef2 = { id: SEAT_ID_2, code: '1B', category: 'STANDARD', row: 1, column: 2 };

const fakeTrip = {
  id: TRIP_ID,
  vehicleId: 'veh-1',
  cooperativeId: 'coop-1',
  vehicle: {
    seatMap: {
      layout: { rows: 5 },
      seats: [fakeSeatDef1, fakeSeatDef2],
    },
  },
  fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 25000 }],
  bookingSeats: [],
  seatHolds: [],
};

// =====================================================================
// Setup / teardown
// =====================================================================

let service: SeatsService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new SeatsService(mockPrisma, mockRedis);
});

// =====================================================================
// getSeats
// =====================================================================

describe('SeatsService.getSeats', () => {
  it('retourne la carte complète des sièges avec statut AVAILABLE', async () => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue(fakeTrip);

    const result = await service.getSeats(TRIP_ID);

    expect(result.tripInstanceId).toBe(TRIP_ID);
    expect(result.seats).toHaveLength(2);
    expect(result.seats[0]).toMatchObject({
      seatDefinitionId: SEAT_ID_1,
      code: '1A',
      status: 'AVAILABLE',
      priceMga: 25000,
    });
  });

  it('marque SOLD un siège avec BookingSeat actif', async () => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      ...fakeTrip,
      bookingSeats: [{ seatDefinitionId: SEAT_ID_1 }],
    });

    const result = await service.getSeats(TRIP_ID);

    const seat = result.seats.find((s) => s.seatDefinitionId === SEAT_ID_1);
    expect(seat?.status).toBe('SOLD');
  });

  it("marque HELD_BY_ME un siège tenu par l'utilisateur courant", async () => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      ...fakeTrip,
      seatHolds: [{ seatDefinitionId: SEAT_ID_1, heldByUserId: USER_ID }],
    });

    const result = await service.getSeats(TRIP_ID, USER_ID);

    const seat = result.seats.find((s) => s.seatDefinitionId === SEAT_ID_1);
    expect(seat?.status).toBe('HELD_BY_ME');
  });

  it('marque HELD un siège tenu par un autre utilisateur', async () => {
    const OTHER_USER = '00000000-0000-0000-0000-000000000099';
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      ...fakeTrip,
      seatHolds: [{ seatDefinitionId: SEAT_ID_1, heldByUserId: OTHER_USER }],
    });

    const result = await service.getSeats(TRIP_ID, USER_ID);

    const seat = result.seats.find((s) => s.seatDefinitionId === SEAT_ID_1);
    expect(seat?.status).toBe('HELD');
  });

  it('lève NotFoundError si le trajet est introuvable', async () => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getSeats(TRIP_ID)).rejects.toThrow(NotFoundError);
  });

  it('ignore les holds expirés (filtre expiresAt > NOW dans la requête)', async () => {
    // La requête Prisma filtre déjà avec expiresAt > new Date().
    // Ici on simule que le résultat retourné est vide (holds expirés non inclus).
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      ...fakeTrip,
      seatHolds: [], // holds expirés exclus par la requête
    });

    const result = await service.getSeats(TRIP_ID, USER_ID);

    const seat = result.seats.find((s) => s.seatDefinitionId === SEAT_ID_1);
    expect(seat?.status).toBe('AVAILABLE');
  });
});

// =====================================================================
// holdSeats — succès
// =====================================================================

describe('SeatsService.holdSeats — succès', () => {
  beforeEach(() => {
    // Trip + seatDefs valides
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 25000 }],
    });
    (mockPrisma.seatDefinition.findMany as jest.Mock).mockResolvedValue([fakeSeatDef1]);
    // Redis : lock acquis
    (mockRedis.set as jest.Mock).mockResolvedValue('OK');
    // Transaction : pas de conflit
    mockTx.bookingSeat.findMany.mockResolvedValue([]);
    mockTx.seatHold.findMany.mockResolvedValue([]);
    mockTx.seatHold.create.mockResolvedValue({});
  });

  it('crée des SeatHolds et retourne un holdId', async () => {
    const result = await service.holdSeats(TRIP_ID, USER_ID, {
      seatDefinitionIds: [SEAT_ID_1],
    });

    expect(result.tripInstanceId).toBe(TRIP_ID);
    expect(result.holdId).toBeTruthy();
    expect(result.seats).toHaveLength(1);
    expect(result.seats[0].code).toBe('1A');
    expect(result.seats[0].priceMga).toBe(25000);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('libère les verrous Redis même en cas de succès (finally)', async () => {
    await service.holdSeats(TRIP_ID, USER_ID, { seatDefinitionIds: [SEAT_ID_1] });

    expect(mockRedis.del).toHaveBeenCalledWith(
      `lock:seat:${TRIP_ID}:${SEAT_ID_1}`,
    );
  });

  it('publie un événement SEAT_HELD via ws.publisher', async () => {
    await service.holdSeats(TRIP_ID, USER_ID, { seatDefinitionIds: [SEAT_ID_1] });

    expect(wsPublisher.emitSeatHeld).toHaveBeenCalledWith(
      expect.objectContaining({
        tripInstanceId: TRIP_ID,
        seatDefinitionId: SEAT_ID_1,
      }),
    );
  });

  it('appelle SELECT FOR UPDATE dans la transaction', async () => {
    await service.holdSeats(TRIP_ID, USER_ID, { seatDefinitionIds: [SEAT_ID_1] });

    expect(mockTx.$queryRaw).toHaveBeenCalled();
  });
});

// =====================================================================
// holdSeats — conflit 409
// =====================================================================

describe('SeatsService.holdSeats — conflits', () => {
  beforeEach(() => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      fares: [],
    });
    (mockPrisma.seatDefinition.findMany as jest.Mock).mockResolvedValue([fakeSeatDef1]);
    (mockRedis.set as jest.Mock).mockResolvedValue('OK');
  });

  it('lève SeatConflictError si un BookingSeat actif existe (SOLD)', async () => {
    mockTx.bookingSeat.findMany.mockResolvedValue([
      { seatDefinitionId: SEAT_ID_1, seatCode: '1A' },
    ]);
    mockTx.seatHold.findMany.mockResolvedValue([]);

    await expect(
      service.holdSeats(TRIP_ID, USER_ID, { seatDefinitionIds: [SEAT_ID_1] }),
    ).rejects.toThrow(SeatConflictError);
  });

  it('lève SeatConflictError si un SeatHold non expiré existe (HELD)', async () => {
    mockTx.bookingSeat.findMany.mockResolvedValue([]);
    mockTx.seatHold.findMany.mockResolvedValue([{ seatDefinitionId: SEAT_ID_1 }]);

    await expect(
      service.holdSeats(TRIP_ID, USER_ID, { seatDefinitionIds: [SEAT_ID_1] }),
    ).rejects.toThrow(SeatConflictError);
  });

  it('lève SeatConflictError si le verrou Redis est pris (conflit concurrent)', async () => {
    // Redis retourne null → lock déjà pris
    (mockRedis.set as jest.Mock).mockResolvedValue(null);

    await expect(
      service.holdSeats(TRIP_ID, USER_ID, { seatDefinitionIds: [SEAT_ID_1] }),
    ).rejects.toThrow(SeatConflictError);
  });

  it('libère les verrous Redis acquis avant le siège conflictuel', async () => {
    // Premier siège OK, deuxième siège → lock Redis échoue
    (mockRedis.set as jest.Mock)
      .mockResolvedValueOnce('OK')    // lock seat 1 → OK
      .mockResolvedValueOnce(null);   // lock seat 2 → déjà pris

    (mockPrisma.seatDefinition.findMany as jest.Mock).mockResolvedValue([
      fakeSeatDef1,
      fakeSeatDef2,
    ]);

    await expect(
      service.holdSeats(TRIP_ID, USER_ID, {
        seatDefinitionIds: [SEAT_ID_1, SEAT_ID_2],
      }),
    ).rejects.toThrow(SeatConflictError);

    // Le lock du premier siège doit être libéré
    expect(mockRedis.del).toHaveBeenCalledWith(
      `lock:seat:${TRIP_ID}:${SEAT_ID_1}`,
    );
  });

  it('lève NotFoundError si le trajet est introuvable', async () => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.holdSeats(TRIP_ID, USER_ID, { seatDefinitionIds: [SEAT_ID_1] }),
    ).rejects.toThrow(NotFoundError);
  });

  it('lève NotFoundError si un seatDefinitionId est inconnu', async () => {
    // findMany retourne moins de sièges que demandé
    (mockPrisma.seatDefinition.findMany as jest.Mock).mockResolvedValue([]);

    await expect(
      service.holdSeats(TRIP_ID, USER_ID, { seatDefinitionIds: [SEAT_ID_1] }),
    ).rejects.toThrow(NotFoundError);
  });

  it('SeatConflictError inclut la liste des sièges conflictuels', async () => {
    mockTx.bookingSeat.findMany.mockResolvedValue([
      { seatDefinitionId: SEAT_ID_1, seatCode: '1A' },
    ]);
    mockTx.seatHold.findMany.mockResolvedValue([]);

    try {
      await service.holdSeats(TRIP_ID, USER_ID, { seatDefinitionIds: [SEAT_ID_1] });
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SeatConflictError);
      const conflict = err as SeatConflictError;
      expect(conflict.conflictingSeats[0].seatDefinitionId).toBe(SEAT_ID_1);
      expect(conflict.conflictingSeats[0].status).toBe('SOLD');
    }
  });
});

// =====================================================================
// releaseHold
// =====================================================================

describe('SeatsService.releaseHold', () => {
  const groupHolds = [
    { id: HOLD_ID_1, seatDefinitionId: SEAT_ID_1 },
    { id: '00000000-0000-0000-0000-000000000021', seatDefinitionId: SEAT_ID_2 },
  ];

  it('supprime tous les holds du groupe et publie SEAT_RELEASED', async () => {
    (mockPrisma.seatHold.findFirst as jest.Mock).mockResolvedValue({
      id: HOLD_ID_1,
      tripInstanceId: TRIP_ID,
      heldByUserId: USER_ID,
    });
    (mockPrisma.seatHold.findMany as jest.Mock).mockResolvedValue(groupHolds);
    (mockPrisma.seatHold.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });

    await service.releaseHold(TRIP_ID, HOLD_ID_1, USER_ID);

    expect(mockPrisma.seatHold.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [HOLD_ID_1, groupHolds[1].id] } },
    });

    expect(wsPublisher.emitSeatReleased).toHaveBeenCalledWith(
      expect.objectContaining({
        tripInstanceId: TRIP_ID,
      }),
    );
  });

  it("lève NotFoundError si le hold n'existe pas ou appartient à quelqu'un d'autre", async () => {
    (mockPrisma.seatHold.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.releaseHold(TRIP_ID, HOLD_ID_1, USER_ID),
    ).rejects.toThrow(NotFoundError);
  });

  it('ne publie pas si aucun hold actif (déjà expiré)', async () => {
    (mockPrisma.seatHold.findFirst as jest.Mock).mockResolvedValue({
      id: HOLD_ID_1,
      tripInstanceId: TRIP_ID,
      heldByUserId: USER_ID,
    });
    // findMany retourne tableau vide (tous les holds sont expirés)
    (mockPrisma.seatHold.findMany as jest.Mock).mockResolvedValue([]);

    await service.releaseHold(TRIP_ID, HOLD_ID_1, USER_ID);

    expect(wsPublisher.emitSeatReleased).not.toHaveBeenCalled();
    expect(mockPrisma.seatHold.deleteMany).not.toHaveBeenCalled();
  });
});
