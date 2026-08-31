import { z } from 'zod';

// =====================================================================
// Schémas Zod — module seats
// Contrat : docs/contrat-api.yaml §/trips/{tripInstanceId}/seats/*
// =====================================================================

/**
 * POST /trips/:tripInstanceId/seats/hold
 * maxItems: 20 selon contrat-api.yaml (le contrat prime sur la valeur «6» mentionnée
 * dans les notes de conception).
 */
export const HoldSeatsSchema = z.object({
  seatDefinitionIds: z
    .array(z.string().uuid({ message: 'Chaque seatDefinitionId doit être un UUID valide' }))
    .min(1, { message: 'Au moins 1 siège requis' })
    .max(20, { message: '20 sièges maximum par hold' }),
});

export type HoldSeatsInput = z.infer<typeof HoldSeatsSchema>;

/**
 * DELETE /trips/:tripInstanceId/seats/hold/:holdId
 * Paramètres path uniquement — pas de body.
 */
export const HoldIdParamSchema = z.object({
  tripInstanceId: z.string().uuid(),
  holdId: z.string().uuid(),
});

export type HoldIdParam = z.infer<typeof HoldIdParamSchema>;
