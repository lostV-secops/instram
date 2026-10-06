import { z } from 'zod';

// =====================================================================
// Schémas Zod — module exports
// Contrat : docs/contrat-api.yaml §Exports
//
// Hypothèses résolues :
//   - ExportJob.status utilise les valeurs du schéma Prisma :
//       QUEUED | RUNNING | READY | FAILED | EXPIRED
//     (la tâche mentionnait PENDING / COMPLETED ; le schéma Prisma fait foi)
//   - GET /admin/exports n'est pas dans le contrat-api.yaml mais est requis
//     par la tâche. Implémenté comme extension documentée.
// =====================================================================

// ------------------------------------------------------------------
// POST /coop/exports — ExportRequest
//
// Accepte deux structures équivalentes :
//   1. Plate (legacy) : { type, tripInstanceId?, dateFrom?, dateTo? }
//   2. Avec filters   : { type, format?, filters: { tripInstanceId?, from?, to? } }
// ------------------------------------------------------------------
const FiltersSchema = z.object({
  tripInstanceId: z.string().uuid({ message: 'tripInstanceId doit être un UUID valide' }).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from : format YYYY-MM-DD requis' }).optional(),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to : format YYYY-MM-DD requis' }).optional(),
}).optional();

export const CreateExportSchema = z.object({
  type: z.enum(['MANIFEST', 'FINANCIAL_REPORT'], {
    errorMap: () => ({ message: 'type doit être MANIFEST ou FINANCIAL_REPORT' }),
  }),
  format: z.string().optional(),
  // Structure plate (legacy)
  tripInstanceId: z.string().uuid({ message: 'tripInstanceId doit être un UUID valide' }).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateFrom : format YYYY-MM-DD requis' }).optional(),
  dateTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateTo : format YYYY-MM-DD requis' }).optional(),
  // Structure imbriquée (frontend)
  filters: FiltersSchema,
}).transform((d) => ({
  ...d,
  // Normaliser : les champs filters.* prennent le dessus sur les champs plats
  tripInstanceId: d.filters?.tripInstanceId ?? d.tripInstanceId,
  dateFrom: d.filters?.from ?? d.dateFrom,
  dateTo:   d.filters?.to   ?? d.dateTo,
})).refine(
  (d) => {
    if (d.type === 'MANIFEST' && !d.tripInstanceId) return false;
    return true;
  },
  { message: 'tripInstanceId est requis pour le type MANIFEST', path: ['tripInstanceId'] },
);

export type CreateExportInput = z.infer<typeof CreateExportSchema>;

// ------------------------------------------------------------------
// GET /admin/exports — paramètres de liste admin
// Extension documentée : endpoint absent du contrat-api.yaml
// ------------------------------------------------------------------
export const AdminExportListQuerySchema = z.object({
  cooperativeId: z.string().uuid().optional(),
  type: z.enum(['MANIFEST', 'FINANCIAL_REPORT', 'BOOKINGS', 'RATINGS']).optional(),
  status: z.enum(['QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type AdminExportListQueryInput = z.infer<typeof AdminExportListQuerySchema>;
