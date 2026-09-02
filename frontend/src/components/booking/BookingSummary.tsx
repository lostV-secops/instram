/**
 * Récapitulatif de la réservation — affichage des sièges sélectionnés,
 * prix détaillés et informations du trajet.
 * Component pur (pas d'état) — peut être Server ou Client Component.
 */

import type { TripInstanceDetail, SeatHoldResponse } from '@/lib/types';
import type { Translations } from '@/lib/i18n';

interface BookingSummaryProps {
  trip: TripInstanceDetail;
  hold: SeatHoldResponse;
  t: Translations;
}

function formatMGA(amount: number): string {
  return amount.toLocaleString('fr-MG');
}

function formatDateTime(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString('fr-MG', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoDate;
  }
}

export function BookingSummary({ trip, hold, t }: BookingSummaryProps) {
  const seatSubtotal = hold.seats.reduce((sum, s) => sum + s.priceMga, 0);
  // Frais de service : max(1000, 3%) — calcul exact côté backend, ici estimation
  const platformFeeEstimate = Math.max(1000, Math.round(seatSubtotal * 0.03));
  const totalEstimate = seatSubtotal + platformFeeEstimate;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
      {/* Trajet */}
      <section aria-labelledby="summary-trip">
        <h2
          id="summary-trip"
          className="text-sm font-semibold text-brand-dark uppercase tracking-wide mb-3"
        >
          {t.bookingDetail.trip}
        </h2>
        <div className="space-y-1 text-sm text-gray-700">
          <p>
            <span className="font-medium">{t.tripDetail.cooperative} : </span>
            {trip.cooperative.displayName}
          </p>
          <p>
            <span className="font-medium">{t.tripDetail.departure} : </span>
            {trip.route.originCity.name} → {trip.route.destinationCity.name}
          </p>
          <p>
            <span className="font-medium">{t.tripDetail.departure} : </span>
            {formatDateTime(trip.departureAt)}
          </p>
          {trip.arrivalEstimatedAt && (
            <p>
              <span className="font-medium">{t.tripDetail.arrival} : </span>
              {formatDateTime(trip.arrivalEstimatedAt)}
            </p>
          )}
        </div>
      </section>

      {/* Sièges sélectionnés */}
      <section aria-labelledby="summary-seats">
        <h2
          id="summary-seats"
          className="text-sm font-semibold text-brand-dark uppercase tracking-wide mb-3"
        >
          {t.seats.title}
        </h2>
        <ul className="space-y-1" role="list">
          {hold.seats.map((seat) => (
            <li
              key={seat.seatDefinitionId}
              className="flex justify-between text-sm text-gray-700"
            >
              <span>
                {t.booking.seat} {seat.code}
              </span>
              <span className="font-medium tabular-nums">
                {formatMGA(seat.priceMga)} {t.common.ariary}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Prix total */}
      <section aria-labelledby="summary-price">
        <h2
          id="summary-price"
          className="text-sm font-semibold text-brand-dark uppercase tracking-wide mb-3"
        >
          {t.booking.total}
        </h2>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>{t.booking.subtotal}</span>
            <span className="tabular-nums">
              {formatMGA(seatSubtotal)} {t.common.ariary}
            </span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>{t.booking.platformFee}</span>
            <span className="tabular-nums">
              ≈ {formatMGA(platformFeeEstimate)} {t.common.ariary}
            </span>
          </div>
          <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-200">
            <span>{t.booking.total}</span>
            <span className="tabular-nums text-base">
              ≈ {formatMGA(totalEstimate)} {t.common.ariary}
            </span>
          </div>
          <p className="text-xs text-gray-500 pt-1">
            {/* Note : le montant exact est calculé côté serveur lors de la création du booking */}
            {t.common.ariary === 'Ar'
              ? 'Montant exact calculé lors de la confirmation.'
              : 'Vola marina voatombana amin\'ny fanamafisana.'}
          </p>
        </div>
      </section>
    </div>
  );
}

export default BookingSummary;
