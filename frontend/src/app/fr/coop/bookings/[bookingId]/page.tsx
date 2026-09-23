'use client';

/**
 * Détail d'une réservation — /fr/coop/bookings/{bookingId}
 *
 * GET /coop/bookings/{bookingId}
 *
 * RG-03 : PAS de bouton "Annuler la réservation" — afficher le message
 * "Annulation au guichet uniquement".
 *
 * RG-02 : pour les réservations WALK_IN, ne pas afficher de commission.
 */

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Badge, bookingStatusVariant } from '@/components/ui/Badge';
import type { BookingDetail, BookingStatus } from '@/lib/types';

const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'En attente de paiement',
  CONFIRMED: 'Confirmée',
  PAYMENT_EXPIRED: 'Paiement expiré',
  PAYMENT_FAILED: 'Paiement échoué',
  CANCELLED_AT_COUNTER: 'Annulée au guichet',
  COMPLETED: 'Terminée',
  NO_SHOW: 'Absent',
};

function formatMGA(amount: number): string {
  return `${amount.toLocaleString('fr-MG')} Ar`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-MG', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function BookingDetailPage() {
  const params = useParams();
  const bookingId = params.bookingId as string;

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setError(null);
      try {
        const res = await fetch(`/api/proxy/v1/coop/bookings/${bookingId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status === 404 ? 'Réservation introuvable.' : 'Erreur de chargement.');
        setBooking(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur réseau.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [bookingId]);

  if (loading) {
    return (
      <div className="max-w-2xl space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-32" />
        <div className="h-48 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="max-w-2xl space-y-4">
        <Link href="/fr/coop/bookings" className="text-brand text-sm hover:underline">← Retour</Link>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {error ?? 'Réservation introuvable.'}
        </div>
      </div>
    );
  }

  const isWalkIn = booking.channel === 'WALK_IN';

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/fr/coop/bookings" className="text-brand text-sm hover:underline">← Réservations</Link>
        <Badge variant={bookingStatusVariant(booking.status)}>
          {STATUS_LABELS[booking.status]}
        </Badge>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-brand-dark font-mono">{booking.reference}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isWalkIn ? 'Réservation guichet (walk-in)' : 'Réservation en ligne'} —{' '}
            {formatDateTime(booking.createdAt)}
          </p>
        </div>
      </div>

      {/* Trajet */}
      {booking.trip && (
        <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Trajet</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">Ligne</dt>
              <dd className="font-medium">
                {/* backend coop endpoint returns { origin, destination } strings */}
                {(booking.trip.route as unknown as { origin?: string })?.origin ?? booking.trip.route?.originCity?.name ?? '—'}
                {' → '}
                {(booking.trip.route as unknown as { destination?: string })?.destination ?? booking.trip.route?.destinationCity?.name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Départ</dt>
              <dd className="font-medium">{formatDateTime(booking.trip.departureAt)}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* Passagers */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Passagers</h2>
        {booking.passengers?.length === 0 ? (
          <p className="text-sm text-gray-500">—</p>
        ) : (
          <div className="space-y-2">
            {booking.passengers?.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-2 border-b border-gray-100 last:border-0">
                <div>
                  <span className="font-medium">{p.firstName} {p.lastName}</span>
                  <span className="ml-2 text-gray-500 font-mono">Siège {p.seatCode}</span>
                </div>
                <span className={[
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  p.boardingStatus === 'BOARDED' ? 'bg-green-100 text-green-700' :
                  p.boardingStatus === 'ABSENT' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600',
                ].join(' ')}>
                  {p.boardingStatus === 'BOARDED' ? 'Embarqué' :
                   p.boardingStatus === 'ABSENT' ? 'Absent' : 'Non embarqué'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Montants */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Montants</h2>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Sous-total sièges</dt>
            <dd className="tabular-nums">{formatMGA(booking.seatSubtotalMga)}</dd>
          </div>
          {/* RG-02 : pour WALK_IN, ne pas afficher la commission (platformFee = 0) */}
          {!isWalkIn && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Frais plateforme</dt>
              <dd className="tabular-nums">{formatMGA(booking.platformFeeMga)}</dd>
            </div>
          )}
          {isWalkIn && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Frais plateforme</dt>
              <dd className="text-green-700 font-medium">Gratuit (walk-in, RG-02)</dd>
            </div>
          )}
          <div className="flex justify-between font-bold border-t border-gray-200 pt-1 mt-1">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMGA(booking.totalAmountMga)}</dd>
          </div>
        </dl>
      </section>

      {/* Paiements */}
      {booking.payments && booking.payments.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Paiement</h2>
          {booking.payments.map((p) => (
            <div key={p.id} className="text-sm flex justify-between">
              <span className="text-gray-600">{p.provider}</span>
              <span>{p.status} — {formatMGA(p.amountMga)}</span>
            </div>
          ))}
        </section>
      )}

      {/* RG-03 : Annulation au guichet uniquement — PAS de bouton d'annulation */}
      <div className="bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3 text-sm text-yellow-800 flex items-start gap-2">
        <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div>
          <p className="font-medium">Annulation au guichet uniquement</p>
          <p className="text-yellow-700 mt-0.5">
            L'annulation en ligne n'est pas disponible. Le passager doit se présenter physiquement au guichet de la coopérative.
          </p>
        </div>
      </div>
    </div>
  );
}
