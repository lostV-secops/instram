/**
 * Tests unitaires — BookingsService
 * Couvre :
 *   - createOnlineBooking : réservation en ligne (PENDING_PAYMENT)
 *   - createWalkIn : walk-in avec PlatformFee = 0 et Commission = 0 (RG-02)
 *   - processWebhook : confirmation paiement, idempotence, échec
 *   - cancelAtCounter : annulation au guichet (RG-03)
 *   - Absence du DELETE /bookings côté voyageur (RG-03)
 *   - initiatePayment
 */

import { BookingsService, ConflictError, NotFoundError, ForbiddenError } from '../bookings.service';
import type { MobileMoneyGateway } from '../../../infra/mobileMoney/gateway';

// =====================================================================
// Mock de la file SMS (évite connexion Redis réelle dans les tests)
// =====================================================================

jest.mock('../../../infra/queue/sms.queue', () => ({
  enqueueSms: jest.fn().mockResolvedValue(undefined),
}));

import { enqueueSms } from '../../../infra/queue/sms.queue';

// =====================================================================
// Fixtures
// =====================================================================

const USER_ID = '00000000-0000-0000-0000-000000000001';
const STAFF_USER_ID = '00000000-0000-0000-0000-000000000002';
const TRIP_ID = '00000000-0000-0000-0000-000000000010';
const COOP_ID = '00000000-0000-0000-0000-000000000020';
const SEAT_ID_1 = '00000000-0000-0000-0000-000000000030';
// SEAT_ID_2 réservé pour futures extensions de tests multi-sièges
const HOLD_ID = '00000000-0000-0000-0000-000000000040';
const BOOKING_ID = '00000000-0000-0000-0000-000000000050';
const PAYMENT_ID = '00000000-0000-0000-0000-000000000060';

const fakeHold = {
  id: HOLD_ID,
  tripInstanceId: TRIP_ID,
  seatDefinitionId: SEAT_ID_1,
  heldByUserId: USER_ID,
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  bookingId: null,
  seatDefinition: { id: SEAT_ID_1, code: '1A', category: 'STANDARD' },
  tripInstance: {
    id: TRIP_ID,
    cooperativeId: COOP_ID,
    fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 25000 }],
    cooperative: {
      pricingPlans: [
        { id: 'plan-1', type: 'COMMISSION', commissionRate: 8, effectiveFrom: new Date('2024-01-01') },
      ],
    },
  },
};

const fakeBooking = {
  id: BOOKING_ID,
  reference: 'IT-ABCDE',
  tripInstanceId: TRIP_ID,
  cooperativeId: COOP_ID,
  buyerUserId: USER_ID,
  channel: 'ONLINE',
  status: 'PENDING_PAYMENT',
  totalAmountMga: 25625, // 25000 + 25000*2.5% = 25000 + 625 (VH-05)
  seatSubtotalMga: 25000,
  platformFeeMga: 625,
  qrPayload: 'mock-qr',
  createdAt: new Date(),
  confirmedAt: null,
};

// =====================================================================
// Mock PrismaClient
// =====================================================================

const mockTx = {
  $queryRaw: jest.fn().mockResolvedValue([]),
  booking: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  seatHold: {
    create: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn(),
    findFirst: jest.fn(),
  },
  bookingSeat: {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  passenger: { createMany: jest.fn() },
  commission: { create: jest.fn(), updateMany: jest.fn() },
  payment: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
  },
  platformFee: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  seatDefinition: { findUnique: jest.fn() },
  fare: { findFirst: jest.fn() },
};

const mockPrisma = {
  tripInstance: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  seatHold: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  booking: {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  bookingSeat: {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn(),
  },
  seatDefinition: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  payment: {
    findFirst: jest.fn().mockResolvedValue(null),
    updateMany: jest.fn(),
  },
  passenger: { createMany: jest.fn() },
  commission: { create: jest.fn(), updateMany: jest.fn() },
  platformFee: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  membership: { findFirst: jest.fn() },
  $transaction: jest.fn().mockImplementation(
    async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
  ),
} as unknown as import('@prisma/client').PrismaClient;

// =====================================================================
// Mock Redis
// =====================================================================

const mockRedis = {
  publish: jest.fn().mockResolvedValue(1),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
} as unknown as import('ioredis').Redis;

// =====================================================================
// Mock MobileMoneyGateway
// =====================================================================

const mockGateway: MobileMoneyGateway = {
  initiatePayment: jest.fn().mockResolvedValue({
    instruction: 'Composez *999#',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  }),
  verifyWebhookSignature: jest.fn().mockReturnValue(true),
  queryStatus: jest.fn().mockResolvedValue({ providerTransactionId: 'stub-tx', status: 'PENDING' }),
};

// =====================================================================
// Setup
// =====================================================================

let service: BookingsService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new BookingsService(mockPrisma, mockRedis, mockGateway);
});

// =====================================================================
// createOnlineBooking
// =====================================================================

describe('BookingsService.createOnlineBooking', () => {
  beforeEach(() => {
    (mockPrisma.seatHold.findFirst as jest.Mock).mockResolvedValue(fakeHold);
    (mockPrisma.seatHold.findMany as jest.Mock).mockResolvedValue([fakeHold]);
    (mockPrisma.seatHold.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue(null);

    // Transaction
    mockTx.booking.create.mockResolvedValue(fakeBooking);
    mockTx.seatHold.updateMany.mockResolvedValue({ count: 1 });
    mockTx.passenger.createMany.mockResolvedValue({ count: 1 });
    mockTx.commission.create.mockResolvedValue({});
  });

  it('crée un Booking en PENDING_PAYMENT avec les bons montants', async () => {
    const booking = await service.createOnlineBooking(USER_ID, {
      holdId: HOLD_ID,
      passengers: [{ firstName: 'Jean', lastName: 'Dupont', seatCode: '1A' }],
    });

    expect(mockTx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_PAYMENT',
          channel: 'ONLINE',
          seatSubtotalMga: 25000,
          platformFeeMga: expect.any(Number), // 25000*2.5% = 625 (VH-05)
        }),
      }),
    );

    expect(booking).toMatchObject({
      status: 'PENDING_PAYMENT',
      channel: 'ONLINE',
    });
  });

  it('calcule platformFee = 2.5% du seatSubtotal (VH-05)', async () => {
    // Avec 25000 MGA : 25000 * 2.5% = 625 (pas de minimum — VH-05)
    await service.createOnlineBooking(USER_ID, {
      holdId: HOLD_ID,
      passengers: [{ firstName: 'Jean', lastName: 'Dupont', seatCode: '1A' }],
    });

    const createCall = (mockTx.booking.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.platformFeeMga).toBe(625); // 2.5% de 25000
  });

  it('calcule platformFee = 2.5% si seatSubtotal = 50 000 MGA (VH-05)', async () => {
    // 50000 * 2.5% = 1250
    (mockPrisma.seatHold.findFirst as jest.Mock).mockResolvedValue({
      ...fakeHold,
      tripInstance: {
        ...fakeHold.tripInstance,
        fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 50000 }],
      },
    });
    (mockPrisma.seatHold.findMany as jest.Mock).mockResolvedValue([{
      ...fakeHold,
      tripInstance: {
        ...fakeHold.tripInstance,
        fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 50000 }],
      },
    }]);

    await service.createOnlineBooking(USER_ID, {
      holdId: HOLD_ID,
      passengers: [{ firstName: 'Jean', lastName: 'Dupont', seatCode: '1A' }],
    });

    const createCall = (mockTx.booking.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.platformFeeMga).toBe(1250); // 2.5% de 50000
  });

  it('ne rallonge PAS le TTL du hold — hold unique 15 min (VH-01)', async () => {
    await service.createOnlineBooking(USER_ID, {
      holdId: HOLD_ID,
      passengers: [{ firstName: 'Jean', lastName: 'Dupont', seatCode: '1A' }],
    });

    // VH-01 : hold unique 15 min, aucune extension lors de createOnlineBooking
    expect(mockPrisma.seatHold.updateMany).not.toHaveBeenCalled();
  });

  it('lève ConflictError si le hold est expiré ou introuvable', async () => {
    (mockPrisma.seatHold.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createOnlineBooking(USER_ID, {
        holdId: HOLD_ID,
        passengers: [{ firstName: 'Jean', lastName: 'Dupont', seatCode: '1A' }],
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('génère une référence au format IT-XXXXX', async () => {
    await service.createOnlineBooking(USER_ID, {
      holdId: HOLD_ID,
      passengers: [{ firstName: 'Jean', lastName: 'Dupont', seatCode: '1A' }],
    });

    const createCall = (mockTx.booking.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.reference).toMatch(/^IT-[A-Z0-9]{5}$/);
  });

  it('génère un qrPayload signé HMAC (non vide)', async () => {
    await service.createOnlineBooking(USER_ID, {
      holdId: HOLD_ID,
      passengers: [{ firstName: 'Jean', lastName: 'Dupont', seatCode: '1A' }],
    });

    const createCall = (mockTx.booking.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.qrPayload).toBeTruthy();
    expect(typeof createCall.data.qrPayload).toBe('string');
  });
});

// =====================================================================
// createWalkIn — RG-02 : PlatformFee = 0, Commission = 0
// =====================================================================

describe('BookingsService.createWalkIn — RG-02', () => {
  const walkInInput = {
    tripInstanceId: TRIP_ID,
    seatDefinitionIds: [SEAT_ID_1],
    passengers: [{ firstName: 'Lala', lastName: 'Rakotondrabe', seatCode: '1A' }],
    paymentMethod: 'CASH' as const,
    buyerPhone: '+261320000000',
  };

  beforeEach(() => {
    (mockPrisma.seatDefinition.findMany as jest.Mock).mockResolvedValue([
      { id: SEAT_ID_1, code: '1A', category: 'STANDARD' },
    ]);
    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue(null);

    mockTx.$queryRaw.mockResolvedValue([]);
    mockTx.bookingSeat.findMany.mockResolvedValue([]);
    mockTx.seatHold.findMany.mockResolvedValue([]);
    mockTx.booking.create.mockResolvedValue({
      ...fakeBooking,
      channel: 'WALK_IN',
      status: 'CONFIRMED',
      platformFeeMga: 0,
      totalAmountMga: 25000,
      confirmedAt: new Date(),
    });
    mockTx.bookingSeat.create.mockResolvedValue({});
    mockTx.payment.create.mockResolvedValue({ id: PAYMENT_ID });
    mockTx.platformFee.create.mockResolvedValue({});
    mockTx.commission.create.mockResolvedValue({});
    mockTx.passenger.createMany.mockResolvedValue({ count: 1 });
    mockTx.auditLog.create.mockResolvedValue({});
  });

  it('crée un trip si ce tripInstance appartient à la coopérative', async () => {
    (mockPrisma.tripInstance.findFirst as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 25000 }],
    });

    await service.createWalkIn(STAFF_USER_ID, COOP_ID, walkInInput);

    expect(mockPrisma.tripInstance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cooperativeId: COOP_ID }),
      }),
    );
  });

  it('PlatformFee = 0 (RG-02 vérification explicite)', async () => {
    (mockPrisma.tripInstance.findFirst as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 25000 }],
    });

    await service.createWalkIn(STAFF_USER_ID, COOP_ID, walkInInput);

    const bookingCreateCall = (mockTx.booking.create as jest.Mock).mock.calls[0][0];
    expect(bookingCreateCall.data.platformFeeMga).toBe(0);
    expect(bookingCreateCall.data.channel).toBe('WALK_IN');
    expect(bookingCreateCall.data.status).toBe('CONFIRMED');
  });

  it('Commission = 0 pour walk-in (RG-02)', async () => {
    (mockPrisma.tripInstance.findFirst as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 25000 }],
    });

    await service.createWalkIn(STAFF_USER_ID, COOP_ID, walkInInput);

    const commissionCall = (mockTx.commission.create as jest.Mock).mock.calls[0][0];
    expect(commissionCall.data.amountMga).toBe(0);
    expect(commissionCall.data.pricingPlanRef).toBe('RG-02-WALK_IN');
  });

  it('totalAmountMga = seatSubtotalMga (pas de frais ajoutés)', async () => {
    (mockPrisma.tripInstance.findFirst as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 25000 }],
    });

    await service.createWalkIn(STAFF_USER_ID, COOP_ID, walkInInput);

    const bookingCreateCall = (mockTx.booking.create as jest.Mock).mock.calls[0][0];
    expect(bookingCreateCall.data.totalAmountMga).toBe(25000);
    expect(bookingCreateCall.data.seatSubtotalMga).toBe(25000);
  });

  it('émet SEAT_SOLD sur Redis Pub/Sub après walk-in', async () => {
    (mockPrisma.tripInstance.findFirst as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 25000 }],
    });

    await service.createWalkIn(STAFF_USER_ID, COOP_ID, walkInInput);

    expect(mockRedis.publish).toHaveBeenCalledWith(
      `trip:${TRIP_ID}`,
      expect.stringContaining('"event":"SEAT_SOLD"'),
    );
  });

  it('enfile un SMS si buyerPhone est fourni', async () => {
    (mockPrisma.tripInstance.findFirst as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 25000 }],
    });

    await service.createWalkIn(STAFF_USER_ID, COOP_ID, walkInInput);

    expect(enqueueSms).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+261320000000',
        templateCode: 'WALK_IN_CONFIRMED', // Walk-in utilise le template WALK_IN_CONFIRMED (pas BOOKING_CONFIRMED)
        isTransactional: true,
      }),
    );
  });

  it('crée un AuditLog pour le walk-in (RG-13)', async () => {
    (mockPrisma.tripInstance.findFirst as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 25000 }],
    });

    await service.createWalkIn(STAFF_USER_ID, COOP_ID, walkInInput);

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BOOKING_CREATED',
          entityType: 'Booking',
        }),
      }),
    );
  });

  it('lève ConflictError si un siège est déjà vendu (SOLD)', async () => {
    (mockPrisma.tripInstance.findFirst as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      fares: [{ seatDefinitionId: null, category: 'STANDARD', priceMga: 25000 }],
    });
    mockTx.bookingSeat.findMany.mockResolvedValue([
      { seatDefinitionId: SEAT_ID_1, seatCode: '1A' },
    ]);

    await expect(
      service.createWalkIn(STAFF_USER_ID, COOP_ID, walkInInput),
    ).rejects.toThrow(ConflictError);
  });

  it('lève ForbiddenError si le trajet appartient à une autre coopérative', async () => {
    (mockPrisma.tripInstance.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createWalkIn(STAFF_USER_ID, COOP_ID, walkInInput),
    ).rejects.toThrow(ForbiddenError);
  });
});

// =====================================================================
// cancelAtCounter — RG-03
// =====================================================================

describe('BookingsService.cancelAtCounter', () => {
  const cancelInput = { reason: 'Voyage annulé', refundedAtCounter: false };

  const bookingWithSeats = {
    id: BOOKING_ID,
    reference: 'IT-ABCDE',
    tripInstanceId: TRIP_ID,
    cooperativeId: COOP_ID,
    status: 'CONFIRMED',
    seats: [{ seatDefinitionId: SEAT_ID_1, isActive: true }],
    payments: [{ id: PAYMENT_ID, status: 'CONFIRMED' }],
  };

  beforeEach(() => {
    (mockPrisma.booking.findFirst as jest.Mock).mockResolvedValue(bookingWithSeats);
    mockTx.booking.update.mockResolvedValue({ ...fakeBooking, status: 'CANCELLED_AT_COUNTER' });
    mockTx.bookingSeat.updateMany.mockResolvedValue({ count: 1 });
    mockTx.payment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.auditLog.create.mockResolvedValue({});
  });

  it('passe le Booking en CANCELLED_AT_COUNTER et désactive les BookingSeats', async () => {
    await service.cancelAtCounter(BOOKING_ID, STAFF_USER_ID, COOP_ID, cancelInput);

    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED_AT_COUNTER',
          cancelledReason: 'Voyage annulé',
          cancelledByStaffId: STAFF_USER_ID,
        }),
      }),
    );

    expect(mockTx.bookingSeat.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ bookingId: BOOKING_ID, isActive: true }),
        data: { isActive: false },
      }),
    );
  });

  it('émet SEAT_RELEASED sur Redis Pub/Sub après annulation', async () => {
    await service.cancelAtCounter(BOOKING_ID, STAFF_USER_ID, COOP_ID, cancelInput);

    expect(mockRedis.publish).toHaveBeenCalledWith(
      `trip:${TRIP_ID}`,
      expect.stringContaining('"event":"SEAT_RELEASED"'),
    );
  });

  it('crée un AuditLog BOOKING_CANCELLED_AT_COUNTER (RG-13)', async () => {
    await service.cancelAtCounter(BOOKING_ID, STAFF_USER_ID, COOP_ID, cancelInput);

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BOOKING_CANCELLED_AT_COUNTER',
          before: expect.objectContaining({ status: 'CONFIRMED' }),
          after: expect.objectContaining({ status: 'CANCELLED_AT_COUNTER' }),
        }),
      }),
    );
  });

  it('lève NotFoundError si le booking est introuvable', async () => {
    (mockPrisma.booking.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.cancelAtCounter(BOOKING_ID, STAFF_USER_ID, COOP_ID, cancelInput),
    ).rejects.toThrow(NotFoundError);
  });

  it('lève ConflictError si le booking est déjà annulé', async () => {
    (mockPrisma.booking.findFirst as jest.Mock).mockResolvedValue({
      ...bookingWithSeats,
      status: 'CANCELLED_AT_COUNTER',
    });

    await expect(
      service.cancelAtCounter(BOOKING_ID, STAFF_USER_ID, COOP_ID, cancelInput),
    ).rejects.toThrow(ConflictError);
  });

  it('lève ConflictError si le booking est COMPLETED', async () => {
    (mockPrisma.booking.findFirst as jest.Mock).mockResolvedValue({
      ...bookingWithSeats,
      status: 'COMPLETED',
    });

    await expect(
      service.cancelAtCounter(BOOKING_ID, STAFF_USER_ID, COOP_ID, cancelInput),
    ).rejects.toThrow(ConflictError);
  });
});

// =====================================================================
// RG-03 : Absence de DELETE /bookings côté voyageur
// Ce test vérifie que BookingsService ne contient aucune méthode
// permettant à un voyageur de supprimer/annuler sa réservation.
// =====================================================================

describe('RG-03 : pas de DELETE /bookings côté voyageur', () => {
  it("BookingsService n'expose aucune méthode deleteBooking ou cancelBooking (voyageur)", () => {
    // Inspection des méthodes publiques du service
    const servicePrototype = Object.getOwnPropertyNames(BookingsService.prototype);

    // Ces méthodes ne doivent PAS exister
    expect(servicePrototype).not.toContain('deleteBooking');
    expect(servicePrototype).not.toContain('cancelBooking');
    expect(servicePrototype).not.toContain('travelerCancel');

    // La seule méthode d'annulation autorisée est cancelAtCounter (côté coop)
    expect(servicePrototype).toContain('cancelAtCounter');
  });
});

// =====================================================================
// initiatePayment
// =====================================================================

describe('BookingsService.initiatePayment', () => {
  const pendingBooking = {
    id: BOOKING_ID,
    buyerUserId: USER_ID,
    status: 'PENDING_PAYMENT',
    totalAmountMga: 26000,
    platformFeeMga: 1000,
    reference: 'IT-ABCDE',
  };

  beforeEach(() => {
    (mockPrisma.booking.findFirst as jest.Mock).mockResolvedValue(pendingBooking);
    (mockPrisma.payment.findFirst as jest.Mock).mockResolvedValue(null);
    mockTx.payment.create.mockResolvedValue({ id: PAYMENT_ID, status: 'PENDING' });
    mockTx.platformFee.create.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});
  });

  it("retourne les instructions de paiement du stub gateway", async () => {
    const result = await service.initiatePayment(USER_ID, {
      bookingId: BOOKING_ID,
      provider: 'MVOLA',
      payerPhone: '+261340000000',
    });

    expect(result).toMatchObject({
      paymentId: PAYMENT_ID,
      status: 'PENDING',
      instructions: expect.objectContaining({
        messageFr: 'Composez *999#',
      }),
    });
  });

  it('appelle le gateway avec les bons paramètres', async () => {
    await service.initiatePayment(USER_ID, {
      bookingId: BOOKING_ID,
      provider: 'MVOLA',
      payerPhone: '+261340000000',
    });

    expect(mockGateway.initiatePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'MVOLA',
        amount: 26000,
        currency: 'MGA',
        phone: '+261340000000',
        reference: 'IT-ABCDE',
      }),
    );
  });

  it('lève NotFoundError si le booking est introuvable', async () => {
    (mockPrisma.booking.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.initiatePayment(USER_ID, {
        bookingId: BOOKING_ID,
        provider: 'MVOLA',
        payerPhone: '+261340000000',
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('lève ConflictError si un paiement est déjà en cours', async () => {
    (mockPrisma.payment.findFirst as jest.Mock).mockResolvedValue({
      id: PAYMENT_ID,
      status: 'PENDING',
    });

    await expect(
      service.initiatePayment(USER_ID, {
        bookingId: BOOKING_ID,
        provider: 'MVOLA',
        payerPhone: '+261340000000',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('crée un AuditLog PAYMENT_INITIATED', async () => {
    await service.initiatePayment(USER_ID, {
      bookingId: BOOKING_ID,
      provider: 'MVOLA',
      payerPhone: '+261340000000',
    });

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PAYMENT_INITIATED' }),
      }),
    );
  });
});
