/**
 * Tests unitaires — DriverService
 *
 * Couvre :
 *   1. board() via QR valide → BoardingEvent créé, boardingStatus = BOARDED
 *   2. board() via QR avec mauvaise signature → InvalidQrError (403 INVALID_QR)
 *   3. board() passager déjà embarqué → AlreadyBoardedError (409)
 *   4. board() booking d'un autre trajet → WrongTripError (409)
 *   5. noShow() avant départ signalé → NoShowBeforeDepartureError (400)
 *   6. noShow() après départ → AbsenceEvent créé, boardingStatus = ABSENT
 *   7. depart() idempotent (2× → 1 seul TripDepartureEvent, isNew=false au 2e)
 *   8. getManifest() trié par siège, totaux corrects
 *
 * Hypothèses prises (points ambigus du contrat) :
 *   - boardingStatus est au niveau Booking (pas au niveau Passenger/BookingSeat)
 *   - totalPassengers dans le manifeste = nombre d'entrées siège (pas de bookings)
 *   - Si un booking a plusieurs sièges, chaque siège = une entrée manifeste
 *   - Le conducteur peut avoir des memberships sur plusieurs coopératives ;
 *     on filtre par la coopérative propriétaire du trajet
 *   - QR_SECRET par défaut = 'change_me_qr_secret' (identique à bookings.service)
 */

import crypto from 'crypto';
import {
  DriverService,
  InvalidQrError,
  WrongTripError,
  AlreadyBoardedError,
  NoShowBeforeDepartureError,
  NotFoundError,
  ForbiddenError,
} from '../driver.service';

// =====================================================================
// Mock du ws.publisher (évite connexion Redis réelle)
// =====================================================================

jest.mock('../../ws/ws.publisher', () => ({
  emitDriverBoardingUpdate: jest.fn().mockResolvedValue(undefined),
  emitCoopDashboardUpdate: jest.fn().mockResolvedValue(undefined),
}));

import {
  emitDriverBoardingUpdate,
  emitCoopDashboardUpdate,
} from '../../ws/ws.publisher';

// =====================================================================
// Fixtures
// =====================================================================

const DRIVER_USER_ID = '00000000-0000-0000-0000-000000000001';
const MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000002';
const COOP_ID = '00000000-0000-0000-0000-000000000003';
const TRIP_ID = '00000000-0000-0000-0000-000000000010';
const OTHER_TRIP_ID = '00000000-0000-0000-0000-000000000011';
const BOOKING_ID = '00000000-0000-0000-0000-000000000020';
const BOOKING_REF = 'IT-AAAAA';

/** Génère un QR payload signé HMAC valide — reproduit la logique de bookings.service. */
function generateValidQrPayload(overrides?: {
  bookingRef?: string;
  tripInstanceId?: string;
  seatCodes?: string[];
  issuedAt?: string;
}): string {
  const secret = process.env.QR_SECRET ?? 'change_me_qr_secret';
  const data = {
    bookingRef: overrides?.bookingRef ?? BOOKING_REF,
    tripInstanceId: overrides?.tripInstanceId ?? TRIP_ID,
    seatCodes: overrides?.seatCodes ?? ['1A'],
    issuedAt: overrides?.issuedAt ?? new Date().toISOString(),
  };
  const body = JSON.stringify(data);
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return Buffer.from(JSON.stringify({ ...data, sig })).toString('base64url');
}

// =====================================================================
// Mock PrismaClient
// =====================================================================

/**
 * Objet de transaction interactif utilisé par $transaction(async tx => ...).
 * Toutes les méthodes sont des jest.fn() prêtes à être configurées par chaque test.
 */
const mockTx = {
  boardingEvent: {
    create: jest.fn(),
  },
  absenceEvent: {
    create: jest.fn(),
  },
  tripDepartureEvent: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  booking: {
    update: jest.fn(),
  },
  tripInstance: {
    update: jest.fn(),
  },
};

const mockPrisma = {
  membership: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  tripInstance: {
    findUnique: jest.fn(),
  },
  booking: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  tripDepartureEvent: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation(
    async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
  ),
} as unknown as import('@prisma/client').PrismaClient;

// =====================================================================
// Setup
// =====================================================================

beforeEach(() => {
  jest.clearAllMocks();

  // Réponses par défaut : membership COOP_DRIVER actif
  (mockPrisma.membership.findFirst as jest.Mock).mockResolvedValue({
    id: MEMBERSHIP_ID,
    cooperativeId: COOP_ID,
    userId: DRIVER_USER_ID,
    role: 'COOP_DRIVER',
    active: true,
  });

  (mockPrisma.membership.findMany as jest.Mock).mockResolvedValue([
    { cooperativeId: COOP_ID },
  ]);
});

// =====================================================================
// Tests — board()
// =====================================================================

describe('DriverService.board()', () => {
  let service: DriverService;

  beforeEach(() => {
    service = new DriverService(mockPrisma);
  });

  // ------------------------------------------------------------------
  // 1. Board via QR valide → BoardingEvent créé
  // ------------------------------------------------------------------
  it('board via QR valide → BoardingEvent créé et WS émis', async () => {
    const qrPayload = generateValidQrPayload();

    const fakeBooking = {
      id: BOOKING_ID,
      reference: BOOKING_REF,
      tripInstanceId: TRIP_ID,
      cooperativeId: COOP_ID,
      status: 'CONFIRMED',
      boardingStatus: 'NOT_BOARDED',
      passengers: [{ firstName: 'Jean', lastName: 'Dupont', seatCode: '1A' }],
      seats: [{ seatCode: '1A' }],
    };

    const fakeBoardingEvent = {
      id: 'evt-001',
      bookingId: BOOKING_ID,
      boardedAt: new Date(),
    };

    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue(fakeBooking);
    mockTx.boardingEvent.create.mockResolvedValue(fakeBoardingEvent);
    mockTx.booking.update.mockResolvedValue({});

    const result = await service.board(DRIVER_USER_ID, TRIP_ID, { qrPayload });

    // BoardingEvent créé avec method = SCAN
    expect(mockTx.boardingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: BOOKING_ID,
          tripInstanceId: TRIP_ID,
          driverMembershipId: MEMBERSHIP_ID,
          method: 'SCAN',
        }),
      }),
    );

    // boardingStatus mis à jour
    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BOOKING_ID },
        data: { boardingStatus: 'BOARDED' },
      }),
    );

    // WS émis après le commit
    expect(emitDriverBoardingUpdate).toHaveBeenCalledWith(
      TRIP_ID,
      expect.objectContaining({ type: 'BOARDED', bookingId: BOOKING_ID }),
    );

    // Réponse correcte
    expect(result.bookingId).toBe(BOOKING_ID);
    expect(result.reference).toBe(BOOKING_REF);
    expect(result.passenger.firstName).toBe('Jean');
    expect(result.seatCode).toBe('1A');
  });

  // ------------------------------------------------------------------
  // 2. Board via QR avec mauvaise signature → InvalidQrError
  // ------------------------------------------------------------------
  it('board via QR avec mauvaise signature → InvalidQrError (403)', async () => {
    // Payload valide dans sa structure mais avec une signature trafiquée
    const validPayload = generateValidQrPayload();
    const decoded = JSON.parse(Buffer.from(validPayload, 'base64url').toString('utf-8'));
    decoded.sig = 'aabbccddeeff0011223344556677889900112233445566778899001122334455'; // fausse sig
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');

    await expect(
      service.board(DRIVER_USER_ID, TRIP_ID, { qrPayload: tamperedPayload }),
    ).rejects.toThrow(InvalidQrError);

    // Aucun accès DB, aucun WS
    expect(mockPrisma.booking.findUnique).not.toHaveBeenCalled();
    expect(emitDriverBoardingUpdate).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // 3. Board passager déjà embarqué → AlreadyBoardedError
  // ------------------------------------------------------------------
  it('board passager déjà embarqué → AlreadyBoardedError (409)', async () => {
    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: BOOKING_ID,
      reference: BOOKING_REF,
      tripInstanceId: TRIP_ID,
      cooperativeId: COOP_ID,
      status: 'CONFIRMED',
      boardingStatus: 'BOARDED', // déjà embarqué
      passengers: [{ firstName: 'Jean', lastName: 'Dupont', seatCode: '1A' }],
      seats: [{ seatCode: '1A' }],
    });

    await expect(
      service.board(DRIVER_USER_ID, TRIP_ID, { bookingReference: BOOKING_REF }),
    ).rejects.toThrow(AlreadyBoardedError);

    // Transaction non démarrée
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(emitDriverBoardingUpdate).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // 4. Board booking d'un autre trajet → WrongTripError
  // ------------------------------------------------------------------
  it('board booking d\'un autre trajet → WrongTripError (409)', async () => {
    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: BOOKING_ID,
      reference: BOOKING_REF,
      tripInstanceId: OTHER_TRIP_ID, // trajet différent
      cooperativeId: COOP_ID,
      status: 'CONFIRMED',
      boardingStatus: 'NOT_BOARDED',
      passengers: [],
      seats: [],
    });

    await expect(
      service.board(DRIVER_USER_ID, TRIP_ID, { bookingReference: BOOKING_REF }),
    ).rejects.toThrow(WrongTripError);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(emitDriverBoardingUpdate).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // 4b. Board QR avec tripInstanceId différent → WrongTripError
  // ------------------------------------------------------------------
  it('board QR avec tripInstanceId ne correspondant pas → WrongTripError (409)', async () => {
    // QR généré pour OTHER_TRIP, présenté sur TRIP_ID
    const qrPayload = generateValidQrPayload({ tripInstanceId: OTHER_TRIP_ID });

    await expect(
      service.board(DRIVER_USER_ID, TRIP_ID, { qrPayload }),
    ).rejects.toThrow(WrongTripError);

    expect(mockPrisma.booking.findUnique).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Tests — noShow()
// =====================================================================

describe('DriverService.noShow()', () => {
  let service: DriverService;

  beforeEach(() => {
    service = new DriverService(mockPrisma);
  });

  // ------------------------------------------------------------------
  // 5. No-show avant départ signalé → NoShowBeforeDepartureError
  // ------------------------------------------------------------------
  it('noShow avant départ signalé → NoShowBeforeDepartureError (400)', async () => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      status: 'OPEN_FOR_BOOKING',
    });

    // Aucun TripDepartureEvent
    (mockPrisma.tripDepartureEvent.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.noShow(DRIVER_USER_ID, TRIP_ID, { bookingId: BOOKING_ID }),
    ).rejects.toThrow(NoShowBeforeDepartureError);

    // Pas d'AbsenceEvent créé
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(emitDriverBoardingUpdate).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // 6. No-show après départ → AbsenceEvent créé
  // ------------------------------------------------------------------
  it('noShow après départ → AbsenceEvent créé, boardingStatus = ABSENT, WS émis', async () => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      status: 'DEPARTED',
    });

    // TripDepartureEvent existe
    (mockPrisma.tripDepartureEvent.findFirst as jest.Mock).mockResolvedValue({
      id: 'dep-001',
    });

    (mockPrisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: BOOKING_ID,
      tripInstanceId: TRIP_ID,
      cooperativeId: COOP_ID,
      status: 'CONFIRMED',
      boardingStatus: 'NOT_BOARDED',
    });

    const fakeAbsenceEvent = {
      id: 'abs-001',
      bookingId: BOOKING_ID,
      tripInstanceId: TRIP_ID,
      markedAt: new Date(),
      reason: 'Absent à la montée',
    };

    mockTx.absenceEvent.create.mockResolvedValue(fakeAbsenceEvent);
    mockTx.booking.update.mockResolvedValue({});

    const result = await service.noShow(DRIVER_USER_ID, TRIP_ID, {
      bookingId: BOOKING_ID,
      reason: 'Absent à la montée',
    });

    // AbsenceEvent créé
    expect(mockTx.absenceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: BOOKING_ID,
          tripInstanceId: TRIP_ID,
          markedByMembershipId: MEMBERSHIP_ID,
          reason: 'Absent à la montée',
        }),
      }),
    );

    // boardingStatus = ABSENT
    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BOOKING_ID },
        data: { boardingStatus: 'ABSENT' },
      }),
    );

    // WS émis
    expect(emitDriverBoardingUpdate).toHaveBeenCalledWith(
      TRIP_ID,
      expect.objectContaining({ type: 'NO_SHOW', bookingId: BOOKING_ID }),
    );

    expect(result.id).toBe('abs-001');
  });
});

// =====================================================================
// Tests — depart()
// =====================================================================

describe('DriverService.depart()', () => {
  let service: DriverService;

  beforeEach(() => {
    service = new DriverService(mockPrisma);
  });

  // ------------------------------------------------------------------
  // 7. Depart idempotent : 2e appel → même event, pas de doublon
  // ------------------------------------------------------------------
  it('depart idempotent (2× → 1 seul TripDepartureEvent)', async () => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      status: 'OPEN_FOR_BOOKING',
    });

    const existingEvent = {
      id: 'dep-001',
      tripInstanceId: TRIP_ID,
      departedAt: new Date('2026-09-02T06:00:00Z'),
      notes: null,
    };

    // 1er appel : pas d'event existant → création
    mockTx.tripDepartureEvent.findFirst.mockResolvedValueOnce(null);
    mockTx.tripDepartureEvent.create.mockResolvedValueOnce(existingEvent);
    mockTx.tripInstance.update.mockResolvedValue({});

    const result1 = await service.depart(DRIVER_USER_ID, TRIP_ID, {});

    expect(result1.alreadyDeparted).toBe(false);
    expect(mockTx.tripDepartureEvent.create).toHaveBeenCalledTimes(1);
    expect(mockTx.tripInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TRIP_ID },
        data: expect.objectContaining({ status: 'DEPARTED' }),
      }),
    );
    expect(emitDriverBoardingUpdate).toHaveBeenCalledWith(
      TRIP_ID,
      expect.objectContaining({ type: 'DEPARTED' }),
    );
    expect(emitCoopDashboardUpdate).toHaveBeenCalledWith(
      COOP_ID,
      expect.objectContaining({ type: 'TRIP_DEPARTED' }),
    );

    // Reset mocks pour le 2e appel
    jest.clearAllMocks();

    // Membership mock toujours actif
    (mockPrisma.membership.findFirst as jest.Mock).mockResolvedValue({
      id: MEMBERSHIP_ID,
      cooperativeId: COOP_ID,
      userId: DRIVER_USER_ID,
      role: 'COOP_DRIVER',
      active: true,
    });
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      status: 'DEPARTED',
    });

    // 2e appel : event existant → idempotence
    mockTx.tripDepartureEvent.findFirst.mockResolvedValueOnce(existingEvent);

    const result2 = await service.depart(DRIVER_USER_ID, TRIP_ID, {});

    // Pas de doublon
    expect(result2.alreadyDeparted).toBe(true);
    expect(result2.id).toBe('dep-001');
    expect(mockTx.tripDepartureEvent.create).not.toHaveBeenCalled();
    expect(mockTx.tripInstance.update).not.toHaveBeenCalled();

    // Pas d'émission WS au 2e appel
    expect(emitDriverBoardingUpdate).not.toHaveBeenCalled();
    expect(emitCoopDashboardUpdate).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Tests — getManifest()
// =====================================================================

describe('DriverService.getManifest()', () => {
  let service: DriverService;

  beforeEach(() => {
    service = new DriverService(mockPrisma);
  });

  // ------------------------------------------------------------------
  // 8. Manifest trié par siège, totaux corrects
  // ------------------------------------------------------------------
  it('retourne le manifeste trié par siège avec les totaux corrects', async () => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
    });

    // 3 bookings confirmés :
    //   B1 → siège 10A, NOT_BOARDED
    //   B2 → siège 2A,  BOARDED
    //   B3 → siège 1A,  ABSENT
    const fakeBookings = [
      {
        id: 'b1',
        reference: 'IT-B1111',
        boardingStatus: 'NOT_BOARDED',
        passengers: [{ firstName: 'Alice', lastName: 'Martin', seatCode: '10A' }],
        seats: [{ seatCode: '10A' }],
        payments: [{ provider: 'MVOLA', status: 'CONFIRMED' }],
      },
      {
        id: 'b2',
        reference: 'IT-B2222',
        boardingStatus: 'BOARDED',
        passengers: [{ firstName: 'Bob', lastName: 'Dupont', seatCode: '2A' }],
        seats: [{ seatCode: '2A' }],
        payments: [{ provider: 'CASH', status: 'CONFIRMED' }],
      },
      {
        id: 'b3',
        reference: 'IT-B3333',
        boardingStatus: 'ABSENT',
        passengers: [{ firstName: 'Claire', lastName: 'Leblanc', seatCode: '1A' }],
        seats: [{ seatCode: '1A' }],
        payments: [{ provider: 'ORANGE_MONEY', status: 'CONFIRMED' }],
      },
    ];

    (mockPrisma.booking.findMany as jest.Mock).mockResolvedValue(fakeBookings);

    const manifest = await service.getManifest(DRIVER_USER_ID, TRIP_ID);

    // Totaux
    expect(manifest.totalPassengers).toBe(3);
    expect(manifest.boarded).toBe(1);
    expect(manifest.absent).toBe(1);
    expect(manifest.pending).toBe(1);

    // Ordre trié par siège (tri naturel : 1A < 2A < 10A)
    expect(manifest.passengers[0].seatCode).toBe('1A');
    expect(manifest.passengers[1].seatCode).toBe('2A');
    expect(manifest.passengers[2].seatCode).toBe('10A');

    // Passagers bien associés
    expect(manifest.passengers[0].passenger.firstName).toBe('Claire');
    expect(manifest.passengers[1].passenger.firstName).toBe('Bob');
    expect(manifest.passengers[2].passenger.firstName).toBe('Alice');

    // Méthodes de paiement
    expect(manifest.passengers[0].paymentMethod).toBe('ORANGE_MONEY');
    expect(manifest.passengers[1].paymentMethod).toBe('CASH');
    expect(manifest.passengers[2].paymentMethod).toBe('MVOLA');

    // boardingStatus par entrée
    expect(manifest.passengers[0].boardingStatus).toBe('ABSENT');
    expect(manifest.passengers[1].boardingStatus).toBe('BOARDED');
    expect(manifest.passengers[2].boardingStatus).toBe('NOT_BOARDED');
  });

  // ------------------------------------------------------------------
  // Accès refusé si l'utilisateur n'est pas conducteur de la coop
  // ------------------------------------------------------------------
  it('lève ForbiddenError si le conducteur n\'appartient pas à la coopérative', async () => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue({
      id: TRIP_ID,
      cooperativeId: COOP_ID,
    });

    // Membership introuvable
    (mockPrisma.membership.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.getManifest(DRIVER_USER_ID, TRIP_ID),
    ).rejects.toThrow(ForbiddenError);
  });

  // ------------------------------------------------------------------
  // Trajet introuvable → NotFoundError
  // ------------------------------------------------------------------
  it('lève NotFoundError si le trajet est introuvable', async () => {
    (mockPrisma.tripInstance.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.getManifest(DRIVER_USER_ID, TRIP_ID),
    ).rejects.toThrow(NotFoundError);
  });
});

// =====================================================================
// Tests — getTripsToday()
// =====================================================================

describe('DriverService.getTripsToday()', () => {
  let service: DriverService;

  beforeEach(() => {
    service = new DriverService(mockPrisma);
  });

  it('lève ForbiddenError si l\'utilisateur n\'a aucun rôle conducteur actif', async () => {
    (mockPrisma.membership.findMany as jest.Mock).mockResolvedValue([]);

    await expect(service.getTripsToday(DRIVER_USER_ID)).rejects.toThrow(ForbiddenError);
  });

  it('retourne la liste de trajets du jour avec boardedCount et totalPassengers', async () => {
    (mockPrisma.membership.findMany as jest.Mock).mockResolvedValue([
      { cooperativeId: COOP_ID },
    ]);

    const mockFindMany = (mockPrisma as unknown as {
      tripInstance: { findMany: jest.Mock };
    }).tripInstance.findMany = jest.fn().mockResolvedValue([
      {
        id: TRIP_ID,
        departureAt: new Date('2026-09-02T06:00:00Z'),
        status: 'OPEN_FOR_BOOKING',
        route: {
          origin: { nameFr: 'Antananarivo' },
          destination: { nameFr: 'Toamasina' },
        },
        boardingEvents: [{ id: 'e1' }, { id: 'e2' }],
        bookings: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
      },
    ]);

    const trips = await service.getTripsToday(DRIVER_USER_ID);

    expect(trips).toHaveLength(1);
    expect(trips[0].tripInstanceId).toBe(TRIP_ID);
    expect(trips[0].route.origin).toBe('Antananarivo');
    expect(trips[0].route.destination).toBe('Toamasina');
    expect(trips[0].boardedCount).toBe(2);
    expect(trips[0].totalPassengers).toBe(3);

    // Vérifie le filtre de plage de dates
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cooperativeId: { in: [COOP_ID] },
          status: { not: 'CANCELLED' },
        }),
      }),
    );
  });
});
