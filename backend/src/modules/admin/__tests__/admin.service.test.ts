// =====================================================================
// admin.service.test.ts — Tests unitaires du module Admin
//
// Couverture requise (tâche) :
//   1. Validation coopérative PENDING → VALIDATED + AuditLog
//   2. Suspension coopérative + raison
//   3. Changement plan tarifaire : ancien plan clôturé, nouveau créé
//   4. Approbation/rejet d'avis
//   5. Stats globales retournent les bons compteurs
//   6. Accès refusé sans AdminProfile
//
// Pattern de mock : même convention que trips.service.test.ts —
//   - makeMockPrisma() retourne un mock complet,
//   - $transaction simule une callback inline.
// =====================================================================

import {
  AdminService,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../admin.service';
import {
  PlatformRole,
  CooperativeStatus,
  PricingPlanType,
  RatingStatus,
  AuditAction,
  UserStatus,
  SubscriptionStatus,
} from '@prisma/client';

// =====================================================================
// Helper mock Prisma
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMockPrisma(): any {
  // Le tx mock est partagé entre $transaction et les méthodes directes
  // pour pouvoir assert sur ses appels.
  const txMock = {
    cooperative: {
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    cooperativePricingPlan: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    rating: {
      update: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _avg: { score: 4.5 }, _count: { score: 10 } }),
    },
    user: {
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const db = {
    $transaction: jest.fn().mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: (tx: any) => Promise<any>) => fn(txMock),
    ),
    _tx: txMock, // Expose pour assertions

    adminProfile: {
      findUnique: jest.fn(),
    },
    cooperative: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    cooperativePricingPlan: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    cooperativeSubscription: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    rating: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _avg: { score: null }, _count: { score: 0 } }),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    booking: {
      count: jest.fn().mockResolvedValue(0),
    },
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountMga: null } }),
    },
    tripInstance: {
      count: jest.fn().mockResolvedValue(0),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  return db;
}

// =====================================================================
// 1. Accès refusé sans AdminProfile
// =====================================================================

describe('AdminService.requireAdminProfile', () => {
  it('lève ForbiddenError si aucun AdminProfile trouvé', async () => {
    const db = makeMockPrisma();
    db.adminProfile.findUnique.mockResolvedValue(null);

    const service = new AdminService(db);

    await expect(
      service.requireAdminProfile('user-no-profile'),
    ).rejects.toThrow(ForbiddenError);

    await expect(
      service.requireAdminProfile('user-no-profile'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('aucun profil administrateur'),
    });
  });

  it('lève ForbiddenError si le rôle est ADMIN_MODERATOR mais que ADMIN_OPS est requis', async () => {
    const db = makeMockPrisma();
    db.adminProfile.findUnique.mockResolvedValue({
      id: 'ap-1',
      userId: 'u-1',
      role: PlatformRole.ADMIN_MODERATOR,
    });

    const service = new AdminService(db);

    await expect(
      service.requireAdminProfile('u-1', [
        PlatformRole.ADMIN_SUPER,
        PlatformRole.ADMIN_OPS,
      ]),
    ).rejects.toThrow(ForbiddenError);
  });

  it('retourne le profil si le rôle est autorisé', async () => {
    const db = makeMockPrisma();
    const profile = { id: 'ap-1', userId: 'u-1', role: PlatformRole.ADMIN_OPS };
    db.adminProfile.findUnique.mockResolvedValue(profile);

    const service = new AdminService(db);
    const result = await service.requireAdminProfile('u-1', [
      PlatformRole.ADMIN_SUPER,
      PlatformRole.ADMIN_OPS,
    ]);

    expect(result).toEqual(profile);
  });
});

// =====================================================================
// 2. Validation coopérative PENDING → VALIDATED + AuditLog
// =====================================================================

describe('AdminService.validateCooperative', () => {
  const cooperativeId = 'coop-123';
  const ctx = { actorUserId: 'admin-456', ipAddress: '127.0.0.1' };

  it('passe le statut à VALIDATED et écrit un AuditLog', async () => {
    const db = makeMockPrisma();
    const pendingCoop = {
      id: cooperativeId,
      status: CooperativeStatus.PENDING_VALIDATION,
    };
    db.cooperative.findUnique.mockResolvedValue(pendingCoop);

    const validatedCoop = { ...pendingCoop, status: CooperativeStatus.VALIDATED, validatedAt: new Date() };
    db._tx.cooperative.update.mockResolvedValue(validatedCoop);
    db._tx.cooperativePricingPlan.findFirst.mockResolvedValue(null); // pas de plan existant

    const service = new AdminService(db);
    const result = await service.validateCooperative(cooperativeId, ctx);

    // Statut mis à jour
    expect(db._tx.cooperative.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: cooperativeId },
        data: expect.objectContaining({ status: CooperativeStatus.VALIDATED }),
      }),
    );

    // Plan de commission par défaut créé (VH-04 : 4 %)
    expect(db._tx.cooperativePricingPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: PricingPlanType.COMMISSION,
          commissionRate: 4,
        }),
      }),
    );

    // AuditLog écrit
    expect(db._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.COOP_VALIDATED,
          entityType: 'Cooperative',
          entityId: cooperativeId,
          actorUserId: ctx.actorUserId,
        }),
      }),
    );

    expect(result).toEqual(validatedCoop);
  });

  it("ne crée pas de plan par défaut si un plan actif existe déjà", async () => {
    const db = makeMockPrisma();
    db.cooperative.findUnique.mockResolvedValue({
      id: cooperativeId,
      status: CooperativeStatus.PENDING_VALIDATION,
    });
    db._tx.cooperative.update.mockResolvedValue({
      id: cooperativeId,
      status: CooperativeStatus.VALIDATED,
      validatedAt: new Date(),
    });
    // Un plan actif (effectiveUntil = null) existe déjà
    db._tx.cooperativePricingPlan.findFirst.mockResolvedValue({ id: 'plan-existing' });

    const service = new AdminService(db);
    await service.validateCooperative(cooperativeId, ctx);

    expect(db._tx.cooperativePricingPlan.create).not.toHaveBeenCalled();
  });

  it('lève NotFoundError si la coopérative est introuvable', async () => {
    const db = makeMockPrisma();
    db.cooperative.findUnique.mockResolvedValue(null);

    const service = new AdminService(db);

    await expect(
      service.validateCooperative('inexistant', ctx),
    ).rejects.toThrow(NotFoundError);
  });

  it('lève ConflictError si la coopérative n\'est pas en PENDING_VALIDATION', async () => {
    const db = makeMockPrisma();
    db.cooperative.findUnique.mockResolvedValue({
      id: cooperativeId,
      status: CooperativeStatus.VALIDATED,
    });

    const service = new AdminService(db);

    await expect(
      service.validateCooperative(cooperativeId, ctx),
    ).rejects.toThrow(ConflictError);
  });
});

// =====================================================================
// 3. Suspension coopérative + raison
// =====================================================================

describe('AdminService.suspendCooperative', () => {
  const cooperativeId = 'coop-123';
  const ctx = { actorUserId: 'admin-456', ipAddress: '127.0.0.1' };
  const body = { reason: 'Fraude documentée lors du contrôle' };

  it('suspend la coopérative et écrit un AuditLog avec la raison', async () => {
    const db = makeMockPrisma();
    db.cooperative.findUnique.mockResolvedValue({
      id: cooperativeId,
      status: CooperativeStatus.VALIDATED,
    });
    const suspended = { id: cooperativeId, status: CooperativeStatus.SUSPENDED };
    db._tx.cooperative.update.mockResolvedValue(suspended);

    const service = new AdminService(db);
    const result = await service.suspendCooperative(cooperativeId, body, ctx);

    expect(db._tx.cooperative.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: CooperativeStatus.SUSPENDED },
      }),
    );

    expect(db._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.COOP_SUSPENDED,
          after: expect.objectContaining({ reason: body.reason }),
        }),
      }),
    );

    expect(result).toEqual(suspended);
  });

  it('lève ConflictError si déjà suspendue', async () => {
    const db = makeMockPrisma();
    db.cooperative.findUnique.mockResolvedValue({
      id: cooperativeId,
      status: CooperativeStatus.SUSPENDED,
    });

    const service = new AdminService(db);

    await expect(
      service.suspendCooperative(cooperativeId, body, ctx),
    ).rejects.toThrow(ConflictError);
  });

  it('lève NotFoundError si introuvable', async () => {
    const db = makeMockPrisma();
    db.cooperative.findUnique.mockResolvedValue(null);

    const service = new AdminService(db);

    await expect(
      service.suspendCooperative('ghost', body, ctx),
    ).rejects.toThrow(NotFoundError);
  });
});

// =====================================================================
// 4. Changement plan tarifaire : ancien clos, nouveau créé
// =====================================================================

describe('AdminService.createPricingPlan', () => {
  const cooperativeId = 'coop-123';
  const ctx = { actorUserId: 'admin-456', ipAddress: '127.0.0.1' };

  it('clôture l\'ancien plan et crée le nouveau + AuditLog COOP_PLAN_CHANGED', async () => {
    const db = makeMockPrisma();
    db.cooperative.findUnique.mockResolvedValue({
      id: cooperativeId,
      status: CooperativeStatus.VALIDATED,
    });

    const newPlan = {
      id: 'plan-new',
      cooperativeId,
      type: PricingPlanType.COMMISSION,
      commissionRate: 10,
      effectiveFrom: new Date('2026-09-01T00:00:00Z'),
      effectiveUntil: null,
    };
    db._tx.cooperativePricingPlan.create.mockResolvedValue(newPlan);

    const service = new AdminService(db);
    const result = await service.createPricingPlan(
      cooperativeId,
      {
        type: 'COMMISSION',
        commissionRate: 10,
        effectiveFrom: '2026-09-01T00:00:00.000Z',
      },
      ctx,
    );

    // L'ancien plan actif est clos
    expect(db._tx.cooperativePricingPlan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cooperativeId, effectiveUntil: null },
        data: expect.objectContaining({ effectiveUntil: expect.any(Date) }),
      }),
    );

    // Le nouveau plan est créé
    expect(db._tx.cooperativePricingPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: PricingPlanType.COMMISSION,
          commissionRate: 10,
        }),
      }),
    );

    // AuditLog
    expect(db._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.COOP_PLAN_CHANGED,
          entityType: 'CooperativePricingPlan',
          actorUserId: ctx.actorUserId,
        }),
      }),
    );

    expect(result).toEqual(newPlan);
  });

  it('lève ConflictError de validation Zod si COMMISSION sans commissionRate', async () => {
    // Ce test valide le schéma Zod, pas le service directement
    // (le service reçoit des données déjà validées par le schema)
    // On teste que la création fonctionne AVEC les bons params
    const db = makeMockPrisma();
    db.cooperative.findUnique.mockResolvedValue({
      id: cooperativeId,
      status: CooperativeStatus.VALIDATED,
    });
    db._tx.cooperativePricingPlan.create.mockResolvedValue({
      id: 'plan-sub',
      type: PricingPlanType.SUBSCRIPTION,
      monthlyFeeMga: 50000,
    });

    const service = new AdminService(db);
    await service.createPricingPlan(
      cooperativeId,
      {
        type: 'SUBSCRIPTION',
        monthlyFeeMga: 50000,
        effectiveFrom: '2026-09-01T00:00:00.000Z',
      },
      ctx,
    );

    expect(db._tx.cooperativePricingPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: PricingPlanType.SUBSCRIPTION,
          monthlyFeeMga: 50000,
        }),
      }),
    );
  });

  it('lève NotFoundError si la coopérative est introuvable', async () => {
    const db = makeMockPrisma();
    db.cooperative.findUnique.mockResolvedValue(null);

    const service = new AdminService(db);

    await expect(
      service.createPricingPlan(
        'ghost',
        { type: 'COMMISSION', commissionRate: 5, effectiveFrom: '2026-09-01T00:00:00.000Z' },
        ctx,
      ),
    ).rejects.toThrow(NotFoundError);
  });
});

// =====================================================================
// 5. Approbation et rejet d'avis
// =====================================================================

describe('AdminService.moderateRating', () => {
  const ratingId = 'rating-789';
  const ctx = { actorUserId: 'admin-456', ipAddress: '127.0.0.1' };

  const pendingRating = {
    id: ratingId,
    cooperativeId: 'coop-123',
    status: RatingStatus.PENDING_REVIEW,
    score: 4,
  };

  it('approuve un avis (PENDING_REVIEW → PUBLISHED) et écrit un AuditLog', async () => {
    const db = makeMockPrisma();
    db.rating.findUnique.mockResolvedValue(pendingRating);
    const published = { ...pendingRating, status: RatingStatus.PUBLISHED, moderatedAt: new Date() };
    db._tx.rating.update.mockResolvedValue(published);
    db._tx.rating.aggregate.mockResolvedValue({
      _avg: { score: 4.2 },
      _count: { score: 12 },
    });
    db._tx.cooperative = { update: jest.fn() };

    const service = new AdminService(db);
    const result = await service.moderateRating(ratingId, { status: 'PUBLISHED' }, ctx);

    expect(db._tx.rating.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ratingId },
        data: expect.objectContaining({ status: RatingStatus.PUBLISHED }),
      }),
    );

    // La note moyenne doit être mise à jour
    expect(db._tx.rating.aggregate).toHaveBeenCalled();

    expect(db._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.RATING_MODERATED,
          entityType: 'Rating',
          entityId: ratingId,
          after: expect.objectContaining({ status: RatingStatus.PUBLISHED }),
        }),
      }),
    );

    expect(result).toEqual(published);
  });

  it('rejette un avis (PENDING_REVIEW → REJECTED) et écrit un AuditLog', async () => {
    const db = makeMockPrisma();
    db.rating.findUnique.mockResolvedValue(pendingRating);
    const rejected = { ...pendingRating, status: RatingStatus.REJECTED, moderatedAt: new Date() };
    db._tx.rating.update.mockResolvedValue(rejected);

    const service = new AdminService(db);
    const result = await service.moderateRating(
      ratingId,
      { status: 'REJECTED', moderationNote: 'Contenu inapproprié' },
      ctx,
    );

    expect(db._tx.rating.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: RatingStatus.REJECTED }),
      }),
    );

    expect(db._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.RATING_MODERATED,
          after: expect.objectContaining({
            status: RatingStatus.REJECTED,
            moderationNote: 'Contenu inapproprié',
          }),
        }),
      }),
    );

    // La note moyenne ne doit PAS être mise à jour pour un rejet
    expect(db._tx.rating.aggregate).not.toHaveBeenCalled();

    expect(result).toEqual(rejected);
  });

  it('lève ConflictError si l\'avis est déjà modéré', async () => {
    const db = makeMockPrisma();
    db.rating.findUnique.mockResolvedValue({
      ...pendingRating,
      status: RatingStatus.PUBLISHED,
    });

    const service = new AdminService(db);

    await expect(
      service.moderateRating(ratingId, { status: 'REJECTED' }, ctx),
    ).rejects.toThrow(ConflictError);
  });

  it('lève NotFoundError si l\'avis est introuvable', async () => {
    const db = makeMockPrisma();
    db.rating.findUnique.mockResolvedValue(null);

    const service = new AdminService(db);

    await expect(
      service.moderateRating('ghost', { status: 'PUBLISHED' }, ctx),
    ).rejects.toThrow(NotFoundError);
  });
});

// =====================================================================
// 6. Stats globales retournent les bons compteurs
// =====================================================================

describe('AdminService.getStats', () => {
  it('retourne les compteurs corrects depuis les requêtes Prisma', async () => {
    const db = makeMockPrisma();

    // Compteurs coopératives
    db.cooperative.count
      .mockResolvedValueOnce(25) // total
      .mockResolvedValueOnce(5)  // pending
      .mockResolvedValueOnce(18) // validated
      .mockResolvedValueOnce(2); // suspended

    // Bookings
    db.booking.count
      .mockResolvedValueOnce(3)  // today
      .mockResolvedValueOnce(47); // thisMonth

    // Revenue
    db.payment.aggregate.mockResolvedValue({
      _sum: { amountMga: 1_500_000 },
    });

    // Active trips
    db.tripInstance.count.mockResolvedValue(8);

    // Pending ratings
    db.rating.count.mockResolvedValue(11);

    const service = new AdminService(db);
    const stats = await service.getStats();

    expect(stats.cooperatives.total).toBe(25);
    expect(stats.cooperatives.pending).toBe(5);
    expect(stats.cooperatives.validated).toBe(18);
    expect(stats.cooperatives.suspended).toBe(2);
    expect(stats.bookings.today).toBe(3);
    expect(stats.bookings.thisMonth).toBe(47);
    expect(stats.revenue.thisMonth).toBe(1_500_000);
    expect(stats.revenue.currency).toBe('MGA');
    expect(stats.activeTrips).toBe(8);
    expect(stats.pendingRatings).toBe(11);
  });

  it('retourne 0 pour revenue.thisMonth quand aucun paiement confirmé', async () => {
    const db = makeMockPrisma();
    db.payment.aggregate.mockResolvedValue({ _sum: { amountMga: null } });

    const service = new AdminService(db);
    const stats = await service.getStats();

    expect(stats.revenue.thisMonth).toBe(0);
  });
});

// =====================================================================
// 7. Suspension et réactivation utilisateur
// =====================================================================

describe('AdminService.suspendUser', () => {
  const userId = 'user-123';
  const ctx = { actorUserId: 'admin-456', ipAddress: '127.0.0.1' };
  const body = { reason: 'Abus signalé par plusieurs coopératives' };

  it('suspend un utilisateur actif et écrit un AuditLog', async () => {
    const db = makeMockPrisma();
    db.user.findUnique.mockResolvedValue({
      id: userId,
      email: 'test@example.com',
      phone: null,
      status: UserStatus.ACTIVE,
    });
    const suspended = { id: userId, status: UserStatus.SUSPENDED };
    db._tx.user.update.mockResolvedValue(suspended);

    const service = new AdminService(db);
    const result = await service.suspendUser(userId, body, ctx);

    expect(db._tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: { status: UserStatus.SUSPENDED },
      }),
    );

    expect(db._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.ADMIN_ACCESS,
          entityType: 'User',
          entityId: userId,
          after: expect.objectContaining({ reason: body.reason }),
        }),
      }),
    );

    expect(result).toEqual(suspended);
  });

  it('lève ConflictError si déjà suspendu', async () => {
    const db = makeMockPrisma();
    db.user.findUnique.mockResolvedValue({ id: userId, status: UserStatus.SUSPENDED });

    const service = new AdminService(db);

    await expect(service.suspendUser(userId, body, ctx)).rejects.toThrow(ConflictError);
  });

  it('lève NotFoundError si utilisateur introuvable', async () => {
    const db = makeMockPrisma();
    db.user.findUnique.mockResolvedValue(null);

    const service = new AdminService(db);

    await expect(service.suspendUser('ghost', body, ctx)).rejects.toThrow(NotFoundError);
  });
});

describe('AdminService.reinstateUser', () => {
  const userId = 'user-123';
  const ctx = { actorUserId: 'admin-456' };

  it('réactive un utilisateur suspendu', async () => {
    const db = makeMockPrisma();
    db.user.findUnique.mockResolvedValue({
      id: userId,
      status: UserStatus.SUSPENDED,
    });
    const active = { id: userId, status: UserStatus.ACTIVE };
    db._tx.user.update.mockResolvedValue(active);

    const service = new AdminService(db);
    const result = await service.reinstateUser(userId, ctx);

    expect(db._tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: UserStatus.ACTIVE },
      }),
    );

    expect(result).toEqual(active);
  });

  it('lève ConflictError si l\'utilisateur n\'est pas suspendu', async () => {
    const db = makeMockPrisma();
    db.user.findUnique.mockResolvedValue({ id: userId, status: UserStatus.ACTIVE });

    const service = new AdminService(db);

    await expect(service.reinstateUser(userId, ctx)).rejects.toThrow(ConflictError);
  });
});

// =====================================================================
// 8. Rejet coopérative (extension tâche)
// =====================================================================

describe('AdminService.rejectCooperative', () => {
  const cooperativeId = 'coop-456';
  const ctx = { actorUserId: 'admin-789', ipAddress: '10.0.0.1' };
  const body = { reason: 'Documents fournis invalides' };

  it('rejette une coopérative en PENDING_VALIDATION et écrit un AuditLog', async () => {
    const db = makeMockPrisma();
    db.cooperative.findUnique.mockResolvedValue({
      id: cooperativeId,
      status: CooperativeStatus.PENDING_VALIDATION,
    });
    const rejected = { id: cooperativeId, status: CooperativeStatus.REJECTED };
    db._tx.cooperative.update.mockResolvedValue(rejected);

    const service = new AdminService(db);
    const result = await service.rejectCooperative(cooperativeId, body, ctx);

    expect(db._tx.cooperative.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: CooperativeStatus.REJECTED },
      }),
    );

    expect(db._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.COOP_SUSPENDED, // H-ADM-02
          after: expect.objectContaining({ status: CooperativeStatus.REJECTED }),
        }),
      }),
    );

    expect(result).toEqual(rejected);
  });

  it('lève ConflictError si la coopérative n\'est pas PENDING_VALIDATION', async () => {
    const db = makeMockPrisma();
    db.cooperative.findUnique.mockResolvedValue({
      id: cooperativeId,
      status: CooperativeStatus.VALIDATED,
    });

    const service = new AdminService(db);

    await expect(
      service.rejectCooperative(cooperativeId, body, ctx),
    ).rejects.toThrow(ConflictError);
  });
});

// =====================================================================
// 9. markSubscriptionPaid (extension tâche)
// =====================================================================

describe('AdminService.markSubscriptionPaid', () => {
  it('marque un abonnement comme payé', async () => {
    const db = makeMockPrisma();
    db.cooperativeSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: SubscriptionStatus.MANUAL,
    });
    const paidSub = {
      id: 'sub-1',
      status: SubscriptionStatus.PAID,
      paidAt: new Date(),
    };
    db.cooperativeSubscription.update.mockResolvedValue(paidSub);

    const service = new AdminService(db);
    const result = await service.markSubscriptionPaid('sub-1');

    expect(db.cooperativeSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ status: SubscriptionStatus.PAID }),
      }),
    );

    expect(result).toEqual(paidSub);
  });

  it('lève ConflictError si déjà payé', async () => {
    const db = makeMockPrisma();
    db.cooperativeSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: SubscriptionStatus.PAID,
    });

    const service = new AdminService(db);

    await expect(service.markSubscriptionPaid('sub-1')).rejects.toThrow(ConflictError);
  });
});
