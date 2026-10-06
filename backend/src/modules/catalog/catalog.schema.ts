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

export const CreateCitySchema = z.object({
  nameFr: z.string().min(2).max(100),
  nameMg: z.string().min(2).max(100),
  district: z.string().min(2).max(100),
  region: z.string().min(2).max(100),
  code: z.string().min(2).max(20).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export type CreateCity = z.infer<typeof CreateCitySchema>;
