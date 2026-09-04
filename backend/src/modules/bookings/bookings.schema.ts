import { z } from 'zod';

// =====================================================================
// Schémas Zod — module bookings
// Contrat : docs/contrat-api.yaml §Traveler-Bookings, §Cooperative-Bookings
// =====================================================================

// ------------------------------------------------------------------
// PassengerRequest (réutilisé ONLINE + WALK-IN)
// ------------------------------------------------------------------
export const PassengerRequestSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  nationalIdRef: z.string().optional(),
  seatCode: z.string().min(1, { message: 'seatCode requis pour chaque passager' }),
});

export type PassengerRequestInput = z.infer<typeof PassengerRequestSchema>;

// ------------------------------------------------------------------
// POST /bookings — CreateBookingRequest (contrat-api.yaml)
// Note : le contrat utilise holdId (singulier) et passengers (pluriel).
// Le paymentMethod est sur le POST /payments séparé (voir bookings.routes.ts).
// ------------------------------------------------------------------
export const CreateBookingSchema = z.object({
  holdId: z.string().uuid({ message: 'holdId doit être un UUID valide' }),
  passengers: z
    .array(PassengerRequestSchema)
    .min(1, { message: 'Au moins 1 passager requis' }),
  contactPhone: z.string().optional(),
  preferredLang: z.enum(['FR', 'MG']).optional(),
});

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;

// ------------------------------------------------------------------
// POST /payments — InitiatePaymentRequest (contrat-api.yaml)
// ------------------------------------------------------------------
export const InitiatePaymentSchema = z.object({
  bookingId: z.string().uuid(),
  provider: z.enum(['MVOLA', 'ORANGE_MONEY']),
  payerPhone: z.string().min(1),
});

export type InitiatePaymentInput = z.infer<typeof InitiatePaymentSchema>;

// ------------------------------------------------------------------
// POST /coop/bookings/walk-in — WalkInBookingRequest (contrat-api.yaml)
// RG-02 : PlatformFee = 0, Commission = 0 sans exception
// ------------------------------------------------------------------
export const WalkInBookingSchema = z.object({
  tripInstanceId: z.string().uuid(),
  seatDefinitionIds: z
    .array(z.string().uuid())
    .min(1, { message: 'Au moins 1 siège requis' }),
  passengers: z
    .array(PassengerRequestSchema)
    .min(1, { message: 'Au moins 1 passager requis' }),
  paymentMethod: z.enum(['CASH', 'MVOLA', 'ORANGE_MONEY']),
  buyerPhone: z.string().optional(),
  buyerLang: z.enum(['FR', 'MG']).optional(),
});

export type WalkInBookingInput = z.infer<typeof WalkInBookingSchema>;

// ------------------------------------------------------------------
// POST /coop/bookings/:id/cancel-at-counter (contrat-api.yaml)
// Seul point d'annulation autorisé (RG-03). Pas de remboursement automatique.
// ------------------------------------------------------------------
export const CancelAtCounterSchema = z.object({
  reason: z.string().min(1, { message: 'Le motif est requis' }),
  refundedAtCounter: z.boolean().default(false),
});

export type CancelAtCounterInput = z.infer<typeof CancelAtCounterSchema>;

// ------------------------------------------------------------------
// GET /bookings — query params
// ------------------------------------------------------------------
export const BookingListQuerySchema = z.object({
  status: z
    .enum([
      'PENDING_PAYMENT',
      'CONFIRMED',
      'PAYMENT_EXPIRED',
      'PAYMENT_FAILED',
      'CANCELLED_AT_COUNTER',
      'COMPLETED',
      'NO_SHOW',
    ])
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export type BookingListQueryInput = z.infer<typeof BookingListQuerySchema>;

// ------------------------------------------------------------------
// POST /webhooks/mobile-money/:provider — payload entrant opérateur
// Le contrat accepte any object ; on extrait les champs critiques.
// ------------------------------------------------------------------
export const WebhookPayloadSchema = z.object({
  providerTransactionId: z.string(),
  bookingReference: z.string().optional(), // Certains opérateurs le renvoient
  // C-2 : INITIATED ajouté pour no-op cohérent avec les opérateurs qui envoient ce statut
  status: z.enum(['SUCCESS', 'FAILED', 'EXPIRED', 'PENDING', 'INITIATED']),
  // H-4 : amountMga obligatoire et positif — requis pour validation du montant webhook
  amountMga: z.number().int().positive(),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
