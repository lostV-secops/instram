import { z } from 'zod';

// =====================================================================
// Schémas Zod — module catalog
// Alignés sur docs/contrat-api.yaml §/catalog/cities
// =====================================================================

export const ListCitiesQuerySchema = z.object({
  /** Recherche par nom FR ou MG (contrat : paramètre `q`) */
  q: z.string().optional(),
  region: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(20),
});

export type ListCitiesQuery = z.infer<typeof ListCitiesQuerySchema>;

export const CityIdParamSchema = z.object({
  id: z.string().uuid('ID ville invalide (uuid attendu)'),
});

export type CityIdParam = z.infer<typeof CityIdParamSchema>;
