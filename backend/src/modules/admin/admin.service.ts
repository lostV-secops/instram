// =====================================================================
// admin.service.ts — Logique métier du module Admin
//
// Périmètre : validation/suspension coopératives, plans tarifaires,
//             abonnements, modération avis, gestion utilisateurs,
//             supervision globale, journal d'audit.
//
// Contraintes respectées :
//   - AuditLog sur : validate/suspend/reject coop, changement plan,
//     suspension utilisateur, modération avis (RG-13 / architecture §7.4).
//   - admin peut lire tout, écrire dans cooperatives, users, ratings
//     (architecture §3).
//   - Walk-in toujours gratuit ; aucun remboursement via l'API.
//   - Console admin FR uniquement (architecture §7.3 / CDC §5.6).
//
// Hypothèses : voir admin.schema.ts (H-ADM-01 à H-ADM-08).
// =====================================================================

import type {
  PrismaClient,
  Cooperative,
  CooperativePricingPlan,
  CooperativeSubscription,
  Rating,
  AuditLog,
} from '@prisma/client';
import {
  PlatformRole,
  CooperativeStatus,
  PricingPlanType,
  SubscriptionStatus,
  RatingStatus,
  AuditAction,
  UserStatus,
} from '@prisma/client';
import type {
  ListCooperativesQuery,
  SuspendRejectBody,
  CreatePricingPlanBody,
  CreateSubscriptionBody,
  ModerateRatingBody,
  ListUsersQuery,
  SuspendUserBody,
  AuditLogQuery,
  ListRatingsQuery,
  ListTripsQuery,
  ListPaymentsQuery,
  UpdateSettingsBody,
} from './admin.schema';

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

// =====================================================================
// Interfaces internes
// =====================================================================

export interface AdminContext {
  actorUserId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AdminStats {
  cooperatives: {
    total: number;
    pending: number;
    validated: number;
    suspended: number;
  };
  bookings: {
    today: number;
    thisMonth: number;
  };
  revenue: {
    thisMonth: number;
    currency: 'MGA';
  };
  activeTrips: number;
  pendingRatings: number;
}

export interface AdminProfile {
  id: string;
  userId: string;
  role: PlatformRole;
}

// =====================================================================
// Service
// =====================================================================

export class AdminService {
  /** Commission par défaut pour les nouvelles coopératives validées (VH-04 = 4 %). */
  private static readonly DEFAULT_COMMISSION_RATE = 4;

  constructor(private readonly db: PrismaClient) {}

  // ------------------------------------------------------------------
  // Vérification du profil admin
  // Lève ForbiddenError si l'utilisateur n'a pas d'AdminProfile
  // ou si son rôle ne figure pas dans allowedRoles.
  // ------------------------------------------------------------------

  async requireAdminProfile(
    userId: string,
    allowedRoles: PlatformRole[] = [
      PlatformRole.ADMIN_SUPER,
      PlatformRole.ADMIN_OPS,
      PlatformRole.ADMIN_MODERATOR,
    ],
  ): Promise<AdminProfile> {
    const profile = await this.db.adminProfile.findUnique({
      where: { userId },
      select: { id: true, userId: true, role: true },
    });

    if (!profile) {
      throw new ForbiddenError(
        'Accès refusé : aucun profil administrateur associé à ce compte.',
      );
    }

    if (!allowedRoles.includes(profile.role)) {
      throw new ForbiddenError(
        `Accès refusé : rôle ${profile.role} insuffisant pour cette action. Rôles requis : ${allowedRoles.join(', ')}.`,
      );
    }

    return profile;
  }

  // ------------------------------------------------------------------
  // Helper : écriture d'un AuditLog (append-only — architecture §7.4)
  // ------------------------------------------------------------------

  private async writeAuditLog(
    tx: PrismaClient,
    params: {
      actorUserId: string | null;
      action: AuditAction;
      entityType: string;
      entityId?: string;
      before?: object | null;
      after?: object | null;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        before: params.before ?? undefined,
        after: params.after ?? undefined,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  }

  // ==================================================================
  // GESTION DES COOPÉRATIVES
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/cooperatives — liste paginée avec filtres
  // ------------------------------------------------------------------

  async listCooperatives(
    query: ListCooperativesQuery,
  ): Promise<PaginatedResult<Cooperative>> {
    const { status, q, cursor, limit } = query;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ...(status ? { status: status as CooperativeStatus } : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' } },
              { legalName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(cursor ? { id: { gt: cursor } } : {}),
    };

    const items = await this.db.cooperative.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = items.length > limit;
    const page = hasNext ? items.slice(0, limit) : items;

    return {
      items: page,
      nextCursor: hasNext ? page[page.length - 1].id : null,
    };
  }

  // ------------------------------------------------------------------
  // GET /admin/cooperatives/:id — détail complet
  // ------------------------------------------------------------------

  async getCooperativeDetail(cooperativeId: string): Promise<object> {
    const cooperative = await this.db.cooperative.findUnique({
      where: { id: cooperativeId },
      include: {
        memberships: {
          where: { active: true },
          include: {
            user: {
              select: { id: true, email: true, phone: true, preferredLang: true },
            },
          },
        },
        vehicles: {
          where: { isActive: true },
          select: {
            id: true,
            registration: true,
            displayName: true,
            model: true,
            capacity: true,
          },
        },
        pricingPlans: {
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            bookings: true,
            tripInstances: true,
          },
        },
      },
    });

    if (!cooperative) {
      throw new NotFoundError(`Coopérative introuvable : ${cooperativeId}`);
    }

    return cooperative;
  }

  // ------------------------------------------------------------------
  // POST /admin/cooperatives/:id/validate — PENDING_VALIDATION → VALIDATED
  // Crée un plan de commission par défaut (VH-04 : 4 %) si aucun plan actif.
  // AuditLog : COOP_VALIDATED
  // ------------------------------------------------------------------

  async validateCooperative(
    cooperativeId: string,
    ctx: AdminContext,
  ): Promise<Cooperative> {
    const cooperative = await this.db.cooperative.findUnique({
      where: { id: cooperativeId },
    });

    if (!cooperative) {
      throw new NotFoundError(`Coopérative introuvable : ${cooperativeId}`);
    }

    if (cooperative.status !== CooperativeStatus.PENDING_VALIDATION) {
      throw new ConflictError(
        `La coopérative est en statut "${cooperative.status}" et ne peut pas être validée. Statut requis : PENDING_VALIDATION.`,
      );
    }

    const now = new Date();

    const updated = await this.db.$transaction(async (tx) => {
      // 1. Mettre à jour le statut
      const updatedCoop = await tx.cooperative.update({
        where: { id: cooperativeId },
        data: {
          status: CooperativeStatus.VALIDATED,
          validatedAt: now,
        },
      });

      // 2. Créer un plan de commission par défaut si aucun plan actif (H-ADM-07)
      const existingPlan = await tx.cooperativePricingPlan.findFirst({
        where: { cooperativeId, effectiveUntil: null },
      });

      if (!existingPlan) {
        await tx.cooperativePricingPlan.create({
          data: {
            cooperativeId,
            type: PricingPlanType.COMMISSION,
            commissionRate: AdminService.DEFAULT_COMMISSION_RATE,
            effectiveFrom: now,
          },
        });
      }

      // 3. AuditLog
      await this.writeAuditLog(tx as unknown as PrismaClient, {
        actorUserId: ctx.actorUserId,
        action: AuditAction.COOP_VALIDATED,
        entityType: 'Cooperative',
        entityId: cooperativeId,
        before: { status: cooperative.status },
        after: { status: CooperativeStatus.VALIDATED },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return updatedCoop;
    });

    return updated;
  }

  // ------------------------------------------------------------------
  // POST /admin/cooperatives/:id/suspend — → SUSPENDED
  // AuditLog : COOP_SUSPENDED
  // ------------------------------------------------------------------

  async suspendCooperative(
    cooperativeId: string,
    body: SuspendRejectBody,
    ctx: AdminContext,
  ): Promise<Cooperative> {
    const cooperative = await this.db.cooperative.findUnique({
      where: { id: cooperativeId },
    });

    if (!cooperative) {
      throw new NotFoundError(`Coopérative introuvable : ${cooperativeId}`);
    }

    if (cooperative.status === CooperativeStatus.SUSPENDED) {
      throw new ConflictError('La coopérative est déjà suspendue.');
    }

    const updated = await this.db.$transaction(async (tx) => {
      const updatedCoop = await tx.cooperative.update({
        where: { id: cooperativeId },
        data: { status: CooperativeStatus.SUSPENDED },
      });

      await this.writeAuditLog(tx as unknown as PrismaClient, {
        actorUserId: ctx.actorUserId,
        action: AuditAction.COOP_SUSPENDED,
        entityType: 'Cooperative',
        entityId: cooperativeId,
        before: { status: cooperative.status },
        after: { status: CooperativeStatus.SUSPENDED, reason: body.reason },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return updatedCoop;
    });

    return updated;
  }

  // ------------------------------------------------------------------
  // POST /admin/cooperatives/:id/reject — PENDING_VALIDATION → REJECTED
  // Extension de la tâche (H-ADM-02) — non dans le contrat API.
  // AuditLog : COOP_SUSPENDED (enum le plus proche disponible, H-ADM-02)
  // ------------------------------------------------------------------

  async rejectCooperative(
    cooperativeId: string,
    body: SuspendRejectBody,
    ctx: AdminContext,
  ): Promise<Cooperative> {
    const cooperative = await this.db.cooperative.findUnique({
      where: { id: cooperativeId },
    });

    if (!cooperative) {
      throw new NotFoundError(`Coopérative introuvable : ${cooperativeId}`);
    }

    if (cooperative.status !== CooperativeStatus.PENDING_VALIDATION) {
      throw new ConflictError(
        `La coopérative est en statut "${cooperative.status}". Seules les coopératives PENDING_VALIDATION peuvent être rejetées.`,
      );
    }

    const updated = await this.db.$transaction(async (tx) => {
      const updatedCoop = await tx.cooperative.update({
        where: { id: cooperativeId },
        data: { status: CooperativeStatus.REJECTED },
      });

      // H-ADM-02 : utilisation de COOP_SUSPENDED car COOP_REJECTED
      // n'existe pas dans l'enum AuditAction du schéma.
      await this.writeAuditLog(tx as unknown as PrismaClient, {
        actorUserId: ctx.actorUserId,
        action: AuditAction.COOP_SUSPENDED,
        entityType: 'Cooperative',
        entityId: cooperativeId,
        before: { status: cooperative.status },
        after: { status: CooperativeStatus.REJECTED, reason: body.reason },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return updatedCoop;
    });

    return updated;
  }

  // ==================================================================
  // PLANS TARIFAIRES
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/cooperatives/:id/pricing — historique des plans
  // ------------------------------------------------------------------

  async listPricingPlans(
    cooperativeId: string,
  ): Promise<CooperativePricingPlan[]> {
    const cooperative = await this.db.cooperative.findUnique({
      where: { id: cooperativeId },
      select: { id: true },
    });

    if (!cooperative) {
      throw new NotFoundError(`Coopérative introuvable : ${cooperativeId}`);
    }

    return this.db.cooperativePricingPlan.findMany({
      where: { cooperativeId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  // ------------------------------------------------------------------
  // PUT /admin/cooperatives/:id/pricing-plan — créer un nouveau plan
  // Clôture l'ancien plan (effectiveUntil = NOW()), crée le nouveau.
  // AuditLog : COOP_PLAN_CHANGED
  // ------------------------------------------------------------------

  async createPricingPlan(
    cooperativeId: string,
    body: CreatePricingPlanBody,
    ctx: AdminContext,
  ): Promise<CooperativePricingPlan> {
    const cooperative = await this.db.cooperative.findUnique({
      where: { id: cooperativeId },
      select: { id: true, status: true },
    });

    if (!cooperative) {
      throw new NotFoundError(`Coopérative introuvable : ${cooperativeId}`);
    }

    const now = new Date();

    const newPlan = await this.db.$transaction(async (tx) => {
      // Clôturer le plan actif (effectiveUntil = null = plan ouvert)
      await tx.cooperativePricingPlan.updateMany({
        where: { cooperativeId, effectiveUntil: null },
        data: { effectiveUntil: now },
      });

      // Créer le nouveau plan
      const plan = await tx.cooperativePricingPlan.create({
        data: {
          cooperativeId,
          type: body.type as PricingPlanType,
          commissionRate: body.commissionRate ?? null,
          monthlyFeeMga: body.monthlyFeeMga ?? null,
          effectiveFrom: new Date(body.effectiveFrom),
        },
      });

      // AuditLog
      await this.writeAuditLog(tx as unknown as PrismaClient, {
        actorUserId: ctx.actorUserId,
        action: AuditAction.COOP_PLAN_CHANGED,
        entityType: 'CooperativePricingPlan',
        entityId: plan.id,
        after: {
          cooperativeId,
          type: body.type,
          commissionRate: body.commissionRate,
          monthlyFeeMga: body.monthlyFeeMga,
          effectiveFrom: body.effectiveFrom,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return plan;
    });

    return newPlan;
  }

  // ==================================================================
  // ABONNEMENTS
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/cooperatives/:id/subscriptions — liste des factures
  // ------------------------------------------------------------------

  async listSubscriptions(
    cooperativeId: string,
  ): Promise<CooperativeSubscription[]> {
    const cooperative = await this.db.cooperative.findUnique({
      where: { id: cooperativeId },
      select: { id: true },
    });

    if (!cooperative) {
      throw new NotFoundError(`Coopérative introuvable : ${cooperativeId}`);
    }

    return this.db.cooperativeSubscription.findMany({
      where: { cooperativeId },
      orderBy: { periodStart: 'desc' },
    });
  }

  // ------------------------------------------------------------------
  // POST /admin/cooperatives/:id/subscriptions — créer une facture
  // ------------------------------------------------------------------

  async createSubscription(
    cooperativeId: string,
    body: CreateSubscriptionBody,
  ): Promise<CooperativeSubscription> {
    const cooperative = await this.db.cooperative.findUnique({
      where: { id: cooperativeId },
      select: { id: true },
    });

    if (!cooperative) {
      throw new NotFoundError(`Coopérative introuvable : ${cooperativeId}`);
    }

    return this.db.cooperativeSubscription.create({
      data: {
        cooperativeId,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
        amountMga: body.amountMga,
        status: SubscriptionStatus.MANUAL,
      },
    });
  }

  // ------------------------------------------------------------------
  // PATCH /admin/subscriptions/:id/mark-paid — marquer payée
  // Extension de la tâche (H-ADM-06) — non dans le contrat API.
  // ------------------------------------------------------------------

  async markSubscriptionPaid(
    subscriptionId: string,
  ): Promise<CooperativeSubscription> {
    const subscription = await this.db.cooperativeSubscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundError(`Abonnement introuvable : ${subscriptionId}`);
    }

    if (subscription.status === SubscriptionStatus.PAID) {
      throw new ConflictError('Cet abonnement est déjà marqué comme payé.');
    }

    return this.db.cooperativeSubscription.update({
      where: { id: subscriptionId },
      data: {
        status: SubscriptionStatus.PAID,
        paidAt: new Date(),
      },
    });
  }

  // ==================================================================
  // MODÉRATION DES AVIS
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/ratings — avis avec filtre de statut
  // ------------------------------------------------------------------

  async listRatings(query: ListRatingsQuery): Promise<PaginatedResult<Rating>> {
    const { status, cursor, limit } = query;

    const where = {
      ...(status
        ? { status: status as RatingStatus }
        : { status: RatingStatus.PENDING_REVIEW }),
      ...(cursor ? { id: { gt: cursor } } : {}),
    };

    const items = await this.db.rating.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, email: true, phone: true } },
        cooperative: { select: { id: true, displayName: true } },
      },
    });

    const hasNext = items.length > limit;
    const page = hasNext ? items.slice(0, limit) : items;

    return {
      items: page,
      nextCursor: hasNext ? page[page.length - 1].id : null,
    };
  }

  // ------------------------------------------------------------------
  // PATCH /admin/ratings/:id — approuver ou rejeter un avis
  // AuditLog : RATING_MODERATED
  // ------------------------------------------------------------------

  async moderateRating(
    ratingId: string,
    body: ModerateRatingBody,
    ctx: AdminContext,
  ): Promise<Rating> {
    const rating = await this.db.rating.findUnique({
      where: { id: ratingId },
    });

    if (!rating) {
      throw new NotFoundError(`Avis introuvable : ${ratingId}`);
    }

    if (rating.status !== RatingStatus.PENDING_REVIEW) {
      throw new ConflictError(
        `L'avis est déjà en statut "${rating.status}" et ne peut plus être modéré.`,
      );
    }

    const newStatus = body.status as RatingStatus;

    const updated = await this.db.$transaction(async (tx) => {
      const updatedRating = await tx.rating.update({
        where: { id: ratingId },
        data: {
          status: newStatus,
          moderatedAt: new Date(),
          moderatedBy: ctx.actorUserId,
        },
      });

      // Si l'avis est publié, mettre à jour la note moyenne de la coopérative
      if (newStatus === RatingStatus.PUBLISHED) {
        const agg = await tx.rating.aggregate({
          where: {
            cooperativeId: rating.cooperativeId,
            status: RatingStatus.PUBLISHED,
          },
          _avg: { score: true },
          _count: { score: true },
        });

        await tx.cooperative.update({
          where: { id: rating.cooperativeId },
          data: {
            ratingAverage: agg._avg.score ?? 0,
            ratingCount: agg._count.score,
          },
        });
      }

      await this.writeAuditLog(tx as unknown as PrismaClient, {
        actorUserId: ctx.actorUserId,
        action: AuditAction.RATING_MODERATED,
        entityType: 'Rating',
        entityId: ratingId,
        before: { status: rating.status },
        after: {
          status: newStatus,
          moderationNote: body.moderationNote ?? null,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return updatedRating;
    });

    return updated;
  }

  // ==================================================================
  // GESTION DES UTILISATEURS
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/users — liste paginée avec filtres
  // ------------------------------------------------------------------

  async listUsers(query: ListUsersQuery): Promise<PaginatedResult<object>> {
    const { q, status, cursor, limit } = query;

    const where = {
      ...(status ? { status: status as UserStatus } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q } },
            ],
          }
        : {}),
      ...(cursor ? { id: { gt: cursor } } : {}),
    };

    const items = await this.db.user.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
        preferredLang: true,
        createdAt: true,
        lastLoginAt: true,
        adminProfile: { select: { role: true } },
        memberships: {
          where: { active: true },
          select: { role: true, cooperative: { select: { id: true, displayName: true } } },
        },
      },
    });

    const hasNext = items.length > limit;
    const page = hasNext ? items.slice(0, limit) : items;

    return {
      items: page,
      nextCursor: hasNext
        ? (page[page.length - 1] as { id: string }).id
        : null,
    };
  }

  // ------------------------------------------------------------------
  // POST /admin/users/:id/suspend — suspendre un compte
  // AuditLog : ADMIN_ACCESS (H-ADM-03 : USER_SUSPENDED absent de l'enum)
  // ------------------------------------------------------------------

  async suspendUser(
    userId: string,
    body: SuspendUserBody,
    ctx: AdminContext,
  ): Promise<object> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, status: true },
    });

    if (!user) {
      throw new NotFoundError(`Utilisateur introuvable : ${userId}`);
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ConflictError('Ce compte est déjà suspendu.');
    }

    if (user.status === UserStatus.DELETED) {
      throw new ConflictError('Ce compte est supprimé et ne peut pas être suspendu.');
    }

    const updated = await this.db.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { status: UserStatus.SUSPENDED },
        select: {
          id: true,
          email: true,
          phone: true,
          status: true,
          preferredLang: true,
          createdAt: true,
        },
      });

      // H-ADM-03 : ADMIN_ACCESS utilisé faute de USER_SUSPENDED dans l'enum
      await this.writeAuditLog(tx as unknown as PrismaClient, {
        actorUserId: ctx.actorUserId,
        action: AuditAction.ADMIN_ACCESS,
        entityType: 'User',
        entityId: userId,
        before: { status: user.status },
        after: { status: UserStatus.SUSPENDED, reason: body.reason },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return updatedUser;
    });

    return updated;
  }

  // ------------------------------------------------------------------
  // PATCH /admin/users/:id/reinstate — réactiver un compte
  // Extension de la tâche (H-ADM-03) — non dans le contrat API.
  // AuditLog : ADMIN_ACCESS
  // ------------------------------------------------------------------

  async reinstateUser(userId: string, ctx: AdminContext): Promise<object> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, status: true },
    });

    if (!user) {
      throw new NotFoundError(`Utilisateur introuvable : ${userId}`);
    }

    if (user.status !== UserStatus.SUSPENDED) {
      throw new ConflictError(
        `Ce compte est en statut "${user.status}". Seuls les comptes SUSPENDED peuvent être réactivés.`,
      );
    }

    const updated = await this.db.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { status: UserStatus.ACTIVE },
        select: {
          id: true,
          email: true,
          phone: true,
          status: true,
          preferredLang: true,
          createdAt: true,
        },
      });

      await this.writeAuditLog(tx as unknown as PrismaClient, {
        actorUserId: ctx.actorUserId,
        action: AuditAction.ADMIN_ACCESS,
        entityType: 'User',
        entityId: userId,
        before: { status: user.status },
        after: { status: UserStatus.ACTIVE },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return updatedUser;
    });

    return updated;
  }

  // ------------------------------------------------------------------
  // POST /admin/cooperatives/:id/reactivate — SUSPENDED → VALIDATED
  // AuditLog : COOP_VALIDATED
  // ------------------------------------------------------------------

  async reactivateCooperative(
    cooperativeId: string,
    ctx: AdminContext,
  ): Promise<Cooperative> {
    const cooperative = await this.db.cooperative.findUnique({
      where: { id: cooperativeId },
    });

    if (!cooperative) {
      throw new NotFoundError(`Coopérative introuvable : ${cooperativeId}`);
    }

    if (cooperative.status !== CooperativeStatus.SUSPENDED) {
      throw new ConflictError(
        `La coopérative est en statut "${cooperative.status}". Seules les coopératives SUSPENDED peuvent être réactivées.`,
      );
    }

    const updated = await this.db.$transaction(async (tx) => {
      const updatedCoop = await tx.cooperative.update({
        where: { id: cooperativeId },
        data: {
          status: CooperativeStatus.VALIDATED,
          validatedAt: new Date(),
        },
      });

      await this.writeAuditLog(tx as unknown as PrismaClient, {
        actorUserId: ctx.actorUserId,
        action: AuditAction.COOP_VALIDATED,
        entityType: 'Cooperative',
        entityId: cooperativeId,
        before: { status: cooperative.status },
        after: { status: CooperativeStatus.VALIDATED, reason: 'reactivated' },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return updatedCoop;
    });

    return updated;
  }

  // ==================================================================
  // SUPERVISION — TRAJETS
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/trips — liste paginée de tous les trajets
  // ------------------------------------------------------------------

  async listTrips(query: ListTripsQuery): Promise<PaginatedResult<object>> {
    const { status, cooperativeId, from, to, cursor, limit } = query;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ...(status ? { status } : {}),
      ...(cooperativeId ? { cooperativeId } : {}),
      ...(from || to
        ? {
            departureAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
      ...(cursor ? { id: { gt: cursor } } : {}),
    };

    const items = await this.db.tripInstance.findMany({
      where,
      take: limit + 1,
      orderBy: { departureAt: 'desc' },
      select: {
        id: true,
        departureAt: true,
        arrivalEstimatedAt: true,
        status: true,
        actualDepartedAt: true,
        createdAt: true,
        cooperative: { select: { id: true, displayName: true } },
        route: { select: { id: true, displayName: true } },
        vehicle: { select: { id: true, registration: true, displayName: true } },
        _count: { select: { bookings: true, bookingSeats: true } },
      },
    });

    const hasNext = items.length > limit;
    const page = hasNext ? items.slice(0, limit) : items;

    return {
      items: page,
      nextCursor: hasNext ? (page[page.length - 1] as { id: string }).id : null,
    };
  }

  // ------------------------------------------------------------------
  // GET /admin/payments — liste paginée de tous les paiements
  // ------------------------------------------------------------------

  async listPayments(query: ListPaymentsQuery): Promise<PaginatedResult<object>> {
    const { status, cooperativeId, from, to, cursor, limit } = query;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ...(status ? { status } : {}),
      ...(cooperativeId
        ? { booking: { cooperativeId } }
        : {}),
      ...(from || to
        ? {
            initiatedAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
      ...(cursor ? { id: { gt: cursor } } : {}),
    };

    const items = await this.db.payment.findMany({
      where,
      take: limit + 1,
      orderBy: { initiatedAt: 'desc' },
      select: {
        id: true,
        provider: true,
        amountMga: true,
        status: true,
        providerTransactionId: true,
        initiatedAt: true,
        confirmedAt: true,
        booking: {
          select: {
            id: true,
            reference: true,
            cooperative: { select: { id: true, displayName: true } },
          },
        },
      },
    });

    const hasNext = items.length > limit;
    const page = hasNext ? items.slice(0, limit) : items;

    return {
      items: page,
      nextCursor: hasNext ? (page[page.length - 1] as { id: string }).id : null,
    };
  }

  // ==================================================================
  // PARAMÈTRES PLATEFORME
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/settings — politique de frais active + horaires SMS
  // ------------------------------------------------------------------

  async getSettings(): Promise<object> {
    const activeFeePolicy = await this.db.platformFeePolicy.findFirst({
      where: { isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });

    return {
      platformFee: activeFeePolicy
        ? {
            id: activeFeePolicy.id,
            name: activeFeePolicy.name,
            ratePercent: activeFeePolicy.ratePercent,
            fixedAmountMga: activeFeePolicy.fixedAmountMga,
            minAmountMga: activeFeePolicy.minAmountMga,
            effectiveFrom: activeFeePolicy.effectiveFrom,
          }
        : null,
      // Horaires SMS silence nocturne (valeurs par défaut du CDC §4.1)
      smsQuietHoursStart: process.env.SMS_QUIET_START ?? '22:00',
      smsQuietHoursEnd: process.env.SMS_QUIET_END ?? '06:00',
    };
  }

  // ------------------------------------------------------------------
  // PUT /admin/settings — mettre à jour la politique de frais
  // Crée une nouvelle PlatformFeePolicy, désactive l'ancienne.
  // AuditLog : ADMIN_ACCESS
  // ------------------------------------------------------------------

  async updateSettings(body: UpdateSettingsBody, ctx: AdminContext): Promise<object> {
    const now = new Date();

    const result = await this.db.$transaction(async (tx) => {
      let updatedFeePolicy = null;

      if (body.platformFee) {
        // Désactiver la politique actuelle
        await tx.platformFeePolicy.updateMany({
          where: { isActive: true },
          data: { isActive: false, effectiveUntil: now },
        });

        // Créer la nouvelle politique
        updatedFeePolicy = await tx.platformFeePolicy.create({
          data: {
            name: body.platformFee.name ?? 'Frais plateforme',
            ratePercent: body.platformFee.ratePercent ?? null,
            fixedAmountMga: body.platformFee.fixedAmountMga ?? null,
            minAmountMga: body.platformFee.minAmountMga ?? null,
            effectiveFrom: now,
            isActive: true,
          },
        });
      }

      await this.writeAuditLog(tx as unknown as PrismaClient, {
        actorUserId: ctx.actorUserId,
        action: AuditAction.ADMIN_ACCESS,
        entityType: 'PlatformSettings',
        after: {
          platformFee: body.platformFee ?? null,
          smsQuietHoursStart: body.smsQuietHoursStart ?? null,
          smsQuietHoursEnd: body.smsQuietHoursEnd ?? null,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return {
        platformFee: updatedFeePolicy
          ? {
              id: updatedFeePolicy.id,
              name: updatedFeePolicy.name,
              ratePercent: updatedFeePolicy.ratePercent,
              fixedAmountMga: updatedFeePolicy.fixedAmountMga,
              minAmountMga: updatedFeePolicy.minAmountMga,
              effectiveFrom: updatedFeePolicy.effectiveFrom,
            }
          : undefined,
        smsQuietHoursStart: body.smsQuietHoursStart,
        smsQuietHoursEnd: body.smsQuietHoursEnd,
      };
    });

    return result;
  }

  // ==================================================================
  // SUPERVISION
  // ==================================================================

  // ------------------------------------------------------------------
  // GET /admin/dashboard (et alias /admin/stats — H-ADM-04)
  // Tableau de bord global : compteurs coopératives, bookings,
  // revenus du mois, trajets actifs, avis en attente.
  // ------------------------------------------------------------------

  async getStats(): Promise<AdminStats> {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalCoops,
      pendingCoops,
      validatedCoops,
      suspendedCoops,
      bookingsToday,
      bookingsThisMonth,
      revenueAgg,
      activeTrips,
      pendingRatings,
    ] = await Promise.all([
      // Comptes coopératives
      this.db.cooperative.count(),
      this.db.cooperative.count({
        where: { status: CooperativeStatus.PENDING_VALIDATION },
      }),
      this.db.cooperative.count({
        where: { status: CooperativeStatus.VALIDATED },
      }),
      this.db.cooperative.count({
        where: { status: CooperativeStatus.SUSPENDED },
      }),

      // Réservations confirmées aujourd'hui
      this.db.booking.count({
        where: {
          status: 'CONFIRMED',
          confirmedAt: { gte: startOfToday },
        },
      }),

      // Réservations confirmées ce mois
      this.db.booking.count({
        where: {
          status: 'CONFIRMED',
          confirmedAt: { gte: startOfMonth },
        },
      }),

      // Revenus (paiements confirmés ce mois)
      this.db.payment.aggregate({
        where: {
          status: 'CONFIRMED',
          confirmedAt: { gte: startOfMonth },
        },
        _sum: { amountMga: true },
      }),

      // Trajets actifs (OPEN_FOR_BOOKING ou DEPARTED)
      this.db.tripInstance.count({
        where: {
          status: { in: ['OPEN_FOR_BOOKING', 'DEPARTED'] },
        },
      }),

      // Avis en attente de modération
      this.db.rating.count({
        where: { status: RatingStatus.PENDING_REVIEW },
      }),
    ]);

    return {
      cooperatives: {
        total: totalCoops,
        pending: pendingCoops,
        validated: validatedCoops,
        suspended: suspendedCoops,
      },
      bookings: {
        today: bookingsToday,
        thisMonth: bookingsThisMonth,
      },
      revenue: {
        thisMonth: revenueAgg._sum.amountMga ?? 0,
        currency: 'MGA',
      },
      activeTrips,
      pendingRatings,
    };
  }

  // ------------------------------------------------------------------
  // GET /admin/audit-logs — journal d'audit paginé
  // ------------------------------------------------------------------

  async getAuditLog(query: AuditLogQuery): Promise<PaginatedResult<AuditLog>> {
    const { action, entityType, actorUserId, from, to, cursor, limit } = query;

    const where = {
      ...(action ? { action: action as AuditAction } : {}),
      ...(entityType ? { entityType } : {}),
      ...(actorUserId ? { actorUserId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
      ...(cursor ? { id: { gt: cursor } } : {}),
    };

    const items = await this.db.auditLog.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = items.length > limit;
    const page = hasNext ? items.slice(0, limit) : items;

    return {
      items: page,
      nextCursor: hasNext ? page[page.length - 1].id : null,
    };
  }
}
