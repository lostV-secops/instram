// =====================================================================
// admin.schema.ts — Validation Zod des entrées du module Admin
//
// Console admin InsTRAM : FR uniquement (CDC §5.6 — architecture §7.3).
// Contrat de référence : docs/contrat-api.yaml §Admin
//
// Hypothèses documentées :
//   H-ADM-01 : Le contrat utilise POST pour validate/suspend coopérative
//              (POST /admin/cooperatives/{id}/validate|suspend).
//              La tâche demande PATCH. Les deux méthodes sont implémentées ;
//              POST est la méthode canonique (contrat).
//   H-ADM-02 : L'endpoint PATCH /admin/cooperatives/:id/reject n'existe pas
//              dans le contrat. Il est implémenté comme extension de la tâche
//              et documenté ici. L'AuditAction utilisé est COOP_SUSPENDED
//              (le plus proche disponible dans l'enum AuditAction).
//   H-ADM-03 : USER_SUSPENDED n'existe pas dans l'enum AuditAction du schéma.
//              L'action ADMIN_ACCESS est utilisée avec entityType='User'
//              pour tracer la suspension/réactivation utilisateur.
//   H-ADM-04 : GET /admin/stats (tâche) est un alias de GET /admin/dashboard
//              (contrat). Les deux routes sont implémentées.
//   H-ADM-05 : GET /admin/audit-log (tâche) est un alias de
//              GET /admin/audit-logs (contrat). Les deux sont implémentées.
//   H-ADM-06 : L'endpoint mark-paid (/admin/subscriptions/:id/mark-paid)
//              n'est pas dans le contrat. Il est implémenté comme extension.
//   H-ADM-07 : La commission par défaut lors de la validation d'une
//              coopérative sans plan existant est 4 % (VH-04).
//   H-ADM-08 : PATCH /admin/ratings/:id/approve|reject (tâche) sont des
//              raccourcis de PATCH /admin/ratings/:id avec status dans body
//              (contrat). Les deux formes sont implémentées.
// =====================================================================

import { z } from 'zod';

// ------------------------------------------------------------------
// Coopératives
// ------------------------------------------------------------------

export const ListCooperativesQuerySchema = z.object({
  status: z
    .enum(['PENDING_VALIDATION', 'VALIDATED', 'SUSPENDED', 'REJECTED'])
    .optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const SuspendRejectBodySchema = z.object({
  reason: z.string().min(1, 'La raison est obligatoire'),
});

// ------------------------------------------------------------------
// Plans tarifaires
// ------------------------------------------------------------------

export const CreatePricingPlanBodySchema = z
  .object({
    type: z.enum(['COMMISSION', 'SUBSCRIPTION']),
    commissionRate: z.number().min(0).max(100).optional(),
    monthlyFeeMga: z.number().int().min(0).optional(),
    effectiveFrom: z.string().datetime(),
  })
  .refine(
    (data) => {
      if (data.type === 'COMMISSION') return data.commissionRate !== undefined;
      if (data.type === 'SUBSCRIPTION') return data.monthlyFeeMga !== undefined;
      return true;
    },
    {
      message:
        'commissionRate est obligatoire pour le type COMMISSION ; monthlyFeeMga est obligatoire pour le type SUBSCRIPTION',
    },
  );

// ------------------------------------------------------------------
// Abonnements
// ------------------------------------------------------------------

export const CreateSubscriptionBodySchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  amountMga: z.number().int().min(0),
});

// ------------------------------------------------------------------
// Modération des avis
// ------------------------------------------------------------------

export const ModerateRatingBodySchema = z.object({
  status: z.enum(['PUBLISHED', 'REJECTED']),
  moderationNote: z.string().optional(),
});

// ------------------------------------------------------------------
// Utilisateurs
// ------------------------------------------------------------------

export const ListUsersQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const SuspendUserBodySchema = z.object({
  reason: z.string().min(1, 'La raison est obligatoire'),
});

// ------------------------------------------------------------------
// Journal d'audit
// ------------------------------------------------------------------

export const AuditLogQuerySchema = z.object({
  action: z.string().optional(),
  entityType: z.string().optional(),
  actorUserId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ------------------------------------------------------------------
// Avis (ratings)
// ------------------------------------------------------------------

export const ListRatingsQuerySchema = z.object({
  status: z.enum(['PENDING_REVIEW', 'PUBLISHED', 'REJECTED']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ------------------------------------------------------------------
// Trajets (supervision admin)
// ------------------------------------------------------------------

export const ListTripsQuerySchema = z.object({
  status: z
    .enum(['DRAFT', 'OPEN_FOR_BOOKING', 'BOARDING', 'DEPARTED', 'COMPLETED', 'CANCELLED'])
    .optional(),
  cooperativeId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ------------------------------------------------------------------
// GET /admin/payments — supervision des paiements
// ------------------------------------------------------------------
export const ListPaymentsQuerySchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'REFUNDED_AT_COUNTER']).optional(),
  cooperativeId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ------------------------------------------------------------------
// Paramètres plateforme (PlatformFeePolicy + horaires SMS)
// ------------------------------------------------------------------

export const UpdateSettingsBodySchema = z.object({
  platformFee: z
    .object({
      ratePercent: z.number().min(0).max(100).optional(),
      fixedAmountMga: z.number().int().min(0).optional(),
      minAmountMga: z.number().int().min(0).optional(),
      name: z.string().min(1).optional(),
    })
    .optional(),
  smsQuietHoursStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Format HH:MM attendu')
    .optional(),
  smsQuietHoursEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Format HH:MM attendu')
    .optional(),
});

// ------------------------------------------------------------------
// Types exportés
// ------------------------------------------------------------------

export type ListCooperativesQuery = z.infer<typeof ListCooperativesQuerySchema>;
export type SuspendRejectBody = z.infer<typeof SuspendRejectBodySchema>;
export type CreatePricingPlanBody = z.infer<typeof CreatePricingPlanBodySchema>;
export type CreateSubscriptionBody = z.infer<typeof CreateSubscriptionBodySchema>;
export type ModerateRatingBody = z.infer<typeof ModerateRatingBodySchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
export type SuspendUserBody = z.infer<typeof SuspendUserBodySchema>;
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
export type ListRatingsQuery = z.infer<typeof ListRatingsQuerySchema>;
export type ListTripsQuery = z.infer<typeof ListTripsQuerySchema>;
export type ListPaymentsQuery = z.infer<typeof ListPaymentsQuerySchema>;
export type UpdateSettingsBody = z.infer<typeof UpdateSettingsBodySchema>;
