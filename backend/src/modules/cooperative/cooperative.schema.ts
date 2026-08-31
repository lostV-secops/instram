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

// ------------------------------------------------------------------
// Types exportés
// ------------------------------------------------------------------

export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;
export type CreateVehicleInput = z.infer<typeof CreateVehicleSchema>;
