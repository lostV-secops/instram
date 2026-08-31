import {
  publishToChannel,
  type WsEvent,
  type WsEventType,
} from '../../infra/ws/pubsub';
import {
  tripChannel,
  bookingChannel,
  coopChannel,
  driverChannel,
} from '../../infra/ws/channels';

// =====================================================================
// InsTRAM — API de publication temps réel offerte aux modules métier
//
// Les modules `seats`, `bookings`, `payments`, `driver` ne doivent JAMAIS
// appeler `redis.publish` directement : le nom de canal et la forme de
// l'événement seraient dupliqués à chaque site d'appel, et une faute de
// frappe se traduirait par un siège qui reste visible chez les autres
// voyageurs — c'est-à-dire une double réservation possible.
//
// Règle d'usage : appeler ces helpers APRÈS le commit de la transaction
// PostgreSQL, jamais dedans. Un événement diffusé pour une transaction qui
// finit par rollback afficherait un siège indisponible qui ne l'est pas.
// =====================================================================

function base(type: WsEventType): WsEvent {
  return { type, at: new Date().toISOString() };
}

// ---------------------------------------------------------------------
// Sièges — canal trip:{tripInstanceId} (architecture §5.1)
// ---------------------------------------------------------------------

export interface SeatEventInput {
  tripInstanceId: string;
  seatDefinitionId: string;
  seatCode?: string;
  /** Fin de validité du hold (SEAT_HELD uniquement). */
  expiresAt?: Date;
}

async function emitSeatEvent(
  type: Extract<WsEventType, 'SEAT_HELD' | 'SEAT_SOLD' | 'SEAT_RELEASED'>,
  input: SeatEventInput,
): Promise<void> {
  const event: WsEvent = {
    ...base(type),
    tripInstanceId: input.tripInstanceId,
    seatDefinitionId: input.seatDefinitionId,
  };
  if (input.seatCode) event.seatCode = input.seatCode;
  if (input.expiresAt) event.payload = { expiresAt: input.expiresAt.toISOString() };

  await publishToChannel(tripChannel(input.tripInstanceId), event);
}

/** Siège pris en option (hold) — il doit devenir gris chez tous les autres. */
export const emitSeatHeld = (input: SeatEventInput): Promise<void> =>
  emitSeatEvent('SEAT_HELD', input);

/** Siège vendu — état terminal, aucun retour possible côté application. */
export const emitSeatSold = (input: SeatEventInput): Promise<void> =>
  emitSeatEvent('SEAT_SOLD', input);

/** Hold expiré ou relâché — le siège redevient sélectionnable. */
export const emitSeatReleased = (input: SeatEventInput): Promise<void> =>
  emitSeatEvent('SEAT_RELEASED', input);

/** Variante lot : un seul aller-retour Redis par siège, ordre préservé. */
export async function emitSeatBatch(
  type: Extract<WsEventType, 'SEAT_HELD' | 'SEAT_SOLD' | 'SEAT_RELEASED'>,
  tripInstanceId: string,
  seats: { seatDefinitionId: string; seatCode?: string }[],
  expiresAt?: Date,
): Promise<void> {
  for (const seat of seats) {
    await emitSeatEvent(type, { tripInstanceId, ...seat, expiresAt });
  }
}

// ---------------------------------------------------------------------
// Réservations — canal booking:{userId}
// ---------------------------------------------------------------------

export interface BookingEventInput {
  userId: string;
  bookingId: string;
  tripInstanceId?: string;
  payload?: Record<string, unknown>;
}

export async function emitBookingConfirmed(input: BookingEventInput): Promise<void> {
  const event: WsEvent = {
    ...base('BOOKING_CONFIRMED'),
    userId: input.userId,
    bookingId: input.bookingId,
  };
  if (input.tripInstanceId) event.tripInstanceId = input.tripInstanceId;
  if (input.payload) event.payload = input.payload;

  await publishToChannel(bookingChannel(input.userId), event);
}

export async function emitBookingPaymentFailed(input: BookingEventInput): Promise<void> {
  const event: WsEvent = {
    ...base('BOOKING_PAYMENT_FAILED'),
    userId: input.userId,
    bookingId: input.bookingId,
  };
  if (input.tripInstanceId) event.tripInstanceId = input.tripInstanceId;
  if (input.payload) event.payload = input.payload;

  await publishToChannel(bookingChannel(input.userId), event);
}

// ---------------------------------------------------------------------
// Back-office coopérative — canal cooperative:{cooperativeId}
// ---------------------------------------------------------------------

export async function emitCoopDashboardUpdate(
  cooperativeId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await publishToChannel(coopChannel(cooperativeId), {
    ...base('COOP_DASHBOARD_UPDATE'),
    cooperativeId,
    payload,
  });
}

// ---------------------------------------------------------------------
// Application conducteur — canal driver:{tripInstanceId}
// ---------------------------------------------------------------------

export async function emitDriverBoardingUpdate(
  tripInstanceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await publishToChannel(driverChannel(tripInstanceId), {
    ...base('DRIVER_BOARDING_UPDATE'),
    tripInstanceId,
    payload,
  });
}
