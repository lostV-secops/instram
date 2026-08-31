import { z } from 'zod';

// =====================================================================
// Schémas Zod — module search
// Alignés sur docs/contrat-api.yaml §/search/trips
// =====================================================================

export const SearchTripsQuerySchema = z.object({
  originCityId: z.string().uuid('originCityId doit être un UUID'),
  destinationCityId: z.string().uuid('destinationCityId doit être un UUID'),
  /** Format date ISO YYYY-MM-DD */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date doit être au format YYYY-MM-DD'),
  passengers: z.coerce.number().int().min(1).max(20).default(1),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchTripsQuery = z.infer<typeof SearchTripsQuerySchema>;
