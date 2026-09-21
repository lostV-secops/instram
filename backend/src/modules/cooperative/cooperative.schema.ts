import { z } from 'zod';

// =====================================================================
// Cooperative module — Zod schemas
// Contrat : docs/contrat-api.yaml §Cooperative
// =====================================================================

// ------------------------------------------------------------------
// Membres
// ------------------------------------------------------------------

export const InviteMemberSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(8).optional(),
    role: z.enum(['COOP_ADMIN', 'COOP_ASSISTANT', 'COOP_DRIVER', 'COOP_CONTROLLER']),
  })
  .refine((d) => d.email || d.phone, {
    message: 'Au moins un champ email ou phone est requis',
  });

export const UpdateMemberSchema = z
  .object({
    role: z.enum(['COOP_ADMIN', 'COOP_ASSISTANT', 'COOP_DRIVER', 'COOP_CONTROLLER']).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => d.role !== undefined || d.active !== undefined, {
    message: 'Au moins un champ role ou active est requis',
  });

// ------------------------------------------------------------------
// Véhicules / SeatMap
// ------------------------------------------------------------------

const SeatDefinitionInputSchema = z.object({
  code: z.string().min(1).max(10),
  row: z.number().int().nonnegative().optional(),
  col: z.number().int().nonnegative().optional(),
  category: z.enum(['VIP', 'PREMIUM', 'CLASSIC', 'STANDARD']),
});

const SeatMapInputSchema = z.object({
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  seats: z.array(SeatDefinitionInputSchema).min(1),
});

export const CreateVehicleSchema = z.object({
  /** displayName du véhicule */
  name: z.string().min(1).max(100),
  /** immatriculation — doit être unique par coopérative */
  licensePlate: z.string().min(1).max(30),
  model: z.string().max(100).optional(),
  capacity: z.number().int().positive(),
  seatMap: SeatMapInputSchema,
});

export const UpdateVehicleSchema = z
  .object({
    isActive: z.boolean().optional(),
    displayName: z.string().min(1).max(100).optional(),
  })
  .refine((d) => d.isActive !== undefined || d.displayName !== undefined, {
    message: 'Au moins un champ est requis',
  });

// ------------------------------------------------------------------
// Coopérative — mise à jour du profil public
// ------------------------------------------------------------------

export const UpdateCooperativeSchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    contactEmail: z.string().email().optional().or(z.literal('')),
    contactPhone: z.string().min(8).max(30).optional().or(z.literal('')),
    descriptionFr: z.string().max(2000).optional().or(z.literal('')),
    descriptionMg: z.string().max(2000).optional().or(z.literal('')),
    logoUrl: z.string().url().optional().or(z.literal('')),
  })
  .refine(
    (d) =>
      d.displayName !== undefined ||
      d.contactEmail !== undefined ||
      d.contactPhone !== undefined ||
      d.descriptionFr !== undefined ||
      d.descriptionMg !== undefined ||
      d.logoUrl !== undefined,
    { message: 'Au moins un champ est requis' },
  );

// ------------------------------------------------------------------
// Politique d'annulation — upsert
// ------------------------------------------------------------------

export const UpsertPolicySchema = z.object({
  titleFr: z.string().min(1).max(200),
  titleMg: z.string().min(1).max(200),
  bodyFr: z.string().min(1).max(5000),
  bodyMg: z.string().min(1).max(5000),
});

// ------------------------------------------------------------------
// Plans de sièges (GAP A — CDC §4.1)
// ------------------------------------------------------------------

export const CreateSeatMapSchema = z.object({
  name: z.string().min(1).max(100),
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  seats: z.array(SeatDefinitionInputSchema).min(1),
});

export const UpdateSeatMapSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
  })
  .refine((d) => d.name !== undefined, {
    message: 'Au moins un champ est requis',
  });

// ------------------------------------------------------------------
// Dashboard (GAP B)
// ------------------------------------------------------------------

export const DashboardQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ------------------------------------------------------------------
// Types exportés
// ------------------------------------------------------------------

export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;
export type CreateVehicleInput = z.infer<typeof CreateVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof UpdateVehicleSchema>;
export type UpdateCooperativeInput = z.infer<typeof UpdateCooperativeSchema>;
export type UpsertPolicyInput = z.infer<typeof UpsertPolicySchema>;
export type CreateSeatMapInput = z.infer<typeof CreateSeatMapSchema>;
export type UpdateSeatMapInput = z.infer<typeof UpdateSeatMapSchema>;
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;
