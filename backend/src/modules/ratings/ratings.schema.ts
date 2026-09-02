import { z } from 'zod';

// =====================================================================
// Schémas Zod — module ratings
// Contrat : docs/contrat-api.yaml §Traveler-Bookings (POST /bookings/{bookingId}/rating)
//           §Admin (GET /admin/ratings, PATCH /admin/ratings/{ratingId})
//
// Hypothèse : le champ `comment` unique est stocké dans Rating.commentFr.
// La détection de langue pourrait être ajoutée (via Accept-Language) en V2.
//
// RG-11 : notation possible uniquement si Booking.status = COMPLETED
// RG-12 : contrainte unique Rating.bookingId (une note par voyage)
// =====================================================================

// ------------------------------------------------------------------
// POST /bookings/{bookingId}/rating — RatingRequest
// ------------------------------------------------------------------
export const CreateRatingSchema = z.object({
  score: z
    .number({ invalid_type_error: 'score doit être un entier entre 1 et 5' })
    .int({ message: 'score doit être un entier' })
    .min(1, { message: 'score minimum : 1' })
    .max(5, { message: 'score maximum : 5' }),
  comment: z.string().max(2000, { message: 'Commentaire trop long (max 2000 caractères)' }).optional(),
});

export type CreateRatingInput = z.infer<typeof CreateRatingSchema>;

// ------------------------------------------------------------------
// GET /ratings/cooperative/:cooperativeId — paramètres de pagination
// ------------------------------------------------------------------
export const RatingListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type RatingListQueryInput = z.infer<typeof RatingListQuerySchema>;

// ------------------------------------------------------------------
// GET /admin/ratings — paramètres de modération
// ------------------------------------------------------------------
export const AdminRatingListQuerySchema = z.object({
  status: z.enum(['PENDING_REVIEW', 'PUBLISHED', 'REJECTED']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type AdminRatingListQueryInput = z.infer<typeof AdminRatingListQuerySchema>;

// ------------------------------------------------------------------
// PATCH /admin/ratings/{ratingId} — modération (contrat-api.yaml §Admin)
// ------------------------------------------------------------------
export const ModerateRatingSchema = z.object({
  status: z.enum(['PUBLISHED', 'REJECTED']),
  moderationNote: z.string().max(500).optional(),
});

export type ModerateRatingInput = z.infer<typeof ModerateRatingSchema>;
