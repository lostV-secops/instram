import { z } from 'zod';

// =====================================================================
// InsTRAM — Schémas Zod du module driver
// Contrat : docs/contrat-api.yaml §Driver
// Architecture : docs/architecture.md §6.5 (flux embarquement conducteur)
// =====================================================================

// ------------------------------------------------------------------
// Paramètre de route commun
// ------------------------------------------------------------------

export const TripInstanceIdParamSchema = z.object({
  tripInstanceId: z.string().uuid('tripInstanceId doit être un UUID valide'),
});

// ------------------------------------------------------------------
// POST /v1/driver/trips/:tripInstanceId/board
// L'un des deux champs est obligatoire (validé par refine).
// ------------------------------------------------------------------

export const BoardRequestSchema = z
  .object({
    bookingReference: z.string().min(1, 'bookingReference ne peut pas être vide').optional(),
    qrPayload: z.string().min(1, 'qrPayload ne peut pas être vide').optional(),
  })
  .refine(
    (d) => d.bookingReference !== undefined || d.qrPayload !== undefined,
    { message: 'bookingReference ou qrPayload est obligatoire (l\'un des deux)' },
  );

// ------------------------------------------------------------------
// POST /v1/driver/trips/:tripInstanceId/no-show
// ------------------------------------------------------------------

export const NoShowRequestSchema = z.object({
  bookingId: z.string().uuid('bookingId doit être un UUID valide'),
  reason: z.string().optional(),
});

// ------------------------------------------------------------------
// POST /v1/driver/trips/:tripInstanceId/depart
// Corps optionnel — aucun champ requis.
// ------------------------------------------------------------------

export const DepartRequestSchema = z
  .object({
    notes: z.string().optional(),
  })
  .optional()
  .default({});

// ------------------------------------------------------------------
// Types exportés
// ------------------------------------------------------------------

export type TripInstanceIdParam = z.infer<typeof TripInstanceIdParamSchema>;
export type BoardInput = z.infer<typeof BoardRequestSchema>;
export type NoShowInput = z.infer<typeof NoShowRequestSchema>;
export type DepartInput = { notes?: string };
