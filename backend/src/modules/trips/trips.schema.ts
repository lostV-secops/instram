import { z } from 'zod';

// =====================================================================
// Trips module — Zod schemas
// Contrat : docs/contrat-api.yaml §Cooperative (routes, schedules, trips)
//           et §Traveler-Trips (GET /trips/:id voyageur)
//
// Ambiguïtés documentées :
//   - Le modèle Schedule (schema.prisma) ne possède pas de champ vehicleId
//     ni arrivalTime. La tâche les mentionne mais la source de vérité
//     technique (schema.prisma) ne les supporte pas : ces champs sont ignorés.
//   - Le champ priceMga est utilisé (contrat + schema). La tâche mentionne
//     priceAr qui n'est pas dans le contrat officiel.
// =====================================================================

// ------------------------------------------------------------------
// Routes
// ------------------------------------------------------------------

export const CreateRouteSchema = z.object({
  originCityId: z.string().uuid(),
  destinationCityId: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  distanceKm: z.number().int().positive().optional(),
  estimatedDurationMin: z.number().int().positive().optional(),
});

export const UpdateRouteSchema = CreateRouteSchema.partial();

export type CreateRouteInput = z.infer<typeof CreateRouteSchema>;
export type UpdateRouteInput = z.infer<typeof UpdateRouteSchema>;

// ------------------------------------------------------------------
// Schedules
// ------------------------------------------------------------------

export const CreateScheduleSchema = z.object({
  routeId: z.string().uuid(),
  /** Jours de la semaine : 0=Dim, 1=Lun, ..., 6=Sam */
  daysOfWeek: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .refine((d) => new Set(d).size === d.length, { message: 'Doublons dans daysOfWeek' }),
  /** Format HH:mm, heure locale Madagascar (UTC+3) */
  departureTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Format HH:mm requis (ex. 08:30)'),
});

export const UpdateScheduleSchema = CreateScheduleSchema.partial();

export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;

// ------------------------------------------------------------------
// TripInstance
// ------------------------------------------------------------------

export const CreateTripSchema = z
  .object({
    /** Lier à un gabarit récurrent — route déduite du schedule */
    scheduleId: z.string().uuid().optional(),
    /** Route ad-hoc (si pas de scheduleId) */
    routeId: z.string().uuid().optional(),
    vehicleId: z.string().uuid(),
    departureAt: z.string().datetime({ message: 'departureAt doit être un datetime ISO 8601' }),
    arrivalEstimatedAt: z
      .string()
      .datetime({ message: 'arrivalEstimatedAt doit être un datetime ISO 8601' })
      .optional(),
    notesFr: z.string().max(2000).optional(),
    notesMg: z.string().max(2000).optional(),
  })
  .refine((d) => d.scheduleId || d.routeId, {
    message: 'scheduleId ou routeId est requis',
    path: ['scheduleId'],
  });

export type CreateTripInput = z.infer<typeof CreateTripSchema>;

// ------------------------------------------------------------------
// Tarifs
// ------------------------------------------------------------------

const FareItemSchema = z.object({
  seatCategory: z.enum(['VIP', 'PREMIUM', 'CLASSIC', 'STANDARD']),
  /** Prix en Ariary (MGA), souveraineté coopérative — aucune validation InsTRAM (RG-04) */
  priceMga: z.number().int().min(0),
});

export const UpsertFaresSchema = z.array(FareItemSchema).min(1);

export type FareItem = z.infer<typeof FareItemSchema>;

// ------------------------------------------------------------------
// Filtres liste de trajets
// ------------------------------------------------------------------

export const TripListQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  status: z
    .enum(['DRAFT', 'OPEN_FOR_BOOKING', 'CLOSED_FOR_BOOKING', 'DEPARTED', 'COMPLETED', 'CANCELLED'])
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type TripListQuery = z.infer<typeof TripListQuerySchema>;
