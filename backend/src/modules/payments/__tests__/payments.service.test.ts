/**
 * Tests unitaires — PaymentsService
 *
 * Cas couverts (conformément aux exigences de la tâche) :
 *   1. initiate booking ONLINE → PlatformFee = max(1000, 3%)
 *   2. initiate booking WALK_IN → PlatformFee = 0, Commission = 0
 *   3. handleWebhook succès → Booking CONFIRMED, SEAT_SOLD émis, SMS enfilé
 *   4. handleWebhook signature invalide → lève WebhookSignatureError (401)
 *   5. handleWebhook idempotence (2× même providerTransactionId CONFIRMED) → 1 seul traitement
 *   6. handleWebhook échec paiement → Booking PAYMENT_FAILED, SEAT_RELEASED émis
 *   7. reconcilePending → appelle queryStatus sur les PENDING > 5 min
 */

import {
  PaymentsService,
  WebhookSignatureError,
  NotFoundError,
  ConflictError,
} from '../payments.service';
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

const USER_ID        = '00000000-0000-0000-0000-000000000001';
const TRIP_ID        = '00000000-0000-0000-0000-000000000010';
const COOP_ID        = '00000000-0000-0000-0000-000000000020';
const SEAT_ID_1      = '00000000-0000-0000-0000-000000000030';
const BOOKING_ID     = '00000000-0000-0000-0000-000000000050';
const PAYMENT_ID     = '00000000-0000-0000-0000-000000000060';

// Pricing plan COMMISSION 8%
const planCommission = {
  id: 'plan-comm',
  type: 'COMMISSION' as const,
  commissionRate: 8,
  effectiveFrom: new Date('2024-01-01'),
  effectiveUntil: null,
};

// Pricing plan SUBSCRIPTION
const planSubscription = {
  id: 'plan-sub',
  type: 'SUBSCRIPTION' as const,
  commissionRate: null,
  effectiveFrom: new Date('2024-01-01'),
  effectiveUntil: null,
};

function makeOnlineBooking(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: BOOKING_ID,
    reference: 'IT-ABCDE',
    tripInstanceId: TRIP_ID,
    cooperativeId: COOP_ID,
    buyerUserId: USER_ID,
    channel: 'ONLINE',
    status: 'PENDING_PAYMENT',
    totalAmountMga: 25625, // 25000 siège + 625 frais (25000*2.5% — VH-05)
    seatSubtotalMga: 25000,
    platformFeeMga: 625,
    qrPayload: 'mock-qr',
    createdAt: new Date(),
    confirmedAt: null,
    tripInstance: {
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      cooperative: {
        pricingPlans: [planCommission],
      },
    },
    ...overrides,
  };
}

function makeWalkInBooking(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...makeOnlineBooking(),
    channel: 'WALK_IN',
    platformFeeMga: 0,
    totalAmountMga: 25000,
    ...overrides,
  };
}

function makeBookingWithHolds() {
  return {
    id: BOOKING_ID,
    reference: 'IT-ABCDE',
    tripInstanceId: TRIP_ID,
    cooperativeId: COOP_ID,
    channel: 'ONLINE',
    totalAmountMga: 26000,
    seatHolds: [{ seatDefinitionId: SEAT_ID_1 }],
    payments: [{ id: PAYMENT_ID, amountMga: 26000, status: 'PENDING' }],
  };
}

// =====================================================================
// Mocks PrismaClient
// =====================================================================

function buildMockTx(overrides: Record<string, Record<string, jest.Mock>> = {}) {
  const base: Record<string, Record<string, jest.Mock>> = {
    payment: {
      create: jest.fn().mockResolvedValue({ id: PAYMENT_ID, status: 'PENDING', amountMga: 26000, initiatedAt: new Date() }),
      findFirst: jest.fn().mockResolvedValue({ id: PAYMENT_ID, status: 'PENDING', amountMga: 26000, platformFee: null }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    platformFee: {
      create: jest.fn().mockResolvedValue({}),
    },
    commission: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    booking: {
      update: jest.fn().mockResolvedValue({}),
    },
    seatDefinition: {
      findUnique: jest.fn().mockResolvedValue({ id: SEAT_ID_1, code: '1A', category: 'STANDARD' }),
    },
    bookingSeat: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    fare: {
      findFirst: jest.fn().mockResolvedValue({ priceMga: 25000 }),
    },
    seatHold: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  for (const key of Object.keys(overrides)) {
    base[key] = overrides[key];
  }

  return base;
}

function buildMockDb(overrides: Record<string, unknown> = {}) {
  const mockTx = buildMockTx();

  return {
    booking: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    payment: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    platformFee: {
      create: jest.fn().mockResolvedValue({}),
    },
    commission: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    seatHold: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn(mockTx),
    ),
    ...overrides,
  };
}

// =====================================================================
// Mock Redis
// =====================================================================

function buildMockRedis() {
  return {
    publish: jest.fn().mockResolvedValue(1),
  };
}

// =====================================================================
// Mock Gateway
// =====================================================================

function buildMockGateway(overrides: Partial<MobileMoneyGateway> = {}): MobileMoneyGateway {
  return {
    initiatePayment: jest.fn().mockResolvedValue({
      instruction: 'Composez *999# pour valider',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      providerRef: 'stub-ref-123',
    }),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    queryStatus: jest.fn().mockResolvedValue({ providerTransactionId: 'tx-123', status: 'PENDING' }),
    ...overrides,
  };
}

// =====================================================================
// Helpers
// =====================================================================

function buildService(
  dbOverrides: Record<string, unknown> = {},
  gatewayOverrides: Partial<MobileMoneyGateway> = {},
) {
  const db = buildMockDb(dbOverrides);
  const redis = buildMockRedis();
  const gateway = buildMockGateway(gatewayOverrides);
  const gateways = new Map([
    ['MVOLA', gateway],
    ['ORANGE_MONEY', gateway],
  ]);

  const service = new PaymentsService(
    db as unknown as import('@prisma/client').PrismaClient,
    redis as unknown as import('ioredis').Redis,
    gateways,
  );

  return { service, db, redis, gateway };
}

// =====================================================================
// Tests
// =====================================================================

beforeEach(() => {
  jest.clearAllMocks();
});

// ======================================================================
// 1. initiate — booking ONLINE → PlatformFee = seatSubtotal * 2.5% (VH-05)
// ======================================================================

describe('PaymentsService.initiate', () => {
  it('booking ONLINE avec prix 25 000 MGA → PlatformFee = 625 (2.5% — VH-05)', async () => {
    const onlineBooking = makeOnlineBooking();

    // seatSubtotal * 2.5% = 625 (pas de minimum — VH-05)
    const db = buildMockDb({
      booking: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(onlineBooking)  // premier appel : le booking
          .mockResolvedValueOnce(null),           // deuxième appel : pas de paiement existant
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    // Mock de la transaction pour capturer les données passées à platformFee.create
    let capturedPlatformFee: { amountMga: number; policyRef: string } | null = null;
    const mockTx = buildMockTx({
      platformFee: {
        create: jest.fn().mockImplementation(({ data }: { data: { amountMga: number; policyRef: string } }) => {
          capturedPlatformFee = data;
          return Promise.resolve({});
        }),
      },
    });
    (db.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));

    const redis = buildMockRedis();
    const gateway = buildMockGateway();
    const gateways = new Map([['MVOLA', gateway]]);
    const service = new PaymentsService(
      db as unknown as import('@prisma/client').PrismaClient,
      redis as unknown as import('ioredis').Redis,
      gateways,
    );

    const result = await service.initiate({
      bookingId: BOOKING_ID,
      userId: USER_ID,
      provider: 'MVOLA',
      phone: '+261340000001',
    });

    expect(result.paymentId).toBeDefined();
    expect(result.status).toBe('PENDING');
    expect(result.instructions.messageFr).toContain('*999#');

    // PlatformFee = 25000 * 2.5% = 625 (VH-05 : pas de minimum)
    expect(capturedPlatformFee).not.toBeNull();
    expect(capturedPlatformFee!.amountMga).toBe(625);
    expect(capturedPlatformFee!.policyRef).toBe('VH-05');
  });

  it('booking ONLINE avec prix 50 000 MGA → PlatformFee = 1 250 (2.5% — VH-05)', async () => {
    const onlineBooking = makeOnlineBooking({
      seatSubtotalMga: 50000,
      totalAmountMga: 51250, // 50000 + 1250 (50000*2.5%)
      platformFeeMga: 1250,
    });

    const db = buildMockDb({
      booking: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(onlineBooking)
          .mockResolvedValueOnce(null),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    let capturedPlatformFee: { amountMga: number } | null = null;
    const mockTx = buildMockTx({
      platformFee: {
        create: jest.fn().mockImplementation(({ data }: { data: { amountMga: number } }) => {
          capturedPlatformFee = data;
          return Promise.resolve({});
        }),
      },
    });
    (db.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));

    const service = new PaymentsService(
      db as unknown as import('@prisma/client').PrismaClient,
      buildMockRedis() as unknown as import('ioredis').Redis,
      new Map([['MVOLA', buildMockGateway()]]),
    );

    await service.initiate({
      bookingId: BOOKING_ID,
      userId: USER_ID,
      provider: 'MVOLA',
      phone: '+261340000001',
    });

    // 50000 * 2.5% = 1250 (VH-05)
    expect(capturedPlatformFee!.amountMga).toBe(1250);
  });

  it('booking WALK_IN → PlatformFee = 0 et Commission = 0 (RG-02)', async () => {
    // Hypothèse H2 : un booking WALK_IN en PENDING_PAYMENT est théoriquement impossible
    // (createWalkIn crée directement CONFIRMED), mais la double vérification doit tenir.
    const walkInBooking = makeWalkInBooking({
      status: 'PENDING_PAYMENT', // état hypothétique pour tester la règle RG-02
    });

    const db = buildMockDb({
      booking: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(walkInBooking)
          .mockResolvedValueOnce(null),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    let capturedPlatformFee: { amountMga: number; policyRef: string } | null = null;
    const mockTx = buildMockTx({
      platformFee: {
        create: jest.fn().mockImplementation(({ data }: { data: { amountMga: number; policyRef: string } }) => {
          capturedPlatformFee = data;
          return Promise.resolve({});
        }),
      },
    });
    (db.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));

    const service = new PaymentsService(
      db as unknown as import('@prisma/client').PrismaClient,
      buildMockRedis() as unknown as import('ioredis').Redis,
      new Map([['MVOLA', buildMockGateway()]]),
    );

    await service.initiate({
      bookingId: BOOKING_ID,
      userId: USER_ID,
      provider: 'MVOLA',
      phone: '+261340000001',
    });

    // PlatformFee DOIT être 0 pour WALK_IN (RG-02)
    expect(capturedPlatformFee!.amountMga).toBe(0);
    expect(capturedPlatformFee!.policyRef).toBe('RG-02-WALK_IN');

    // Commission.updateMany ne doit PAS être appelé pour WALK_IN
    expect(mockTx.commission.updateMany).not.toHaveBeenCalled();
  });

  it('plan SUBSCRIPTION → Commission = 0 même pour ONLINE', async () => {
    const onlineBooking = makeOnlineBooking({
      tripInstance: {
        id: TRIP_ID,
        cooperativeId: COOP_ID,
        cooperative: {
          pricingPlans: [planSubscription], // Plan SUBSCRIPTION
        },
      },
    });

    const db = buildMockDb({
      booking: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(onlineBooking)
          .mockResolvedValueOnce(null),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    let capturedAuditAfter: Record<string, unknown> | null = null;
    const mockTx = buildMockTx({
      auditLog: {
        create: jest.fn().mockImplementation(({ data }: { data: { after: Record<string, unknown> } }) => {
          capturedAuditAfter = data.after as Record<string, unknown>;
          return Promise.resolve({});
        }),
      },
    });
    (db.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));

    const service = new PaymentsService(
      db as unknown as import('@prisma/client').PrismaClient,
      buildMockRedis() as unknown as import('ioredis').Redis,
      new Map([['MVOLA', buildMockGateway()]]),
    );

    await service.initiate({
      bookingId: BOOKING_ID,
      userId: USER_ID,
      provider: 'MVOLA',
      phone: '+261340000001',
    });

    // Commission doit être 0 pour plan SUBSCRIPTION
    expect(capturedAuditAfter!.commissionMga).toBe(0);
  });

  it('booking introuvable → lève NotFoundError', async () => {
    const { service, db } = buildService();
    (db.booking.findFirst as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      service.initiate({ bookingId: BOOKING_ID, userId: USER_ID, provider: 'MVOLA', phone: '+261340000001' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('paiement déjà CONFIRMED → lève ConflictError', async () => {
    const { service, db } = buildService();
    (db.booking.findFirst as jest.Mock).mockResolvedValueOnce(makeOnlineBooking());
    (db.payment.findFirst as jest.Mock).mockResolvedValueOnce({ id: PAYMENT_ID, status: 'CONFIRMED' });

    await expect(
      service.initiate({ bookingId: BOOKING_ID, userId: USER_ID, provider: 'MVOLA', phone: '+261340000001' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ======================================================================
// 2. handleWebhook — signature invalide → WebhookSignatureError
// ======================================================================

describe('PaymentsService.handleWebhook — signature invalide', () => {
  it('signature invalide → lève WebhookSignatureError (code INVALID_SIGNATURE)', async () => {
    const { service } = buildService(
      {},
      { verifyWebhookSignature: jest.fn().mockReturnValue(false) },
    );

    const rawBody = Buffer.from(JSON.stringify({ providerTransactionId: 'tx-bad', status: 'SUCCESS' }));

    await expect(
      service.handleWebhook({
        provider: 'mvola',
        rawBody,
        signature: 'invalidsig',
        payload: { providerTransactionId: 'tx-bad', status: 'SUCCESS', amountMga: 26000 },
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});

// ======================================================================
// 3. handleWebhook — succès → Booking CONFIRMED, SEAT_SOLD émis, SMS enfilé
// ======================================================================

describe('PaymentsService.handleWebhook — succès paiement', () => {
  it('webhook SUCCESS → Booking CONFIRMED, SEAT_SOLD émis sur Redis, SMS enfilé', async () => {
    const booking = makeBookingWithHolds();
    const rawBody = Buffer.from(JSON.stringify({ providerTransactionId: 'tx-ok', status: 'SUCCESS', bookingReference: 'IT-ABCDE' }));

    const { service, redis } = buildService({
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(booking),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    const result = await service.handleWebhook({
      provider: 'mvola',
      rawBody,
      signature: 'valid-sig',
      payload: { providerTransactionId: 'tx-ok', status: 'SUCCESS', bookingReference: 'IT-ABCDE', amountMga: 26000 },
    });

    expect(result.status).toBe('processed');

    // Pub/Sub SEAT_SOLD émis sur le canal trip:{tripInstanceId}
    expect(redis.publish).toHaveBeenCalledWith(
      `trip:${TRIP_ID}`,
      expect.stringContaining('"event":"SEAT_SOLD"'),
    );

    // SMS BOOKING_CONFIRMED enfilé
    expect(enqueueSms).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: 'BOOKING_CONFIRMED', isTransactional: true }),
    );
  });
});

// ======================================================================
// 4. handleWebhook — idempotence (2× même providerTransactionId déjà CONFIRMED)
// ======================================================================

describe('PaymentsService.handleWebhook — idempotence', () => {
  it('providerTransactionId déjà CONFIRMED → retourne duplicate sans retraitement', async () => {
    const { service, db, redis } = buildService();

    // Simuler un payment déjà CONFIRMED avec ce providerTransactionId
    (db.payment.findFirst as jest.Mock).mockResolvedValueOnce({  // eslint-disable-line @typescript-eslint/no-unused-vars
      id: PAYMENT_ID,
      status: 'CONFIRMED',
      providerTransactionId: 'tx-already-done',
    });

    const rawBody = Buffer.from(JSON.stringify({ providerTransactionId: 'tx-already-done', status: 'SUCCESS' }));

    const result = await service.handleWebhook({
      provider: 'mvola',
      rawBody,
      signature: 'valid-sig',
      payload: { providerTransactionId: 'tx-already-done', status: 'SUCCESS', amountMga: 26000 },
    });

    expect(result.status).toBe('duplicate');

    // Aucune transaction DB exécutée
    expect(db.$transaction).not.toHaveBeenCalled();

    // Aucun Pub/Sub émis
    expect(redis.publish).not.toHaveBeenCalled();

    // Aucun SMS enfilé
    expect(enqueueSms).not.toHaveBeenCalled();
  });

  it('2× le même webhook → 1 seul traitement (le deuxième retourne duplicate)', async () => {
    const booking = makeBookingWithHolds();
    const rawBody = Buffer.from(JSON.stringify({
      providerTransactionId: 'tx-dup',
      status: 'SUCCESS',
      bookingReference: 'IT-ABCDE',
    }));

    const db = buildMockDb({
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(booking),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        // Premier appel : pas encore CONFIRMED (traitement initial)
        // Deuxième appel : déjà CONFIRMED (idempotence)
        findFirst: jest.fn()
          .mockResolvedValueOnce(null)            // 1er webhook : pas de CONFIRMED existant
          .mockResolvedValueOnce({ id: PAYMENT_ID, status: 'CONFIRMED', providerTransactionId: 'tx-dup' }), // 2ème webhook
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    const gateway = buildMockGateway();
    const gateways = new Map([['MVOLA', gateway], ['ORANGE_MONEY', gateway]]);
    const service = new PaymentsService(
      db as unknown as import('@prisma/client').PrismaClient,
      buildMockRedis() as unknown as import('ioredis').Redis,
      gateways,
    );

    // Premier webhook
    const result1 = await service.handleWebhook({
      provider: 'mvola',
      rawBody,
      signature: 'valid-sig',
      payload: { providerTransactionId: 'tx-dup', status: 'SUCCESS', bookingReference: 'IT-ABCDE', amountMga: 26000 },
    });

    // Deuxième webhook — même transaction
    const result2 = await service.handleWebhook({
      provider: 'mvola',
      rawBody,
      signature: 'valid-sig',
      payload: { providerTransactionId: 'tx-dup', status: 'SUCCESS', bookingReference: 'IT-ABCDE', amountMga: 26000 },
    });

    expect(result1.status).toBe('processed');
    expect(result2.status).toBe('duplicate');

    // La transaction DB n'a été appelée qu'une fois (premier webhook)
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ======================================================================
// 5. handleWebhook — échec paiement → Booking PAYMENT_FAILED, SEAT_RELEASED
// ======================================================================

describe('PaymentsService.handleWebhook — échec paiement', () => {
  it('webhook FAILED → Booking PAYMENT_FAILED, SEAT_RELEASED émis sur Redis', async () => {
    const booking = makeBookingWithHolds();
    const rawBody = Buffer.from(JSON.stringify({
      providerTransactionId: 'tx-fail',
      status: 'FAILED',
      bookingReference: 'IT-ABCDE',
    }));

    const db = buildMockDb({
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(booking),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    const redis = buildMockRedis();
    const gateway = buildMockGateway();
    const gateways = new Map([['MVOLA', gateway], ['ORANGE_MONEY', gateway]]);
    const service = new PaymentsService(
      db as unknown as import('@prisma/client').PrismaClient,
      redis as unknown as import('ioredis').Redis,
      gateways,
    );

    const result = await service.handleWebhook({
      provider: 'mvola',
      rawBody,
      signature: 'valid-sig',
      payload: { providerTransactionId: 'tx-fail', status: 'FAILED', bookingReference: 'IT-ABCDE', amountMga: 26000 },
    });

    expect(result.status).toBe('failed');

    // Transaction DB exécutée pour marquer PAYMENT_FAILED
    expect(db.$transaction).toHaveBeenCalledTimes(1);

    // Pub/Sub SEAT_RELEASED émis sur le canal trip:{tripInstanceId}
    expect(redis.publish).toHaveBeenCalledWith(
      `trip:${TRIP_ID}`,
      expect.stringContaining('"event":"SEAT_RELEASED"'),
    );
  });

  it('webhook EXPIRED → Booking PAYMENT_FAILED, SEAT_RELEASED émis', async () => {
    const booking = makeBookingWithHolds();
    const rawBody = Buffer.from(JSON.stringify({
      providerTransactionId: 'tx-exp',
      status: 'EXPIRED',
      bookingReference: 'IT-ABCDE',
    }));

    const db = buildMockDb({
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(booking),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    const redis = buildMockRedis();
    const service = new PaymentsService(
      db as unknown as import('@prisma/client').PrismaClient,
      redis as unknown as import('ioredis').Redis,
      new Map([['MVOLA', buildMockGateway()]]),
    );

    const result = await service.handleWebhook({
      provider: 'mvola',
      rawBody,
      signature: 'valid-sig',
      payload: { providerTransactionId: 'tx-exp', status: 'EXPIRED', bookingReference: 'IT-ABCDE', amountMga: 26000 },
    });

    expect(result.status).toBe('failed');
    expect(redis.publish).toHaveBeenCalledWith(
      `trip:${TRIP_ID}`,
      expect.stringContaining('"event":"SEAT_RELEASED"'),
    );
  });
});

// ======================================================================
// 6. reconcilePending — appelle queryStatus sur les PENDING > 5 min
// ======================================================================

describe('PaymentsService.reconcilePending', () => {
  it('aucun paiement PENDING > 5 min → checked=0, confirmed=0, failed=0', async () => {
    const { service, db } = buildService();
    (db.payment.findMany as jest.Mock).mockResolvedValueOnce([]);

    const result = await service.reconcilePending();

    expect(result).toEqual({ checked: 0, confirmed: 0, failed: 0 });
    expect(db.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING',
          providerTransactionId: null,
        }),
      }),
    );
  });

  it('paiement PENDING > 5 min → appelle queryStatus avec le providerRef', async () => {
    const booking = makeBookingWithHolds();
    const pendingPayment = {
      id: PAYMENT_ID,
      status: 'PENDING',
      provider: 'MVOLA',
      initiatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
      providerTransactionId: null,
      providerRawPayload: { initRef: 'ref-mvola-123' },
      booking: {
        ...booking,
        payments: [{ id: PAYMENT_ID, amountMga: 26000 }],
      },
    };

    const gateway = buildMockGateway({
      queryStatus: jest.fn().mockResolvedValue({
        providerTransactionId: 'ref-mvola-123',
        status: 'PENDING', // Toujours PENDING → pas de confirmation
      }),
    });

    const db = buildMockDb({
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(booking),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValueOnce([pendingPayment]).mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    const service = new PaymentsService(
      db as unknown as import('@prisma/client').PrismaClient,
      buildMockRedis() as unknown as import('ioredis').Redis,
      new Map([['MVOLA', gateway]]),
    );

    const result = await service.reconcilePending();

    expect(result.checked).toBe(1);
    expect(result.confirmed).toBe(0);
    expect(result.failed).toBe(0);
    expect(gateway.queryStatus).toHaveBeenCalledWith('ref-mvola-123');
  });

  it('paiement PENDING > 5 min, queryStatus SUCCESS → confirmé', async () => {
    const booking = makeBookingWithHolds();
    const pendingPayment = {
      id: PAYMENT_ID,
      status: 'PENDING',
      provider: 'MVOLA',
      initiatedAt: new Date(Date.now() - 10 * 60 * 1000),
      providerTransactionId: null,
      providerRawPayload: { initRef: 'ref-mvola-success' },
      booking: {
        ...booking,
        payments: [{ id: PAYMENT_ID, amountMga: 26000 }],
      },
    };

    const gateway = buildMockGateway({
      queryStatus: jest.fn().mockResolvedValue({
        providerTransactionId: 'confirmed-tx-id',
        status: 'SUCCESS',
      }),
    });

    const db = buildMockDb({
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(booking),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValueOnce([pendingPayment]).mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    const redis = buildMockRedis();
    const service = new PaymentsService(
      db as unknown as import('@prisma/client').PrismaClient,
      redis as unknown as import('ioredis').Redis,
      new Map([['MVOLA', gateway]]),
    );

    const result = await service.reconcilePending();

    expect(result.checked).toBe(1);
    expect(result.confirmed).toBe(1);
    expect(result.failed).toBe(0);

    // La transaction de confirmation doit avoir été appelée
    expect(db.$transaction).toHaveBeenCalled();

    // Pub/Sub SEAT_SOLD émis
    expect(redis.publish).toHaveBeenCalledWith(
      `trip:${TRIP_ID}`,
      expect.stringContaining('"event":"SEAT_SOLD"'),
    );
  });

  it('paiement PENDING > 5 min, queryStatus FAILED → échec enregistré', async () => {
    const booking = makeBookingWithHolds();
    const pendingPayment = {
      id: PAYMENT_ID,
      status: 'PENDING',
      provider: 'MVOLA',
      initiatedAt: new Date(Date.now() - 10 * 60 * 1000),
      providerTransactionId: null,
      providerRawPayload: { initRef: 'ref-mvola-fail' },
      booking: {
        ...booking,
        payments: [{ id: PAYMENT_ID, amountMga: 26000 }],
      },
    };

    const gateway = buildMockGateway({
      queryStatus: jest.fn().mockResolvedValue({
        providerTransactionId: 'ref-mvola-fail',
        status: 'FAILED',
      }),
    });

    const db = buildMockDb({
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(booking),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValueOnce([pendingPayment]).mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    const redis = buildMockRedis();
    const service = new PaymentsService(
      db as unknown as import('@prisma/client').PrismaClient,
      redis as unknown as import('ioredis').Redis,
      new Map([['MVOLA', gateway]]),
    );

    const result = await service.reconcilePending();

    expect(result.checked).toBe(1);
    expect(result.confirmed).toBe(0);
    expect(result.failed).toBe(1);

    // Pub/Sub SEAT_RELEASED émis
    expect(redis.publish).toHaveBeenCalledWith(
      `trip:${TRIP_ID}`,
      expect.stringContaining('"event":"SEAT_RELEASED"'),
    );
  });

  it('initRef absent → paiement ignoré dans la réconciliation', async () => {
    const booking = makeBookingWithHolds();
    const pendingPayment = {
      id: PAYMENT_ID,
      status: 'PENDING',
      provider: 'MVOLA',
      initiatedAt: new Date(Date.now() - 10 * 60 * 1000),
      providerTransactionId: null,
      providerRawPayload: null, // Pas d'initRef
      booking: {
        ...booking,
        payments: [{ id: PAYMENT_ID, amountMga: 26000 }],
      },
    };

    const gateway = buildMockGateway();

    const db = buildMockDb({
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValueOnce([pendingPayment]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    const service = new PaymentsService(
      db as unknown as import('@prisma/client').PrismaClient,
      buildMockRedis() as unknown as import('ioredis').Redis,
      new Map([['MVOLA', gateway]]),
    );

    const result = await service.reconcilePending();

    expect(result.checked).toBe(1);
    expect(result.confirmed).toBe(0);
    expect(result.failed).toBe(0);
    expect(gateway.queryStatus).not.toHaveBeenCalled();
  });
});
