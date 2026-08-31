// =====================================================================
// Tests unitaires — TripsService + worker trip.autoClose
//
// Couverture requise :
//   1. createTrip — depuis scheduleId et ad-hoc
//   2. openTrip — ouverture réservations + AuditLog (RG-13)
//   3. upsertFares — remplacement tarifs + AuditLog par tarif (RG-13)
//   4. autoClose worker — logique runAutoClose (VH-03)
//   5. getTripForTraveler — visibilité limitée aux trajets OPEN
// =====================================================================

import { TripsService, NotFoundError, ConflictError } from '../trips.service';
import { TripStatus, AuditAction } from '@prisma/client';

// ------------------------------------------------------------------
// Helper mock Prisma — retourne un objet partiel compatible TripsService
// ------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMockPrisma(): any {
  const txMock = {
    tripInstance: { update: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    fare: { deleteMany: jest.fn(), create: jest.fn() },
  };

  const db = {
    $transaction: jest.fn().mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: (tx: any) => Promise<any>) => fn(txMock),
    ),
    _tx: txMock, // expose pour assertions dans les tests
    tripInstance: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    route: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    schedule: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    vehicle: {
      findFirst: jest.fn(),
    },
    fare: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    bookingSeat: {
      count: jest.fn().mockResolvedValue(0),
    },
    seatHold: {
      count: jest.fn().mockResolvedValue(0),
    },
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountMga: 0 } }),
    },
    auditLog: {
      create: jest.fn(),
    },
    city: {
      findUnique: jest.fn(),
    },
  };

  return db;
}

// =====================================================================
// Données de test réutilisables
// =====================================================================

const COOP_ID = 'coop-uuid-001';
const ACTOR_ID = 'user-uuid-001';
const TRIP_ID = 'trip-uuid-001';
const ROUTE_ID = 'route-uuid-001';
const VEHICLE_ID = 'vehicle-uuid-001';
const SCHEDULE_ID = 'schedule-uuid-001';

const MOCK_ROUTE = {
  id: ROUTE_ID,
  cooperativeId: COOP_ID,
  origin: { id: 'city-1', nameFr: 'Antananarivo', nameMg: 'Antananarivo' },
  destination: { id: 'city-2', nameFr: 'Toamasina', nameMg: 'Toamasina' },
  isActive: true,
};

const MOCK_VEHICLE = {
  id: VEHICLE_ID,
  cooperativeId: COOP_ID,
  capacity: 30,
  isActive: true,
  displayName: 'Bus 01',
};

const MOCK_TRIP_DB = {
  id: TRIP_ID,
  cooperativeId: COOP_ID,
  routeId: ROUTE_ID,
  scheduleId: null,
  vehicleId: VEHICLE_ID,
  departureAt: new Date('2026-09-01T06:00:00.000Z'),
  arrivalEstimatedAt: null,
  status: TripStatus.DRAFT,
  openedForBookingAt: null,
  closedForBookingAt: null,
  notesFr: null,
  notesMg: null,
  createdAt: new Date('2026-08-31T10:00:00.000Z'),
  updatedAt: new Date('2026-08-31T10:00:00.000Z'),
  route: {
    origin: { id: 'city-1', nameFr: 'Antananarivo', nameMg: 'Antananarivo' },
    destination: { id: 'city-2', nameFr: 'Toamasina', nameMg: 'Toamasina' },
  },
  vehicle: { id: VEHICLE_ID, displayName: 'Bus 01', capacity: 30 },
  fares: [],
};

// =====================================================================
// 1. createTrip
// =====================================================================

describe('TripsService.createTrip', () => {
  it('crée un TripInstance ad-hoc (routeId direct)', async () => {
    const db = makeMockPrisma();
    db.route.findFirst.mockResolvedValue(MOCK_ROUTE);
    db.vehicle.findFirst.mockResolvedValue(MOCK_VEHICLE);
    db.tripInstance.create.mockResolvedValue(MOCK_TRIP_DB);

    const service = new TripsService(db);
    const result = await service.createTrip(COOP_ID, ACTOR_ID, {
      routeId: ROUTE_ID,
      vehicleId: VEHICLE_ID,
      departureAt: '2026-09-01T06:00:00.000Z',
    });

    expect(db.tripInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cooperativeId: COOP_ID,
          routeId: ROUTE_ID,
          vehicleId: VEHICLE_ID,
          status: TripStatus.DRAFT,
          scheduleId: null,
        }),
      }),
    );
    expect((result as Record<string, unknown>).id).toBe(TRIP_ID);
    expect((result as Record<string, unknown>).status).toBe(TripStatus.DRAFT);
  });

  it('crée un TripInstance depuis scheduleId (route déduite du schedule)', async () => {
    const db = makeMockPrisma();
    db.schedule.findFirst.mockResolvedValue({
      id: SCHEDULE_ID,
      cooperativeId: COOP_ID,
      routeId: ROUTE_ID,
      isActive: true,
    });
    db.route.findFirst.mockResolvedValue(MOCK_ROUTE);
    db.vehicle.findFirst.mockResolvedValue(MOCK_VEHICLE);
    db.tripInstance.create.mockResolvedValue({
      ...MOCK_TRIP_DB,
      scheduleId: SCHEDULE_ID,
    });

    const service = new TripsService(db);
    const result = await service.createTrip(COOP_ID, ACTOR_ID, {
      scheduleId: SCHEDULE_ID,
      vehicleId: VEHICLE_ID,
      departureAt: '2026-09-01T06:00:00.000Z',
    });

    // routeId déduit du schedule
    expect(db.schedule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: SCHEDULE_ID, cooperativeId: COOP_ID }),
      }),
    );
    expect(db.tripInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduleId: SCHEDULE_ID,
          routeId: ROUTE_ID,
        }),
      }),
    );
    expect((result as Record<string, unknown>).scheduleId).toBe(SCHEDULE_ID);
  });

  it('lève NotFoundError si le véhicule n\'appartient pas à la coopérative', async () => {
    const db = makeMockPrisma();
    db.route.findFirst.mockResolvedValue(MOCK_ROUTE);
    db.vehicle.findFirst.mockResolvedValue(null);

    const service = new TripsService(db);
    await expect(
      service.createTrip(COOP_ID, ACTOR_ID, {
        routeId: ROUTE_ID,
        vehicleId: 'other-vehicle',
        departureAt: '2026-09-01T06:00:00.000Z',
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('lève ConflictError si ni scheduleId ni routeId n\'est fourni', async () => {
    const db = makeMockPrisma();
    db.schedule.findFirst.mockResolvedValue(null);

    const service = new TripsService(db);
    // Appel avec un input qui passe Zod mais sans routeId résolu
    // On force le scheduleId invalide pour simuler l'absence de route
    await expect(
      service.createTrip(COOP_ID, ACTOR_ID, {
        scheduleId: SCHEDULE_ID, // schedule introuvable → resolvedRouteId reste undefined
        vehicleId: VEHICLE_ID,
        departureAt: '2026-09-01T06:00:00.000Z',
      }),
    ).rejects.toThrow(ConflictError);
  });
});

// =====================================================================
// 2. openTrip
// =====================================================================

describe('TripsService.openTrip', () => {
  it('ouvre les réservations, met à jour le statut et enregistre un AuditLog (RG-13)', async () => {
    const OPENED_TRIP = {
      ...MOCK_TRIP_DB,
      status: TripStatus.OPEN_FOR_BOOKING,
      openedForBookingAt: new Date(),
    };

    const db = makeMockPrisma();
    db.tripInstance.findFirst.mockResolvedValue(MOCK_TRIP_DB);

    // Préparer les mocks de la transaction
    const txUpdate = jest.fn().mockResolvedValue(OPENED_TRIP);
    const txAuditCreate = jest.fn().mockResolvedValue({});
    db.$transaction = jest.fn().mockImplementation(
      async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const tx = {
          tripInstance: { update: txUpdate },
          auditLog: { create: txAuditCreate },
        };
        return fn(tx);
      },
    );

    const service = new TripsService(db);
    const result = await service.openTrip(COOP_ID, TRIP_ID, ACTOR_ID);

    // Statut mis à jour
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TRIP_ID },
        data: expect.objectContaining({
          status: TripStatus.OPEN_FOR_BOOKING,
          openedForBookingAt: expect.any(Date),
        }),
      }),
    );

    // AuditLog créé (RG-13)
    expect(txAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: ACTOR_ID,
          action: AuditAction.SCHEDULE_CHANGED,
          entityType: 'TripInstance',
          entityId: TRIP_ID,
          before: expect.objectContaining({ status: TripStatus.DRAFT }),
          after: expect.objectContaining({ status: TripStatus.OPEN_FOR_BOOKING }),
        }),
      }),
    );

    expect((result as Record<string, unknown>).status).toBe(TripStatus.OPEN_FOR_BOOKING);
  });

  it('lève ConflictError si le trajet est CANCELLED', async () => {
    const db = makeMockPrisma();
    db.tripInstance.findFirst.mockResolvedValue({
      ...MOCK_TRIP_DB,
      status: TripStatus.CANCELLED,
    });

    const service = new TripsService(db);
    await expect(service.openTrip(COOP_ID, TRIP_ID, ACTOR_ID)).rejects.toThrow(ConflictError);
  });

  it('lève NotFoundError si le trajet n\'existe pas', async () => {
    const db = makeMockPrisma();
    db.tripInstance.findFirst.mockResolvedValue(null);

    const service = new TripsService(db);
    await expect(service.openTrip(COOP_ID, TRIP_ID, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });
});

// =====================================================================
// 3. upsertFares — souveraineté coopérative (RG-04) + AuditLog (RG-13)
// =====================================================================

describe('TripsService.upsertFares', () => {
  const FARE_INPUT = [
    { seatCategory: 'VIP' as const, priceMga: 50000 },
    { seatCategory: 'STANDARD' as const, priceMga: 20000 },
  ];

  it('supprime les tarifs catégorie existants et crée les nouveaux', async () => {
    const existingFares = [
      { id: 'fare-1', tripInstanceId: TRIP_ID, category: 'VIP', priceMga: 45000, seatDefinitionId: null },
    ];

    const newFare1 = {
      id: 'fare-new-1',
      tripInstanceId: TRIP_ID,
      category: 'VIP',
      priceMga: 50000,
      seatDefinitionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const newFare2 = {
      id: 'fare-new-2',
      tripInstanceId: TRIP_ID,
      category: 'STANDARD',
      priceMga: 20000,
      seatDefinitionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = makeMockPrisma();
    db.tripInstance.findFirst.mockResolvedValue({ id: TRIP_ID });
    db.fare.findMany.mockResolvedValue(existingFares);

    const txDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const txFareCreate = jest.fn()
      .mockResolvedValueOnce(newFare1)
      .mockResolvedValueOnce(newFare2);
    const txAuditCreate = jest.fn().mockResolvedValue({});

    db.$transaction = jest.fn().mockImplementation(
      async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const tx = {
          fare: { deleteMany: txDeleteMany, create: txFareCreate },
          auditLog: { create: txAuditCreate },
        };
        return fn(tx);
      },
    );

    const service = new TripsService(db);
    const result = await service.upsertFares(COOP_ID, TRIP_ID, ACTOR_ID, FARE_INPUT) as unknown[];

    // Suppression des anciens tarifs catégorie
    expect(txDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tripInstanceId: TRIP_ID, seatDefinitionId: null }),
      }),
    );

    // Création des nouveaux tarifs
    expect(txFareCreate).toHaveBeenCalledTimes(2);

    // AuditLog (RG-13) — 2 entrées pour 2 tarifs
    expect(txAuditCreate).toHaveBeenCalledTimes(2);

    // AuditLog VIP : before existait à 45000
    expect(txAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.FARE_CHANGED,
          entityType: 'Fare',
          before: expect.objectContaining({ category: 'VIP', priceMga: 45000 }),
          after: expect.objectContaining({ category: 'VIP', priceMga: 50000 }),
        }),
      }),
    );

    // AuditLog STANDARD : pas de before (n'existait pas)
    expect(txAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.FARE_CHANGED,
          before: undefined,
          after: expect.objectContaining({ category: 'STANDARD', priceMga: 20000 }),
        }),
      }),
    );

    expect(result).toHaveLength(2);
  });

  it('lève NotFoundError si le trajet n\'appartient pas à la coopérative', async () => {
    const db = makeMockPrisma();
    db.tripInstance.findFirst.mockResolvedValue(null);

    const service = new TripsService(db);
    await expect(
      service.upsertFares('other-coop', TRIP_ID, ACTOR_ID, FARE_INPUT),
    ).rejects.toThrow(NotFoundError);
  });

  it('respecte la souveraineté coopérative (RG-04) : accepte n\'importe quel prix positif', async () => {
    // Un prix très élevé doit être accepté sans validation InsTRAM
    const highPriceFares = [{ seatCategory: 'VIP' as const, priceMga: 9999999 }];

    const createdFare = {
      id: 'fare-new',
      tripInstanceId: TRIP_ID,
      category: 'VIP',
      priceMga: 9999999,
      seatDefinitionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = makeMockPrisma();
    db.tripInstance.findFirst.mockResolvedValue({ id: TRIP_ID });
    db.fare.findMany.mockResolvedValue([]);

    db.$transaction = jest.fn().mockImplementation(
      async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const tx = {
          fare: { deleteMany: jest.fn(), create: jest.fn().mockResolvedValue(createdFare) },
          auditLog: { create: jest.fn() },
        };
        return fn(tx);
      },
    );

    const service = new TripsService(db);
    // Ne doit pas lancer d'erreur pour un prix élevé (RG-04)
    const result = await service.upsertFares(COOP_ID, TRIP_ID, ACTOR_ID, highPriceFares) as unknown[];
    expect(result).toHaveLength(1);
    expect((result[0] as Record<string, unknown>).priceMga).toBe(9999999);
  });
});

// =====================================================================
// 4. Worker trip.autoClose (runAutoClose) — VH-03
// =====================================================================

describe('runAutoClose (worker trip.autoClose)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('ne fait rien si aucun trajet à clôturer', async () => {
    // Mock du module prisma via jest.doMock (resetModules requis)
    jest.doMock('../../../infra/db/prisma', () => ({
      __esModule: true,
      default: {
        tripInstance: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn(),
      },
    }));

    const { runAutoClose } = await import('../../../infra/queue/trips.queue');
    const result = await runAutoClose();

    expect(result.closedCount).toBe(0);
    expect(result.tripIds).toHaveLength(0);
  });

  it('marque COMPLETED les trajets dont departureAt < NOW() - 72h (VH-03)', async () => {
    const expiredTrips = [
      { id: 'trip-old-1', status: TripStatus.OPEN_FOR_BOOKING },
      { id: 'trip-old-2', status: TripStatus.DRAFT },
    ];

    const mockUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    const mockAuditCreate = jest.fn().mockResolvedValue({});

    jest.doMock('../../../infra/db/prisma', () => ({
      __esModule: true,
      default: {
        tripInstance: { findMany: jest.fn().mockResolvedValue(expiredTrips) },
        $transaction: jest.fn().mockImplementation(
          async (fn: (tx: Record<string, unknown>) => Promise<unknown>) =>
            fn({
              tripInstance: { updateMany: mockUpdateMany },
              auditLog: { create: mockAuditCreate },
            }),
        ),
      },
    }));

    const { runAutoClose } = await import('../../../infra/queue/trips.queue');
    const result = await runAutoClose();

    expect(result.closedCount).toBe(2);
    expect(result.tripIds).toEqual(['trip-old-1', 'trip-old-2']);

    // Mise à jour en lot
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['trip-old-1', 'trip-old-2'] } },
        data: expect.objectContaining({ status: TripStatus.COMPLETED }),
      }),
    );

    // AuditLog par trajet (RG-13) — 2 entrées
    expect(mockAuditCreate).toHaveBeenCalledTimes(2);
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.SCHEDULE_CHANGED,
          entityType: 'TripInstance',
          after: expect.objectContaining({ reason: 'AUTO_CLOSE_72H' }),
        }),
      }),
    );
  });

  it('n\'affecte pas les trajets CANCELLED ni COMPLETED (filtre WHERE)', async () => {
    const mockFindMany = jest.fn().mockResolvedValue([]);

    jest.doMock('../../../infra/db/prisma', () => ({
      __esModule: true,
      default: {
        tripInstance: { findMany: mockFindMany },
        $transaction: jest.fn(),
      },
    }));

    const { runAutoClose } = await import('../../../infra/queue/trips.queue');
    await runAutoClose();

    // Vérifier que le filtre notIn exclut bien CANCELLED et COMPLETED
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            notIn: expect.arrayContaining([TripStatus.CANCELLED, TripStatus.COMPLETED]),
          },
        }),
      }),
    );
  });
});

// =====================================================================
// 5. getTripForTraveler — visibilité limitée aux trajets OPEN
// =====================================================================

describe('TripsService.getTripForTraveler', () => {
  it('lève NotFoundError si le trajet n\'est pas OPEN_FOR_BOOKING', async () => {
    const db = makeMockPrisma();
    db.tripInstance.findFirst.mockResolvedValue(null);

    const service = new TripsService(db);
    await expect(service.getTripForTraveler('non-open-trip')).rejects.toThrow(NotFoundError);
  });

  it('le filtre Prisma inclut status=OPEN_FOR_BOOKING et openedForBookingAt not null', async () => {
    const db = makeMockPrisma();
    db.tripInstance.findFirst.mockResolvedValue(null);

    const service = new TripsService(db);
    try {
      await service.getTripForTraveler(TRIP_ID, 'fr');
    } catch {
      // Expected NotFoundError
    }

    expect(db.tripInstance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: TRIP_ID,
          status: TripStatus.OPEN_FOR_BOOKING,
          openedForBookingAt: { not: null },
        }),
      }),
    );
  });

  it('retourne le détail avec fareMin/fareMax et seatsAvailable calculés', async () => {
    const OPEN_TRIP = {
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      routeId: ROUTE_ID,
      vehicleId: VEHICLE_ID,
      departureAt: new Date('2026-09-01T06:00:00.000Z'),
      arrivalEstimatedAt: null,
      status: TripStatus.OPEN_FOR_BOOKING,
      openedForBookingAt: new Date('2026-08-31T08:00:00.000Z'),
      closedForBookingAt: null,
      route: {
        origin: {
          id: 'city-1',
          nameFr: 'Antananarivo',
          nameMg: 'Antananarivo',
          district: 'Analamanga',
          region: 'Analamanga',
        },
        destination: {
          id: 'city-2',
          nameFr: 'Toamasina',
          nameMg: 'Toamasina',
          district: 'Toamasina',
          region: 'Atsinanana',
        },
        estimatedDurationMin: 240,
      },
      cooperative: {
        id: COOP_ID,
        displayName: 'Coop Malagasy',
        logoUrl: null,
        ratingAverage: 4.2,
        ratingCount: 12,
        policies: [],
      },
      vehicle: { id: VEHICLE_ID, displayName: 'Bus 01', model: 'Toyota', capacity: 30 },
      fares: [
        { category: 'VIP', priceMga: 50000, seatDefinitionId: null },
        { category: 'STANDARD', priceMga: 20000, seatDefinitionId: null },
      ],
    };

    const db = makeMockPrisma();
    db.tripInstance.findFirst.mockResolvedValue(OPEN_TRIP);
    db.bookingSeat.count.mockResolvedValue(5);  // 5 vendus
    db.seatHold.count.mockResolvedValue(3);     // 3 holds actifs

    const service = new TripsService(db);
    const result = await service.getTripForTraveler(TRIP_ID, 'fr') as Record<string, unknown>;

    expect(result.id).toBe(TRIP_ID);
    expect(result.fareMinMga).toBe(20000);
    expect(result.fareMaxMga).toBe(50000);
    // 30 - 5 - 3 = 22 disponibles
    expect(result.seatsAvailable).toBe(22);

    // Vérifier bilinguisme : avec lang='fr', on reçoit nameFr
    const route = result.route as Record<string, Record<string, unknown>>;
    expect(route.originCity.name).toBe('Antananarivo');
  });

  it('retourne les noms en malgache si lang=mg', async () => {
    const OPEN_TRIP_MG = {
      id: TRIP_ID,
      cooperativeId: COOP_ID,
      routeId: ROUTE_ID,
      vehicleId: VEHICLE_ID,
      departureAt: new Date('2026-09-01T06:00:00.000Z'),
      arrivalEstimatedAt: null,
      status: TripStatus.OPEN_FOR_BOOKING,
      openedForBookingAt: new Date(),
      closedForBookingAt: null,
      route: {
        origin: {
          id: 'city-1',
          nameFr: 'Antananarivo',
          nameMg: 'Antananarivo Renivohitra',
          district: 'Analamanga',
          region: 'Analamanga',
        },
        destination: {
          id: 'city-2',
          nameFr: 'Toamasina',
          nameMg: 'Toamasina Renivohitra',
          district: 'Toamasina',
          region: 'Atsinanana',
        },
        estimatedDurationMin: 240,
      },
      cooperative: {
        id: COOP_ID,
        displayName: 'Coop Test',
        logoUrl: null,
        ratingAverage: 4.0,
        ratingCount: 5,
        policies: [],
      },
      vehicle: { id: VEHICLE_ID, displayName: 'Bus 01', model: null, capacity: 20 },
      fares: [],
    };

    const db = makeMockPrisma();
    db.tripInstance.findFirst.mockResolvedValue(OPEN_TRIP_MG);
    db.bookingSeat.count.mockResolvedValue(0);
    db.seatHold.count.mockResolvedValue(0);

    const service = new TripsService(db);
    const result = await service.getTripForTraveler(TRIP_ID, 'mg') as Record<string, unknown>;

    const route = result.route as Record<string, Record<string, unknown>>;
    expect(route.originCity.name).toBe('Antananarivo Renivohitra');
    expect(route.destinationCity.name).toBe('Toamasina Renivohitra');
  });
});
