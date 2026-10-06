import type { PrismaClient } from '@prisma/client';
import { TripStatus, SeatCategory, AuditAction, BookingStatus } from '@prisma/client';
import type { Redis } from 'ioredis';
import { enqueueSms } from '../../infra/queue/sms.queue';
import type {
  CreateRouteInput,
  UpdateRouteInput,
  CreateScheduleInput,
  UpdateScheduleInput,
  CreateTripInput,
  UpdateTripInput,
  FareItem,
  TripListQuery,
} from './trips.schema';

// =====================================================================
// TripsService
// Contrat : docs/contrat-api.yaml §Cooperative (routes, schedules, trips,
//           tarifs) et §Traveler-Trips (GET /trips/:id)
//
// Règles critiques :
//   RG-04 — Souveraineté coopérative : aucune validation InsTRAM sur Fare.priceMga
//   RG-13 — AuditLog obligatoire sur ouverture/fermeture + modification tarifs
//   VH-03 — Clôture auto 72h (gérée par le worker trips.queue.ts)
// =====================================================================

// ------------------------------------------------------------------
// Erreurs métier
// ------------------------------------------------------------------

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

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

export class TripsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis?: Redis,
  ) {}

  // ================================================================
  // ROUTES
  // ================================================================

  // ----------------------------------------------------------------
  // GET /coop/routes
  // ----------------------------------------------------------------

  async getRoutes(cooperativeId: string): Promise<unknown[]> {
    const routes = await this.db.route.findMany({
      where: { cooperativeId },
      include: {
        origin: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
        destination: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return routes.map(this._formatRoute.bind(this));
  }

  // ----------------------------------------------------------------
  // POST /coop/routes
  // ----------------------------------------------------------------

  async createRoute(
    cooperativeId: string,
    input: CreateRouteInput,
  ): Promise<Record<string, unknown>> {
    // Vérifier que les villes existent
    const [origin, dest] = await Promise.all([
      this.db.city.findUnique({ where: { id: input.originCityId } }),
      this.db.city.findUnique({ where: { id: input.destinationCityId } }),
    ]);

    if (!origin) throw new NotFoundError(`Ville d'origine introuvable : ${input.originCityId}`);
    if (!dest) throw new NotFoundError(`Ville de destination introuvable : ${input.destinationCityId}`);

    const route = await this.db.route.create({
      data: {
        cooperativeId,
        originCityId: input.originCityId,
        destinationCityId: input.destinationCityId,
        displayName: input.displayName,
        distanceKm: input.distanceKm ?? null,
        estimatedDurationMin: input.estimatedDurationMin ?? null,
      },
      include: {
        origin: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
        destination: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
      },
    });

    return this._formatRoute(route);
  }

  // ----------------------------------------------------------------
  // GET /coop/routes/:routeId
  // ----------------------------------------------------------------

  async getRoute(cooperativeId: string, routeId: string): Promise<Record<string, unknown>> {
    const route = await this.db.route.findFirst({
      where: { id: routeId, cooperativeId },
      include: {
        origin: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
        destination: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
        stops: {
          include: { city: { select: { id: true, nameFr: true, nameMg: true } } },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    if (!route) throw new NotFoundError('Route introuvable');
    return this._formatRoute(route);
  }

  // ----------------------------------------------------------------
  // PATCH /coop/routes/:routeId
  // ----------------------------------------------------------------

  async updateRoute(
    cooperativeId: string,
    routeId: string,
    input: UpdateRouteInput,
  ): Promise<Record<string, unknown>> {
    const existing = await this.db.route.findFirst({ where: { id: routeId, cooperativeId } });
    if (!existing) throw new NotFoundError('Route introuvable');

    const updated = await this.db.route.update({
      where: { id: routeId },
      data: {
        ...(input.displayName !== undefined && { displayName: input.displayName }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.distanceKm !== undefined && { distanceKm: input.distanceKm }),
        ...(input.estimatedDurationMin !== undefined && { estimatedDurationMin: input.estimatedDurationMin }),
      },
      include: {
        origin: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
        destination: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
      },
    });

    return this._formatRoute(updated);
  }

  // ================================================================
  // SCHEDULES
  // ================================================================

  // ----------------------------------------------------------------
  // GET /coop/schedules
  // ----------------------------------------------------------------

  async getSchedules(cooperativeId: string): Promise<unknown[]> {
    const schedules = await this.db.schedule.findMany({
      where: { cooperativeId, isActive: true },
      include: {
        route: {
          include: {
            origin: { select: { id: true, nameFr: true, nameMg: true } },
            destination: { select: { id: true, nameFr: true, nameMg: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return schedules.map(this._formatSchedule.bind(this));
  }

  // ----------------------------------------------------------------
  // POST /coop/schedules
  // Ambiguïté documentée : le schema.prisma Schedule n'a pas vehicleId
  // ni arrivalTime (mentionnés dans la tâche). Ces champs sont ignorés.
  // ----------------------------------------------------------------

  async createSchedule(
    cooperativeId: string,
    input: CreateScheduleInput,
  ): Promise<Record<string, unknown>> {
    // Vérifier que la route appartient à la coopérative
    const route = await this.db.route.findFirst({
      where: { id: input.routeId, cooperativeId, isActive: true },
    });

    if (!route) throw new NotFoundError('Route introuvable ou non active');

    const schedule = await this.db.schedule.create({
      data: {
        cooperativeId,
        routeId: input.routeId,
        daysOfWeek: input.daysOfWeek,
        departureTime: input.departureTime,
        isActive: true,
      },
      include: {
        route: {
          include: {
            origin: { select: { id: true, nameFr: true, nameMg: true } },
            destination: { select: { id: true, nameFr: true, nameMg: true } },
          },
        },
      },
    });

    return this._formatSchedule(schedule);
  }

  // ----------------------------------------------------------------
  // PATCH /coop/schedules/:scheduleId
  // ----------------------------------------------------------------

  async updateSchedule(
    cooperativeId: string,
    scheduleId: string,
    input: UpdateScheduleInput,
  ): Promise<Record<string, unknown>> {
    const schedule = await this.db.schedule.findFirst({
      where: { id: scheduleId, cooperativeId },
    });

    if (!schedule) throw new NotFoundError('Schedule introuvable');

    if (input.routeId) {
      const route = await this.db.route.findFirst({
        where: { id: input.routeId, cooperativeId, isActive: true },
      });
      if (!route) throw new NotFoundError('Route introuvable ou non active');
    }

    const updated = await this.db.schedule.update({
      where: { id: scheduleId },
      data: {
        ...(input.routeId ? { routeId: input.routeId } : {}),
        ...(input.daysOfWeek ? { daysOfWeek: input.daysOfWeek } : {}),
        ...(input.departureTime ? { departureTime: input.departureTime } : {}),
      },
      include: {
        route: {
          include: {
            origin: { select: { id: true, nameFr: true, nameMg: true } },
            destination: { select: { id: true, nameFr: true, nameMg: true } },
          },
        },
      },
    });

    return this._formatSchedule(updated);
  }

  // ================================================================
  // TRIP INSTANCES
  // ================================================================

  // ----------------------------------------------------------------
  // GET /coop/trips
  // ----------------------------------------------------------------

  async getTrips(
    cooperativeId: string,
    query: TripListQuery,
  ): Promise<Record<string, unknown>> {
    const { from, to, status, originCityId, destinationCityId, cursor, limit } = query;

    const where: Record<string, unknown> = { cooperativeId };
    if (status) where.status = status;
    if (from || to) {
      const departureAt: Record<string, Date> = {};
      if (from) departureAt.gte = new Date(`${from}T00:00:00.000Z`);
      if (to) departureAt.lte = new Date(`${to}T23:59:59.999Z`);
      where.departureAt = departureAt;
    }
    if (originCityId || destinationCityId) {
      const routeFilter: Record<string, unknown> = {};
      if (originCityId) routeFilter.originCityId = originCityId;
      if (destinationCityId) routeFilter.destinationCityId = destinationCityId;
      where.route = routeFilter;
    }
    if (cursor) where.id = { lt: cursor };

    const items = await this.db.tripInstance.findMany({
      where,
      orderBy: { departureAt: 'asc' },
      take: limit + 1,
      include: {
        route: {
          include: {
            origin: { select: { id: true, nameFr: true, nameMg: true } },
            destination: { select: { id: true, nameFr: true, nameMg: true } },
          },
        },
        vehicle: { select: { id: true, displayName: true, capacity: true } },
        fares: true,
      },
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      items: page.map((t) => this._formatTripSummary(t)),
      nextCursor,
    };
  }

  // ----------------------------------------------------------------
  // POST /coop/trips
  // ----------------------------------------------------------------

  async createTrip(
    cooperativeId: string,
    _actorUserId: string,
    input: CreateTripInput,
  ): Promise<Record<string, unknown>> {
    // Résoudre le routeId
    let resolvedRouteId = input.routeId;

    if (input.scheduleId) {
      const schedule = await this.db.schedule.findFirst({
        where: { id: input.scheduleId, cooperativeId, isActive: true },
      });
      if (!schedule) throw new NotFoundError('Schedule introuvable');
      resolvedRouteId = schedule.routeId;
    }

    if (!resolvedRouteId) {
      throw new ConflictError('routeId est requis si scheduleId est absent');
    }

    // Vérifier que la route appartient à la coopérative
    const route = await this.db.route.findFirst({
      where: { id: resolvedRouteId, cooperativeId },
    });
    if (!route) throw new NotFoundError('Route introuvable ou non autorisée');

    // Vérifier que le véhicule appartient à la coopérative
    const vehicle = await this.db.vehicle.findFirst({
      where: { id: input.vehicleId, cooperativeId, isActive: true },
    });
    if (!vehicle) throw new NotFoundError('Véhicule introuvable ou non actif');

    const trip = await this.db.tripInstance.create({
      data: {
        cooperativeId,
        routeId: resolvedRouteId,
        scheduleId: input.scheduleId ?? null,
        vehicleId: input.vehicleId,
        departureAt: new Date(input.departureAt),
        arrivalEstimatedAt: input.arrivalEstimatedAt ? new Date(input.arrivalEstimatedAt) : null,
        notesFr: input.notesFr ?? null,
        notesMg: input.notesMg ?? null,
        status: TripStatus.DRAFT,
      },
      include: {
        route: {
          include: {
            origin: { select: { id: true, nameFr: true, nameMg: true } },
            destination: { select: { id: true, nameFr: true, nameMg: true } },
          },
        },
        vehicle: { select: { id: true, displayName: true, capacity: true } },
        fares: true,
      },
    });

    return this._formatTripSummary(trip);
  }

  // ----------------------------------------------------------------
  // GET /coop/trips/:tripInstanceId — détail avec stats (vue coop)
  // ----------------------------------------------------------------

  async getTrip(
    cooperativeId: string,
    tripInstanceId: string,
  ): Promise<Record<string, unknown>> {
    const trip = await this.db.tripInstance.findFirst({
      where: { id: tripInstanceId, cooperativeId },
      include: {
        route: {
          include: {
            origin: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
            destination: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
          },
        },
        vehicle: {
          include: {
            seatMap: { include: { seats: true } },
          },
        },
        schedule: { select: { id: true, daysOfWeek: true, departureTime: true } },
        fares: true,
      },
    });

    if (!trip) throw new NotFoundError('Trajet introuvable');

    // Stats temps réel
    const [seatsSold, seatsHeld, revenueAgg] = await Promise.all([
      this.db.bookingSeat.count({
        where: { tripInstanceId, isActive: true },
      }),
      this.db.seatHold.count({
        where: { tripInstanceId, expiresAt: { gt: new Date() } },
      }),
      this.db.payment.aggregate({
        where: { booking: { tripInstanceId }, status: 'CONFIRMED' },
        _sum: { amountMga: true },
      }),
    ]);

    const seatsTotal = trip.vehicle.capacity;
    const seatsAvailable = Math.max(0, seatsTotal - seatsSold - seatsHeld);
    const revenueMga = revenueAgg._sum.amountMga ?? 0;

    return {
      ...this._formatTripDetail(trip),
      stats: {
        seatsTotal,
        seatsSold,
        seatsHeld,
        seatsAvailable,
        revenueMga,
      },
    };
  }

  // ----------------------------------------------------------------
  // POST /coop/trips/:id/open — ouvrir les réservations
  // AuditLog (RG-13) — action SCHEDULE_CHANGED (la plus proche dans l'enum)
  // ----------------------------------------------------------------

  async openTrip(
    cooperativeId: string,
    tripInstanceId: string,
    actorUserId: string,
  ): Promise<Record<string, unknown>> {
    const trip = await this.db.tripInstance.findFirst({
      where: { id: tripInstanceId, cooperativeId },
    });

    if (!trip) throw new NotFoundError('Trajet introuvable');

    if (trip.status === TripStatus.CANCELLED) {
      throw new ConflictError('Un trajet annulé ne peut pas être ouvert');
    }
    if (trip.status === TripStatus.COMPLETED) {
      throw new ConflictError('Un trajet terminé ne peut pas être ouvert');
    }

    const now = new Date();

    const updated = await this.db.$transaction(async (tx) => {
      const upd = await tx.tripInstance.update({
        where: { id: tripInstanceId },
        data: {
          status: TripStatus.OPEN_FOR_BOOKING,
          openedForBookingAt: now,
        },
        include: {
          route: {
            include: {
              origin: { select: { id: true, nameFr: true, nameMg: true } },
              destination: { select: { id: true, nameFr: true, nameMg: true } },
            },
          },
          vehicle: { select: { id: true, displayName: true, capacity: true } },
          fares: true,
        },
      });

      // AuditLog (RG-13 : traçabilité ouverture réservations)
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: AuditAction.SCHEDULE_CHANGED,
          entityType: 'TripInstance',
          entityId: tripInstanceId,
          before: { status: trip.status },
          after: { status: TripStatus.OPEN_FOR_BOOKING, openedForBookingAt: now.toISOString() },
        },
      });

      return upd;
    });

    return this._formatTripSummary(updated);
  }

  // ----------------------------------------------------------------
  // POST /coop/trips/:id/close — fermer les réservations
  // AuditLog (RG-13)
  // ----------------------------------------------------------------

  async closeTrip(
    cooperativeId: string,
    tripInstanceId: string,
    actorUserId: string,
  ): Promise<Record<string, unknown>> {
    const trip = await this.db.tripInstance.findFirst({
      where: { id: tripInstanceId, cooperativeId },
    });

    if (!trip) throw new NotFoundError('Trajet introuvable');

    if (
      trip.status === TripStatus.CANCELLED ||
      trip.status === TripStatus.COMPLETED
    ) {
      throw new ConflictError('Ce trajet ne peut pas être fermé dans son état actuel');
    }

    const now = new Date();

    const updated = await this.db.$transaction(async (tx) => {
      const upd = await tx.tripInstance.update({
        where: { id: tripInstanceId },
        data: {
          status: TripStatus.CLOSED_FOR_BOOKING,
          closedForBookingAt: now,
        },
        include: {
          route: {
            include: {
              origin: { select: { id: true, nameFr: true, nameMg: true } },
              destination: { select: { id: true, nameFr: true, nameMg: true } },
            },
          },
          vehicle: { select: { id: true, displayName: true, capacity: true } },
          fares: true,
        },
      });

      // AuditLog (RG-13)
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: AuditAction.SCHEDULE_CHANGED,
          entityType: 'TripInstance',
          entityId: tripInstanceId,
          before: { status: trip.status },
          after: { status: TripStatus.CLOSED_FOR_BOOKING, closedAt: now.toISOString() },
        },
      });

      return upd;
    });

    return this._formatTripSummary(updated);
  }

  // ----------------------------------------------------------------
  // GET /coop/trips/:id/fares — liste des tarifs
  // ----------------------------------------------------------------

  async getFares(
    cooperativeId: string,
    tripInstanceId: string,
  ): Promise<unknown[]> {
    // Vérifier l'appartenance
    const trip = await this.db.tripInstance.findFirst({
      where: { id: tripInstanceId, cooperativeId },
      select: { id: true },
    });
    if (!trip) throw new NotFoundError('Trajet introuvable');

    const fares = await this.db.fare.findMany({
      where: { tripInstanceId },
      orderBy: { category: 'asc' },
    });

    return fares.map((f) => ({
      id: f.id,
      tripInstanceId: f.tripInstanceId,
      seatDefinitionId: f.seatDefinitionId ?? null,
      category: f.category ?? null,
      priceMga: f.priceMga,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    }));
  }

  // ----------------------------------------------------------------
  // PUT /coop/trips/:id/fares — définir/mettre à jour les tarifs
  //
  // Souveraineté coopérative (RG-04) : aucune validation InsTRAM sur le prix.
  // Stratégie : remplacement complet des tarifs par catégorie.
  //   - Les tarifs par SeatDefinition précise (seatDefinitionId != null)
  //     ne sont pas touchés.
  //   - AuditLog par modification (RG-13).
  // ----------------------------------------------------------------

  async upsertFares(
    cooperativeId: string,
    tripInstanceId: string,
    actorUserId: string,
    items: FareItem[],
  ): Promise<unknown[]> {
    // Vérifier l'appartenance
    const trip = await this.db.tripInstance.findFirst({
      where: { id: tripInstanceId, cooperativeId },
      select: { id: true },
    });
    if (!trip) throw new NotFoundError('Trajet introuvable');

    // Charger les tarifs catégorie existants (before state)
    const existingFares = await this.db.fare.findMany({
      where: { tripInstanceId, seatDefinitionId: null },
    });

    const existingMap = new Map(
      existingFares.map((f) => [f.category as string, f]),
    );

    const newFares = await this.db.$transaction(async (tx) => {
      // Supprimer les tarifs catégorie existants
      await tx.fare.deleteMany({
        where: { tripInstanceId, seatDefinitionId: null },
      });

      // Créer les nouveaux tarifs
      const created = await Promise.all(
        items.map((item) =>
          tx.fare.create({
            data: {
              tripInstanceId,
              category: item.seatCategory as SeatCategory,
              priceMga: item.priceMga,
              seatDefinitionId: null,
            },
          }),
        ),
      );

      // AuditLog par tarif modifié (RG-13)
      for (const item of items) {
        const before = existingMap.get(item.seatCategory);
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: AuditAction.FARE_CHANGED,
            entityType: 'Fare',
            entityId: tripInstanceId,
            before: before ? { category: item.seatCategory, priceMga: before.priceMga } : undefined,
            after: { category: item.seatCategory, priceMga: item.priceMga },
          },
        });
      }

      return created;
    });

    return newFares.map((f) => ({
      id: f.id,
      tripInstanceId: f.tripInstanceId,
      seatDefinitionId: null,
      category: f.category,
      priceMga: f.priceMga,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    }));
  }

  // ----------------------------------------------------------------
  // GET /coop/trips/:id/dashboard — tableau de bord temps réel
  // Non présent dans le contrat officiel (contrat a GET /coop/dashboard
  // mais c'est un dashboard global). Documenté comme extension.
  // ----------------------------------------------------------------

  async getTripDashboard(
    cooperativeId: string,
    tripInstanceId: string,
  ): Promise<Record<string, unknown>> {
    const trip = await this.db.tripInstance.findFirst({
      where: { id: tripInstanceId, cooperativeId },
      include: {
        vehicle: { select: { capacity: true } },
      },
    });

    if (!trip) throw new NotFoundError('Trajet introuvable');

    const [seatsSold, seatsHolds, revenueAgg] = await Promise.all([
      this.db.bookingSeat.count({
        where: { tripInstanceId, isActive: true },
      }),
      this.db.seatHold.count({
        where: { tripInstanceId, expiresAt: { gt: new Date() } },
      }),
      this.db.payment.aggregate({
        where: { booking: { tripInstanceId }, status: 'CONFIRMED' },
        _sum: { amountMga: true },
      }),
    ]);

    const seatsTotal = trip.vehicle.capacity;
    const seatsDisponibles = Math.max(0, seatsTotal - seatsSold - seatsHolds);

    return {
      tripInstanceId,
      seatsTotal,
      seatsSold,
      seatsHolds,
      seatsDisponibles,
      recetteConfirmeeMga: revenueAgg._sum.amountMga ?? 0,
    };
  }

  // ================================================================
  // VOYAGEUR — GET /trips/:tripInstanceId
  // ================================================================

  // ----------------------------------------------------------------
  // Retourne le détail du trajet au voyageur.
  // Ne retourne rien si status != OPEN_FOR_BOOKING ou
  // openedForBookingAt IS NULL (contrat §Traveler-Trips).
  // ----------------------------------------------------------------

  async getTripForTraveler(
    tripInstanceId: string,
    lang: 'fr' | 'mg' = 'fr',
  ): Promise<Record<string, unknown>> {
    const trip = await this.db.tripInstance.findFirst({
      where: {
        id: tripInstanceId,
        status: TripStatus.OPEN_FOR_BOOKING,
        openedForBookingAt: { not: null },
      },
      include: {
        route: {
          include: {
            origin: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
            destination: { select: { id: true, nameFr: true, nameMg: true, district: true, region: true } },
          },
        },
        cooperative: {
          select: {
            id: true,
            displayName: true,
            logoUrl: true,
            ratingAverage: true,
            ratingCount: true,
            policies: {
              where: { isActive: true },
              orderBy: { version: 'desc' },
              take: 1,
            },
          },
        },
        vehicle: { select: { id: true, displayName: true, model: true, capacity: true } },
        fares: { where: { seatDefinitionId: null } },
      },
    });

    if (!trip) throw new NotFoundError('Trajet introuvable ou non ouvert à la réservation');

    // Calculer disponibilité
    const [seatsSold, seatsHeld] = await Promise.all([
      this.db.bookingSeat.count({ where: { tripInstanceId, isActive: true } }),
      this.db.seatHold.count({
        where: { tripInstanceId, expiresAt: { gt: new Date() } },
      }),
    ]);
    const seatsAvailable = Math.max(0, trip.vehicle.capacity - seatsSold - seatsHeld);

    // Tarifs min/max
    const prices = trip.fares.map((f) => f.priceMga);
    const fareMin = prices.length > 0 ? Math.min(...prices) : null;
    const fareMax = prices.length > 0 ? Math.max(...prices) : null;

    const cityName = (city: { nameFr: string; nameMg: string }): string =>
      lang === 'mg' ? city.nameMg : city.nameFr;

    const policy = trip.cooperative.policies?.[0];

    return {
      id: trip.id,
      departureAt: trip.departureAt.toISOString(),
      arrivalEstimatedAt: trip.arrivalEstimatedAt?.toISOString() ?? null,
      status: trip.status,
      seatsAvailable,
      fareMinMga: fareMin,
      fareMaxMga: fareMax,
      route: {
        originCity: {
          id: trip.route.origin.id,
          name: cityName(trip.route.origin),
          district: trip.route.origin.district,
          region: trip.route.origin.region,
        },
        destinationCity: {
          id: trip.route.destination.id,
          name: cityName(trip.route.destination),
          district: trip.route.destination.district,
          region: trip.route.destination.region,
        },
        estimatedDurationMin: trip.route.estimatedDurationMin ?? null,
      },
      cooperative: {
        id: trip.cooperative.id,
        displayName: trip.cooperative.displayName,
        logoUrl: trip.cooperative.logoUrl ?? null,
        ratingAverage: trip.cooperative.ratingAverage,
        ratingCount: trip.cooperative.ratingCount,
      },
      vehicle: {
        id: trip.vehicle.id,
        name: trip.vehicle.displayName,
        model: trip.vehicle.model ?? null,
        capacity: trip.vehicle.capacity,
      },
      policy: policy
        ? {
            titleFr: policy.titleFr,
            titleMg: policy.titleMg,
            bodyFr: policy.bodyFr,
            bodyMg: policy.bodyMg,
          }
        : null,
      fares: trip.fares.map((f) => ({
        category: f.category,
        priceMga: f.priceMga,
      })),
    };
  }

  // ================================================================
  // Formatage DTOs
  // ================================================================

  private _formatRoute(route: {
    id: string;
    cooperativeId: string;
    displayName: string;
    distanceKm?: number | null;
    estimatedDurationMin?: number | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    origin: { id: string; nameFr: string; nameMg: string; district?: string; region?: string };
    destination: { id: string; nameFr: string; nameMg: string; district?: string; region?: string };
    stops?: Array<{ orderIndex: number; offsetMin: number; city: { id: string; nameFr: string; nameMg: string } }>;
  }): Record<string, unknown> {
    return {
      id: route.id,
      cooperativeId: route.cooperativeId,
      displayName: route.displayName,
      distanceKm: route.distanceKm ?? null,
      estimatedDurationMin: route.estimatedDurationMin ?? null,
      isActive: route.isActive,
      originCity: {
        id: route.origin.id,
        nameFr: route.origin.nameFr,
        nameMg: route.origin.nameMg,
        district: route.origin.district ?? null,
        region: route.origin.region ?? null,
      },
      destinationCity: {
        id: route.destination.id,
        nameFr: route.destination.nameFr,
        nameMg: route.destination.nameMg,
        district: route.destination.district ?? null,
        region: route.destination.region ?? null,
      },
      stops: route.stops?.map((s) => ({
        orderIndex: s.orderIndex,
        offsetMin: s.offsetMin,
        city: { id: s.city.id, nameFr: s.city.nameFr, nameMg: s.city.nameMg },
      })) ?? [],
      createdAt: route.createdAt.toISOString(),
      updatedAt: route.updatedAt.toISOString(),
    };
  }

  private _formatSchedule(schedule: {
    id: string;
    cooperativeId: string;
    routeId: string;
    daysOfWeek: number[];
    departureTime: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    route: {
      origin: { id: string; nameFr: string; nameMg: string };
      destination: { id: string; nameFr: string; nameMg: string };
    };
  }): Record<string, unknown> {
    return {
      id: schedule.id,
      cooperativeId: schedule.cooperativeId,
      routeId: schedule.routeId,
      daysOfWeek: schedule.daysOfWeek,
      departureTime: schedule.departureTime,
      isActive: schedule.isActive,
      route: {
        originCity: {
          id: schedule.route.origin.id,
          nameFr: schedule.route.origin.nameFr,
          nameMg: schedule.route.origin.nameMg,
        },
        destinationCity: {
          id: schedule.route.destination.id,
          nameFr: schedule.route.destination.nameFr,
          nameMg: schedule.route.destination.nameMg,
        },
      },
      createdAt: schedule.createdAt.toISOString(),
      updatedAt: schedule.updatedAt.toISOString(),
    };
  }

  private _formatTripSummary(trip: {
    id: string;
    cooperativeId: string;
    routeId: string;
    scheduleId?: string | null;
    vehicleId: string;
    departureAt: Date;
    arrivalEstimatedAt?: Date | null;
    status: string;
    openedForBookingAt?: Date | null;
    closedForBookingAt?: Date | null;
    notesFr?: string | null;
    notesMg?: string | null;
    createdAt: Date;
    updatedAt: Date;
    route: {
      origin: { id: string; nameFr: string; nameMg: string };
      destination: { id: string; nameFr: string; nameMg: string };
    };
    vehicle: { id: string; displayName: string; capacity: number };
    fares: Array<{ category?: string | null; priceMga: number }>;
  }): Record<string, unknown> {
    const prices = trip.fares.map((f) => f.priceMga);

    return {
      id: trip.id,
      cooperativeId: trip.cooperativeId,
      routeId: trip.routeId,
      scheduleId: trip.scheduleId ?? null,
      vehicleId: trip.vehicleId,
      departureAt: trip.departureAt.toISOString(),
      arrivalEstimatedAt: trip.arrivalEstimatedAt?.toISOString() ?? null,
      status: trip.status,
      openedForBookingAt: trip.openedForBookingAt?.toISOString() ?? null,
      closedForBookingAt: trip.closedForBookingAt?.toISOString() ?? null,
      notesFr: trip.notesFr ?? null,
      notesMg: trip.notesMg ?? null,
      fareMinMga: prices.length ? Math.min(...prices) : null,
      fareMaxMga: prices.length ? Math.max(...prices) : null,
      route: {
        originCity: { id: trip.route.origin.id, nameFr: trip.route.origin.nameFr, nameMg: trip.route.origin.nameMg },
        destinationCity: { id: trip.route.destination.id, nameFr: trip.route.destination.nameFr, nameMg: trip.route.destination.nameMg },
      },
      vehicle: { id: trip.vehicle.id, displayName: trip.vehicle.displayName, capacity: trip.vehicle.capacity },
      createdAt: trip.createdAt.toISOString(),
      updatedAt: trip.updatedAt.toISOString(),
    };
  }

  private _formatTripDetail(trip: {
    id: string;
    cooperativeId: string;
    routeId: string;
    scheduleId?: string | null;
    vehicleId: string;
    departureAt: Date;
    arrivalEstimatedAt?: Date | null;
    status: string;
    openedForBookingAt?: Date | null;
    closedForBookingAt?: Date | null;
    notesFr?: string | null;
    notesMg?: string | null;
    createdAt: Date;
    updatedAt: Date;
    route: {
      origin: { id: string; nameFr: string; nameMg: string; district: string; region: string };
      destination: { id: string; nameFr: string; nameMg: string; district: string; region: string };
    };
    vehicle: {
      id: string;
      displayName: string;
      capacity: number;
      seatMap: { id: string; capacity: number; layout: unknown };
    };
    schedule?: { id: string; daysOfWeek: number[]; departureTime: string } | null;
    fares: Array<{ category?: string | null; priceMga: number }>;
  }): Record<string, unknown> {
    const prices = trip.fares.map((f) => f.priceMga);

    return {
      id: trip.id,
      cooperativeId: trip.cooperativeId,
      routeId: trip.routeId,
      scheduleId: trip.scheduleId ?? null,
      vehicleId: trip.vehicleId,
      departureAt: trip.departureAt.toISOString(),
      arrivalEstimatedAt: trip.arrivalEstimatedAt?.toISOString() ?? null,
      status: trip.status,
      openedForBookingAt: trip.openedForBookingAt?.toISOString() ?? null,
      closedForBookingAt: trip.closedForBookingAt?.toISOString() ?? null,
      notesFr: trip.notesFr ?? null,
      notesMg: trip.notesMg ?? null,
      fareMinMga: prices.length ? Math.min(...prices) : null,
      fareMaxMga: prices.length ? Math.max(...prices) : null,
      route: {
        originCity: {
          id: trip.route.origin.id,
          nameFr: trip.route.origin.nameFr,
          nameMg: trip.route.origin.nameMg,
          district: trip.route.origin.district,
          region: trip.route.origin.region,
        },
        destinationCity: {
          id: trip.route.destination.id,
          nameFr: trip.route.destination.nameFr,
          nameMg: trip.route.destination.nameMg,
          district: trip.route.destination.district,
          region: trip.route.destination.region,
        },
      },
      vehicle: {
        id: trip.vehicle.id,
        displayName: trip.vehicle.displayName,
        capacity: trip.vehicle.capacity,
        seatMapId: trip.vehicle.seatMap.id,
      },
      schedule: trip.schedule
        ? {
            id: trip.schedule.id,
            daysOfWeek: trip.schedule.daysOfWeek,
            departureTime: trip.schedule.departureTime,
          }
        : null,
      fares: trip.fares.map((f) => ({ category: f.category, priceMga: f.priceMga })),
      createdAt: trip.createdAt.toISOString(),
      updatedAt: trip.updatedAt.toISOString(),
    };
  }

  // ----------------------------------------------------------------
  // PATCH /coop/trips/:tripInstanceId — modifier un trajet (DRAFT only)
  // ----------------------------------------------------------------

  async updateTrip(
    cooperativeId: string,
    tripInstanceId: string,
    input: UpdateTripInput,
  ): Promise<Record<string, unknown>> {
    const trip = await this.db.tripInstance.findFirst({
      where: { id: tripInstanceId, cooperativeId },
    });
    if (!trip) throw new NotFoundError('Trajet introuvable');

    const err = new Error('Seuls les trajets en statut DRAFT peuvent être modifiés') as NodeJS.ErrnoException;
    err.code = 'CONFLICT';
    if (trip.status !== 'DRAFT') throw err;

    const data: Record<string, unknown> = {};
    if (input.vehicleId !== undefined) data.vehicleId = input.vehicleId;
    if (input.departureAt !== undefined) data.departureAt = new Date(input.departureAt);
    if (input.arrivalEstimatedAt !== undefined) data.arrivalEstimatedAt = input.arrivalEstimatedAt ? new Date(input.arrivalEstimatedAt) : null;
    if (input.notesFr !== undefined) data.notesFr = input.notesFr;
    if (input.notesMg !== undefined) data.notesMg = input.notesMg;

    const updated = await this.db.tripInstance.update({
      where: { id: tripInstanceId },
      data,
      include: {
        route: { include: { origin: true, destination: true } },
        vehicle: true,
        schedule: true,
        fares: true,
      },
    });

    return this._formatTripSummary(updated);
  }

  // ----------------------------------------------------------------
  // DELETE /coop/trips/:tripInstanceId — annuler (→ CANCELLED)
  // Bloqué si des réservations CONFIRMED existent.
  // ----------------------------------------------------------------

  async cancelTrip(
    cooperativeId: string,
    tripInstanceId: string,
  ): Promise<{ cancelledBookings: number }> {
    const trip = await this.db.tripInstance.findFirst({
      where: { id: tripInstanceId, cooperativeId },
    });
    if (!trip) throw new NotFoundError('Trajet introuvable');

    if (trip.status === 'CANCELLED') {
      // Déjà annulé : suppression physique de la base
      await this.db.tripInstance.delete({ where: { id: tripInstanceId } });
      return { cancelledBookings: 0 };
    }

    // Charger toutes les réservations actives avec les infos passager pour notif
    const activeBookings = await this.db.booking.findMany({
      where: {
        tripInstanceId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT] },
      },
      include: {
        buyer: { select: { phone: true, preferredLang: true } },
        passengers: { take: 1, select: { phone: true } },
        seats: { where: { isActive: true }, select: { seatDefinitionId: true } },
      },
    });

    // Transaction : annuler réservations + désactiver sièges + marquer trajet
    await this.db.$transaction(async (tx) => {
      if (activeBookings.length > 0) {
        const bookingIds = activeBookings.map((b) => b.id);

        await tx.booking.updateMany({
          where: { id: { in: bookingIds } },
          data: {
            status: BookingStatus.CANCELLED_AT_COUNTER,
            cancelledAt: new Date(),
            cancelledReason: 'Trajet annulé par la coopérative',
          },
        });

        await tx.bookingSeat.updateMany({
          where: { bookingId: { in: bookingIds }, isActive: true },
          data: { isActive: false },
        });

        await tx.auditLog.create({
          data: {
            action: AuditAction.BOOKING_CANCELLED_AT_COUNTER,
            entityType: 'TripInstance',
            entityId: tripInstanceId,
            before: { status: trip.status },
            after: {
              status: 'CANCELLED',
              cancelledBookings: activeBookings.length,
            },
          },
        });
      }

      await tx.tripInstance.update({
        where: { id: tripInstanceId },
        data: { status: 'CANCELLED' },
      });
    });

    // Pub/Sub SEAT_RELEASED pour les clients WebSocket (hors transaction)
    if (this.redis) {
      for (const booking of activeBookings) {
        const seatIds = booking.seats.map((s) => s.seatDefinitionId);
        if (seatIds.length > 0) {
          await this.redis.publish(
            `trip:${tripInstanceId}`,
            JSON.stringify({
              event: 'SEAT_RELEASED',
              tripInstanceId,
              seatDefinitionIds: seatIds,
              bookingId: booking.id,
            }),
          );
        }
      }
    }

    // Notifications SMS BOOKING_CANCELLED (async — ne bloque pas la réponse)
    for (const booking of activeBookings) {
      const phone = booking.buyer?.phone ?? booking.passengers[0]?.phone;
      if (!phone) continue;
      const lang = (booking.buyer?.preferredLang ?? 'FR') as 'FR' | 'MG';
      enqueueSms({
        phone,
        lang,
        templateCode: 'BOOKING_CANCELLED',
        params: { reference: booking.reference },
        bookingId: booking.id,
        isTransactional: true,
      }).catch((e: unknown) =>
        console.error('[TripsService] cancelTrip SMS error', e),
      );
    }

    return { cancelledBookings: activeBookings.length };
  }

  // ----------------------------------------------------------------
  // DELETE /coop/routes/:routeId — désactiver une route
  // Bloqué si trajets actifs (non CANCELLED/COMPLETED) existent.
  // ----------------------------------------------------------------

  async deleteRoute(
    cooperativeId: string,
    routeId: string,
  ): Promise<void> {
    const route = await this.db.route.findFirst({
      where: { id: routeId, cooperativeId },
    });
    if (!route) throw new NotFoundError('Route introuvable');

    const activeTrips = await this.db.tripInstance.count({
      where: {
        routeId,
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
      },
    });

    if (activeTrips > 0) {
      const err = new Error(`Impossible de supprimer : ${activeTrips} trajet(s) actif(s) sur cette route`) as NodeJS.ErrnoException;
      err.code = 'CONFLICT';
      throw err;
    }

    await this.db.route.update({
      where: { id: routeId },
      data: { isActive: false },
    });
  }

  // ----------------------------------------------------------------
  // DELETE /coop/schedules/:scheduleId — supprimer un gabarit
  // Bloqué si trajets actifs existent.
  // ----------------------------------------------------------------

  async deleteSchedule(
    cooperativeId: string,
    scheduleId: string,
  ): Promise<void> {
    const schedule = await this.db.schedule.findFirst({
      where: { id: scheduleId, cooperativeId },
    });
    if (!schedule) throw new NotFoundError('Gabarit introuvable');

    const activeTrips = await this.db.tripInstance.count({
      where: {
        scheduleId,
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
      },
    });

    if (activeTrips > 0) {
      const err = new Error(`Impossible de supprimer : ${activeTrips} trajet(s) actif(s) sur ce gabarit`) as NodeJS.ErrnoException;
      err.code = 'CONFLICT';
      throw err;
    }

    await this.db.schedule.delete({ where: { id: scheduleId } });
  }
}
