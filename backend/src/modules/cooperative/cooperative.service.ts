import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { CooperativeRole } from '@prisma/client';
import type {
  InviteMemberInput,
  UpdateMemberInput,
  CreateVehicleInput,
  UpdateVehicleInput,
  UpdateCooperativeInput,
  UpsertPolicyInput,
  CreateSeatMapInput,
  UpdateSeatMapInput,
  DashboardQuery,
} from './cooperative.schema';

// =====================================================================
// CooperativeService — back-office coopérative
// Contrat : docs/contrat-api.yaml §Cooperative (membres, véhicules)
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
// Helpers internes
// ------------------------------------------------------------------

/** Durée de validité des invitations : 7 jours. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateInvitationToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

export class CooperativeService {
  constructor(private readonly db: PrismaClient) {}

  // ----------------------------------------------------------------
  // Résoudre le membership actif d'un utilisateur dans sa coopérative.
  // Rôles acceptés : tous les rôles COOP_* par défaut.
  // Lève ForbiddenError si l'utilisateur n'a pas de membership actif.
  // ----------------------------------------------------------------

  async requireMembership(
    userId: string,
    allowedRoles: CooperativeRole[] = [
      CooperativeRole.COOP_ADMIN,
      CooperativeRole.COOP_ASSISTANT,
      CooperativeRole.COOP_DRIVER,
      CooperativeRole.COOP_CONTROLLER,
    ],
  ): Promise<{ membershipId: string; cooperativeId: string; role: CooperativeRole }> {
    const membership = await this.db.membership.findFirst({
      where: { userId, active: true, role: { in: allowedRoles } },
      select: { id: true, cooperativeId: true, role: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!membership) {
      throw new ForbiddenError(
        'Accès réservé aux membres actifs de la coopérative',
      );
    }

    // H-3 : vérifier que la coopérative est active (VALIDATED) — bloquer si suspendue
    const cooperative = await this.db.cooperative.findUnique({
      where: { id: membership.cooperativeId },
      select: { status: true },
    });

    if (cooperative && cooperative.status !== 'VALIDATED') {
      const err = new Error('Cooperative is not active');
      (err as NodeJS.ErrnoException).code = 'COOPERATIVE_SUSPENDED';
      throw err;
    }

    return {
      membershipId: membership.id,
      cooperativeId: membership.cooperativeId,
      role: membership.role,
    };
  }

  // ----------------------------------------------------------------
  // GET /coop/cooperatives/current (alias: GET /coop/me)
  // ----------------------------------------------------------------

  async getCoopMe(userId: string): Promise<Record<string, unknown>> {
    const { cooperativeId } = await this.requireMembership(userId);

    const coop = await this.db.cooperative.findUnique({
      where: { id: cooperativeId },
      include: {
        policies: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
        pricingPlans: {
          where: {
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!coop) {
      throw new NotFoundError('Coopérative introuvable');
    }

    return this._formatCoop(coop);
  }

  // ----------------------------------------------------------------
  // PATCH /coop/cooperatives/current
  // ----------------------------------------------------------------

  async updateCoopMe(
    userId: string,
    input: UpdateCooperativeInput,
  ): Promise<Record<string, unknown>> {
    const { cooperativeId } = await this.requireMembership(userId, ['COOP_ADMIN']);

    const data: Record<string, unknown> = {};
    if (input.displayName !== undefined) data.displayName = input.displayName || undefined;
    if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail || null;
    if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone || null;
    if (input.descriptionFr !== undefined) data.descriptionFr = input.descriptionFr || null;
    if (input.descriptionMg !== undefined) data.descriptionMg = input.descriptionMg || null;
    if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl || null;

    const updated = await this.db.cooperative.update({
      where: { id: cooperativeId },
      data,
    });

    return this._formatCoop(updated);
  }

  // ----------------------------------------------------------------
  // GET /coop/policies/current
  // ----------------------------------------------------------------

  async getPolicy(cooperativeId: string): Promise<Record<string, unknown> | null> {
    const policy = await this.db.cooperativePolicy.findFirst({
      where: { cooperativeId, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!policy) return null;
    return this._formatPolicy(policy);
  }

  // ----------------------------------------------------------------
  // PUT /coop/policies/current — upsert (crée ou incrémente la version)
  // ----------------------------------------------------------------

  async upsertPolicy(
    cooperativeId: string,
    input: UpsertPolicyInput,
  ): Promise<Record<string, unknown>> {
    const existing = await this.db.cooperativePolicy.findFirst({
      where: { cooperativeId, isActive: true },
      orderBy: { version: 'desc' },
    });

    let policy;
    if (existing) {
      policy = await this.db.cooperativePolicy.update({
        where: { id: existing.id },
        data: {
          titleFr: input.titleFr,
          titleMg: input.titleMg,
          bodyFr: input.bodyFr,
          bodyMg: input.bodyMg,
          version: { increment: 1 },
        },
      });
    } else {
      policy = await this.db.cooperativePolicy.create({
        data: {
          cooperativeId,
          titleFr: input.titleFr,
          titleMg: input.titleMg,
          bodyFr: input.bodyFr,
          bodyMg: input.bodyMg,
          version: 1,
          isActive: true,
        },
      });
    }

    return this._formatPolicy(policy);
  }

  private _formatPolicy(p: {
    id: string;
    titleFr: string;
    titleMg: string;
    bodyFr: string;
    bodyMg: string;
    version: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Record<string, unknown> {
    return {
      id: p.id,
      titleFr: p.titleFr,
      titleMg: p.titleMg,
      bodyFr: p.bodyFr,
      bodyMg: p.bodyMg,
      version: p.version,
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  // ----------------------------------------------------------------
  // GET /coop/members
  // ----------------------------------------------------------------

  async getMembers(cooperativeId: string): Promise<unknown[]> {
    const members = await this.db.membership.findMany({
      where: { cooperativeId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            travelerProfile: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      role: m.role,
      active: m.active,
      createdAt: m.createdAt.toISOString(),
      user: {
        email: m.user.email ?? null,
        phone: m.user.phone ?? null,
        firstName: m.user.travelerProfile?.firstName ?? null,
        lastName: m.user.travelerProfile?.lastName ?? null,
      },
    }));
  }

  // ----------------------------------------------------------------
  // POST /coop/members — Inviter un membre
  // Crée une Invitation (le token brut serait envoyé par SMS/email dans
  // un vrai déploiement via le module notifications — non implémenté ici).
  // Hypothèse : le raw token est retourné dans la réponse pour
  // l'intégration initiale (à retirer en production).
  // ----------------------------------------------------------------

  async inviteMember(
    cooperativeId: string,
    senderUserId: string,
    input: InviteMemberInput,
  ): Promise<Record<string, unknown>> {
    // Vérifier qu'il n'existe pas déjà un membre actif avec le même email/phone
    if (input.email) {
      const existing = await this.db.user.findUnique({
        where: { email: input.email },
        include: {
          memberships: {
            where: { cooperativeId, active: true },
          },
        },
      });
      if (existing?.memberships.length) {
        throw new ConflictError('Cet utilisateur est déjà membre de la coopérative');
      }
    }

    // Invitation valide 7 jours
    const { raw, hash } = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const invitation = await this.db.invitation.create({
      data: {
        cooperativeId,
        role: input.role as CooperativeRole,
        email: input.email ?? null,
        phone: input.phone ?? null,
        tokenHash: hash,
        senderUserId,
        expiresAt,
      },
    });

    return {
      id: invitation.id,
      cooperativeId: invitation.cooperativeId,
      role: invitation.role,
      email: invitation.email ?? null,
      phone: invitation.phone ?? null,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      // Le raw token est fourni ici pour permettre aux tests d'acceptance
      // et à l'intégration initiale. En production, il serait envoyé par SMS/email.
      _invitationToken: raw,
    };
  }

  // ----------------------------------------------------------------
  // PATCH /coop/members/:memberId
  // ----------------------------------------------------------------

  async updateMember(
    cooperativeId: string,
    memberId: string,
    input: UpdateMemberInput,
  ): Promise<Record<string, unknown>> {
    const member = await this.db.membership.findFirst({
      where: { id: memberId, cooperativeId },
    });

    if (!member) {
      throw new NotFoundError('Membre introuvable');
    }

    const updated = await this.db.membership.update({
      where: { id: memberId },
      data: {
        ...(input.role ? { role: input.role as CooperativeRole } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            travelerProfile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    return {
      membershipId: updated.id,
      userId: updated.userId,
      role: updated.role,
      active: updated.active,
      updatedAt: updated.updatedAt.toISOString(),
      user: {
        email: updated.user.email ?? null,
        phone: updated.user.phone ?? null,
        firstName: updated.user.travelerProfile?.firstName ?? null,
        lastName: updated.user.travelerProfile?.lastName ?? null,
      },
    };
  }

  // ----------------------------------------------------------------
  // GET /coop/vehicles
  // ----------------------------------------------------------------

  async getVehicles(cooperativeId: string): Promise<unknown[]> {
    const vehicles = await this.db.vehicle.findMany({
      where: { cooperativeId },
      include: {
        seatMap: {
          include: { seats: { orderBy: [{ row: 'asc' }, { column: 'asc' }] } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return vehicles.map((v) => this._formatVehicle(v));
  }

  // ----------------------------------------------------------------
  // POST /coop/vehicles
  // Crée Vehicle + SeatMap + SeatDefinition[] en une seule transaction.
  // Si la plaque est déjà utilisée par la même coopérative → 409.
  // ----------------------------------------------------------------

  async createVehicle(
    cooperativeId: string,
    input: CreateVehicleInput,
  ): Promise<Record<string, unknown>> {
    // Unicité immatriculation au sein de la coopérative
    const existing = await this.db.vehicle.findFirst({
      where: { cooperativeId, registration: input.licensePlate },
    });
    if (existing) {
      throw new ConflictError(
        `Immatriculation ${input.licensePlate} déjà enregistrée pour cette coopérative`,
      );
    }

    const vehicle = await this.db.$transaction(async (tx) => {
      // 1. Créer le SeatMap
      const seatMap = await tx.seatMap.create({
        data: {
          cooperativeId,
          name: `Plan ${input.name}`,
          capacity: input.capacity,
          layout: {
            rows: input.seatMap.rows,
            cols: input.seatMap.cols,
          },
        },
      });

      // 2. Créer les SeatDefinitions
      await tx.seatDefinition.createMany({
        data: input.seatMap.seats.map((s) => ({
          seatMapId: seatMap.id,
          code: s.code,
          category: s.category,
          row: s.row ?? null,
          column: s.col ?? null,
        })),
      });

      // 3. Créer le Vehicle lié au SeatMap
      const v = await tx.vehicle.create({
        data: {
          cooperativeId,
          seatMapId: seatMap.id,
          registration: input.licensePlate,
          displayName: input.name,
          model: input.model ?? null,
          capacity: input.capacity,
          isActive: true,
        },
        include: {
          seatMap: {
            include: { seats: { orderBy: [{ row: 'asc' }, { column: 'asc' }] } },
          },
        },
      });

      return v;
    });

    return this._formatVehicle(vehicle);
  }

  // ----------------------------------------------------------------
  // GET /coop/vehicles/:vehicleId
  // ----------------------------------------------------------------

  async getVehicle(
    cooperativeId: string,
    vehicleId: string,
  ): Promise<Record<string, unknown>> {
    const vehicle = await this.db.vehicle.findFirst({
      where: { id: vehicleId, cooperativeId },
      include: {
        seatMap: {
          include: { seats: { orderBy: [{ row: 'asc' }, { column: 'asc' }] } },
        },
      },
    });

    if (!vehicle) {
      throw new NotFoundError('Véhicule introuvable');
    }

    return this._formatVehicle(vehicle);
  }

  // ----------------------------------------------------------------
  // PATCH /coop/vehicles/:vehicleId
  // ----------------------------------------------------------------

  async updateVehicle(
    cooperativeId: string,
    vehicleId: string,
    input: UpdateVehicleInput,
  ): Promise<Record<string, unknown>> {
    const existing = await this.db.vehicle.findFirst({
      where: { id: vehicleId, cooperativeId },
    });
    if (!existing) throw new NotFoundError('Véhicule introuvable');

    if (input.registration) {
      const conflict = await this.db.vehicle.findFirst({
        where: { cooperativeId, registration: input.registration, id: { not: vehicleId } },
      });
      if (conflict) throw new ConflictError(`Immatriculation ${input.registration} déjà utilisée`);
    }

    const updated = await this.db.vehicle.update({
      where: { id: vehicleId },
      data: {
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.displayName !== undefined && { displayName: input.displayName }),
        ...(input.registration !== undefined && { registration: input.registration }),
        ...(input.model !== undefined && { model: input.model }),
      },
      include: {
        seatMap: {
          include: { seats: { orderBy: [{ row: 'asc' }, { column: 'asc' }] } },
        },
      },
    });

    return this._formatVehicle(updated);
  }

  // ----------------------------------------------------------------
  // Formatage DTOs
  // ----------------------------------------------------------------

  private _formatCoop(
    coop: {
      id: string;
      slug: string;
      legalName: string;
      displayName: string;
      status: string;
      contactEmail?: string | null;
      contactPhone?: string | null;
      logoUrl?: string | null;
      descriptionFr?: string | null;
      descriptionMg?: string | null;
      ratingAverage: number;
      ratingCount: number;
      validatedAt?: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
  ): Record<string, unknown> {
    return {
      id: coop.id,
      slug: coop.slug,
      legalName: coop.legalName,
      displayName: coop.displayName,
      status: coop.status,
      contactEmail: coop.contactEmail ?? null,
      contactPhone: coop.contactPhone ?? null,
      logoUrl: coop.logoUrl ?? null,
      descriptionFr: coop.descriptionFr ?? null,
      descriptionMg: coop.descriptionMg ?? null,
      ratingAverage: coop.ratingAverage,
      ratingCount: coop.ratingCount,
      validatedAt: coop.validatedAt?.toISOString() ?? null,
      createdAt: coop.createdAt.toISOString(),
      updatedAt: coop.updatedAt.toISOString(),
    };
  }

  private _formatVehicle(v: {
    id: string;
    cooperativeId: string;
    registration: string;
    displayName: string;
    model?: string | null;
    capacity: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    seatMap: {
      id: string;
      name: string;
      capacity: number;
      layout: unknown;
      seats: Array<{
        id: string;
        code: string;
        category: string;
        row?: number | null;
        column?: number | null;
      }>;
    };
  }): Record<string, unknown> {
    return {
      id: v.id,
      cooperativeId: v.cooperativeId,
      registration: v.registration,
      displayName: v.displayName,
      model: v.model ?? null,
      capacity: v.capacity,
      isActive: v.isActive,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      seatMap: {
        id: v.seatMap.id,
        name: v.seatMap.name,
        capacity: v.seatMap.capacity,
        layout: v.seatMap.layout,
        seats: v.seatMap.seats.map((s) => ({
          id: s.id,
          code: s.code,
          category: s.category,
          row: s.row ?? null,
          column: s.column ?? null,
        })),
      },
    };
  }

  // ----------------------------------------------------------------
  // DELETE /coop/members/:memberId — désactiver un membre
  // ----------------------------------------------------------------

  async deleteMember(
    cooperativeId: string,
    memberId: string,
  ): Promise<void> {
    const membership = await this.db.membership.findFirst({
      where: { id: memberId, cooperativeId },
    });
    if (!membership) throw new NotFoundError('Membre introuvable');

    await this.db.membership.update({
      where: { id: memberId },
      data: { active: false },
    });
  }

  // ----------------------------------------------------------------
  // DELETE /coop/vehicles/:vehicleId — désactiver un véhicule
  // Bloqué si des trajets actifs (non CANCELLED/COMPLETED) utilisent ce véhicule.
  // ----------------------------------------------------------------

  async deleteVehicle(
    cooperativeId: string,
    vehicleId: string,
  ): Promise<void> {
    const vehicle = await this.db.vehicle.findFirst({
      where: { id: vehicleId, cooperativeId },
    });
    if (!vehicle) throw new NotFoundError('Véhicule introuvable');

    const activeTrips = await this.db.tripInstance.count({
      where: {
        vehicleId,
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
      },
    });

    if (activeTrips > 0) {
      const err = new Error(`Impossible de supprimer : ${activeTrips} trajet(s) actif(s) utilise(nt) ce véhicule`) as NodeJS.ErrnoException;
      err.code = 'CONFLICT';
      throw err;
    }

    await this.db.vehicle.update({
      where: { id: vehicleId },
      data: { isActive: false },
    });
  }

  // ================================================================
  // GAP A — Plans de sièges (/coop/seat-maps)
  // ================================================================

  async listSeatMaps(cooperativeId: string): Promise<unknown[]> {
    const maps = await this.db.seatMap.findMany({
      where: { cooperativeId },
      include: { seats: { orderBy: [{ row: 'asc' }, { column: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });
    return maps.map((m) => this._formatSeatMap(m));
  }

  async createSeatMap(
    cooperativeId: string,
    input: CreateSeatMapInput,
  ): Promise<Record<string, unknown>> {
    const capacity = input.seats.length;
    const seatMap = await this.db.$transaction(async (tx) => {
      const sm = await tx.seatMap.create({
        data: {
          cooperativeId,
          name: input.name,
          capacity,
          layout: { rows: input.rows, cols: input.cols },
        },
      });
      await tx.seatDefinition.createMany({
        data: input.seats.map((s) => ({
          seatMapId: sm.id,
          code: s.code,
          category: s.category,
          row: s.row ?? null,
          column: s.col ?? null,
        })),
      });
      return tx.seatMap.findUnique({
        where: { id: sm.id },
        include: { seats: { orderBy: [{ row: 'asc' }, { column: 'asc' }] } },
      });
    });
    return this._formatSeatMap(seatMap!);
  }

  async getSeatMap(
    cooperativeId: string,
    seatMapId: string,
  ): Promise<Record<string, unknown>> {
    const sm = await this.db.seatMap.findFirst({
      where: { id: seatMapId, cooperativeId },
      include: { seats: { orderBy: [{ row: 'asc' }, { column: 'asc' }] } },
    });
    if (!sm) throw new NotFoundError('Plan de sièges introuvable');
    return this._formatSeatMap(sm);
  }

  async updateSeatMap(
    cooperativeId: string,
    seatMapId: string,
    input: UpdateSeatMapInput,
  ): Promise<Record<string, unknown>> {
    const existing = await this.db.seatMap.findFirst({
      where: { id: seatMapId, cooperativeId },
    });
    if (!existing) throw new NotFoundError('Plan de sièges introuvable');

    const updated = await this.db.seatMap.update({
      where: { id: seatMapId },
      data: { name: input.name },
      include: { seats: { orderBy: [{ row: 'asc' }, { column: 'asc' }] } },
    });
    return this._formatSeatMap(updated);
  }

  async deleteSeatMap(cooperativeId: string, seatMapId: string): Promise<void> {
    const existing = await this.db.seatMap.findFirst({
      where: { id: seatMapId, cooperativeId },
    });
    if (!existing) throw new NotFoundError('Plan de sièges introuvable');

    const vehicleCount = await this.db.vehicle.count({
      where: { seatMapId, isActive: true },
    });
    if (vehicleCount > 0) {
      throw new ConflictError(
        `Plan utilisé par ${vehicleCount} véhicule(s) actif(s) — désactiver les véhicules d'abord`,
      );
    }
    await this.db.seatMap.delete({ where: { id: seatMapId } });
  }

  private _formatSeatMap(sm: {
    id: string;
    cooperativeId: string;
    name: string;
    capacity: number;
    layout: unknown;
    createdAt: Date;
    updatedAt: Date;
    seats: Array<{ id: string; code: string; category: string; row?: number | null; column?: number | null }>;
  }): Record<string, unknown> {
    return {
      id: sm.id,
      cooperativeId: sm.cooperativeId,
      name: sm.name,
      capacity: sm.capacity,
      layout: sm.layout,
      createdAt: sm.createdAt.toISOString(),
      updatedAt: sm.updatedAt.toISOString(),
      seats: sm.seats.map((s) => ({
        id: s.id,
        code: s.code,
        category: s.category,
        row: s.row ?? null,
        column: s.column ?? null,
      })),
    };
  }

  // ================================================================
  // GAP B — Tableau de bord (/coop/dashboard)
  // ================================================================

  async getCoopDashboard(
    cooperativeId: string,
    query: DashboardQuery,
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = query.to ? new Date(query.to) : now;

    const [bookingAgg, bookingsByChannel, upcomingTrips, totalTrips] = await Promise.all([
      this.db.booking.aggregate({
        where: {
          cooperativeId,
          status: 'CONFIRMED',
          confirmedAt: { gte: from, lte: to },
        },
        _count: { id: true },
        _sum: { seatSubtotalMga: true, platformFeeMga: true, totalAmountMga: true },
      }),
      this.db.booking.groupBy({
        by: ['channel'],
        where: {
          cooperativeId,
          status: 'CONFIRMED',
          confirmedAt: { gte: from, lte: to },
        },
        _count: { id: true },
      }),
      this.db.tripInstance.count({
        where: {
          cooperativeId,
          status: 'OPEN_FOR_BOOKING',
          departureAt: { gte: now },
        },
      }),
      this.db.tripInstance.findMany({
        where: {
          cooperativeId,
          departureAt: { gte: from, lte: to },
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
        include: {
          vehicle: { select: { capacity: true } },
          _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
        },
      }),
    ]);

    const totalCapacity = totalTrips.reduce((s, t) => s + (t.vehicle?.capacity ?? 0), 0);
    const totalConfirmedSeats = totalTrips.reduce((s, t) => s + (t._count?.bookings ?? 0), 0);
    const occupancyRate = totalCapacity > 0
      ? totalConfirmedSeats / totalCapacity
      : 0;

    const bookingsOnline = bookingsByChannel.find((g) => g.channel === 'ONLINE')?._count.id ?? 0;
    const bookingsWalkIn = bookingsByChannel.find((g) => g.channel === 'WALK_IN')?._count.id ?? 0;
    const revenueGrossMga = bookingAgg._sum.seatSubtotalMga ?? 0;
    const revenueNetMga = revenueGrossMga - (bookingAgg._sum.platformFeeMga ?? 0);

    return {
      periodStart: from.toISOString(),
      periodEnd: to.toISOString(),
      bookingsOnline,
      bookingsWalkIn,
      revenueGrossMga,
      revenueNetMga,
      occupancyRate,
      upcomingTrips,
    };
  }

  // ================================================================
  // GAP C — Plan tarifaire actif (/coop/pricing-plan)
  // ================================================================

  async getCoopPricingPlan(cooperativeId: string): Promise<Record<string, unknown> | null> {
    const now = new Date();
    const plan = await this.db.cooperativePricingPlan.findFirst({
      where: {
        cooperativeId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!plan) return null;
    return {
      id: plan.id,
      type: plan.type,
      commissionRate: plan.commissionRate ?? null,
      monthlyFeeMga: plan.monthlyFeeMga ?? null,
      effectiveFrom: plan.effectiveFrom.toISOString(),
      effectiveUntil: plan.effectiveUntil?.toISOString() ?? null,
      createdAt: plan.createdAt.toISOString(),
    };
  }

  // ================================================================
  // GAP D — Abonnements (/coop/subscriptions)
  // ================================================================

  async getCoopSubscriptions(cooperativeId: string): Promise<unknown[]> {
    const subs = await this.db.cooperativeSubscription.findMany({
      where: { cooperativeId },
      orderBy: { periodStart: 'desc' },
    });
    return subs.map((s) => ({
      id: s.id,
      periodStart: s.periodStart.toISOString(),
      periodEnd: s.periodEnd.toISOString(),
      amountMga: s.amountMga,
      status: s.status,
      paidAt: s.paidAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  // ================================================================
  // GAP E — Commissions (/coop/commissions)
  // Liste les commissions prélevées pour le plan COMMISSION
  // ================================================================

  async getCoopCommissions(cooperativeId: string): Promise<unknown[]> {
    const commissions = await this.db.commission.findMany({
      where: { cooperativeId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        booking: {
          select: {
            id: true,
            reference: true,
            status: true,
            seatSubtotalMga: true,
            passengers: {
              take: 1,
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    });
    return commissions.map((c) => ({
      id: c.id,
      bookingId: c.bookingId,
      bookingRef: c.booking.reference,
      bookingStatus: c.booking.status,
      passengerName: c.booking.passengers[0]
        ? `${c.booking.passengers[0].firstName} ${c.booking.passengers[0].lastName}`.trim()
        : null,
      seatSubtotalMga: c.booking.seatSubtotalMga,
      amountMga: c.amountMga,
      pricingPlanRef: c.pricingPlanRef ?? null,
      createdAt: c.createdAt.toISOString(),
    }));
  }
}
