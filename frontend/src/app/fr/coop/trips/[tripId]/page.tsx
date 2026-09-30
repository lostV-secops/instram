'use client';

/**
 * Détail d'un trajet — /fr/coop/trips/{tripId}
 *
 * Charge GET /coop/trips/{tripId} (TripInstanceCoopDetail).
 * Permet d'ouvrir/fermer le trajet à la réservation.
 * Affiche les réservations du trajet (GET /coop/bookings?tripInstanceId=...).
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { BookingRow } from '@/components/coop/BookingRow';
import type { TripInstanceCoopDetail, BookingList, TripStatus } from '@/lib/types';

const STATUS_LABELS: Record<TripStatus, string> = {
  DRAFT: 'Brouillon',
  OPEN_FOR_BOOKING: 'Ouvert à la réservation',
  CLOSED_FOR_BOOKING: 'Fermé à la réservation',
  DEPARTED: 'En route',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
};

function statusVariant(status: TripStatus) {
  switch (status) {
    case 'OPEN_FOR_BOOKING': return 'success' as const;
    case 'DRAFT': return 'neutral' as const;
    case 'CLOSED_FOR_BOOKING': return 'warning' as const;
    case 'DEPARTED': case 'COMPLETED': return 'info' as const;
    case 'CANCELLED': return 'error' as const;
    default: return 'default' as const;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-MG', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function formatMGA(amount: number): string {
  return `${amount.toLocaleString('fr-MG')} Ar`;
}

export default function TripDetailPage() {
  const params = useParams();
  const tripId = params.tripId as string;

  const [trip, setTrip] = useState<TripInstanceCoopDetail | null>(null);
  const [bookings, setBookings] = useState<BookingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [tripRes, bookRes] = await Promise.all([
        fetch(`/api/proxy/v1/coop/trips/${tripId}`, { cache: 'no-store' }),
        fetch(`/api/proxy/v1/coop/bookings?tripInstanceId=${tripId}&limit=50`, { cache: 'no-store' }),
      ]);
      if (!tripRes.ok) throw new Error(tripRes.status === 404 ? 'Trajet introuvable.' : 'Erreur de chargement.');
      const [tripData, bookData] = await Promise.all([
        tripRes.json() as Promise<TripInstanceCoopDetail>,
        bookRes.ok ? (bookRes.json() as Promise<BookingList>) : Promise.resolve({ items: [], nextCursor: null }),
      ]);
      setTrip(tripData);
      setBookings(bookData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (action: 'open' | 'close') => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/proxy/v1/coop/trips/${tripId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Erreur ${res.status}`);
      }
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse max-w-2xl">
        <div className="h-6 bg-gray-200 rounded w-32" />
        <div className="h-32 bg-gray-200 rounded-xl" />
        <div className="h-48 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Link href="/fr/coop/trips" className="text-brand text-sm hover:underline">← Retour</Link>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {error ?? 'Trajet introuvable.'}
          <button type="button" onClick={load} className="block underline mt-1">Réessayer</button>
        </div>
      </div>
    );
  }

  const { route, vehicle, departureAt, arrivalEstimatedAt, status, stats, fares } = trip;

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/fr/coop/trips" className="text-brand text-sm hover:underline">← Trajets</Link>
        <Badge variant={statusVariant(status)}>{STATUS_LABELS[status]}</Badge>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-brand-dark">
          {(route?.originCity as unknown as Record<string,string>)?.nameFr ?? route?.originCity?.name ?? '—'} → {(route?.destinationCity as unknown as Record<string,string>)?.nameFr ?? route?.destinationCity?.name ?? '—'}
        </h1>
        <Link href={`/fr/coop/trips/${tripId}/edit`}>
          <Button variant="secondary" size="sm">Modifier</Button>
        </Link>
      </div>

      {/* Infos trajet */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">Départ</dt>
            <dd className="font-medium text-gray-900">{formatDateTime(departureAt)}</dd>
          </div>
          {arrivalEstimatedAt && (
            <div>
              <dt className="text-gray-500">Arrivée estimée</dt>
              <dd className="text-gray-700">{formatDateTime(arrivalEstimatedAt)}</dd>
            </div>
          )}
          {vehicle && (
            <div>
              <dt className="text-gray-500">Véhicule</dt>
              <dd className="text-gray-700">{(vehicle as unknown as Record<string,string>).displayName ?? vehicle.model ?? vehicle.id}</dd>
            </div>
          )}
        </dl>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-gray-100">
            <div className="text-center">
              <p className="text-xs text-gray-500">Vendus</p>
              <p className="text-lg font-bold text-brand-dark tabular-nums">{stats.seatsSold}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Retenus</p>
              <p className="text-lg font-bold text-gray-500 tabular-nums">{stats.seatsHeld}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Revenus</p>
              <p className="text-lg font-bold text-brand-dark tabular-nums">{formatMGA(stats.revenueMga)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Actions statut */}
      {(status === 'DRAFT' || status === 'CLOSED_FOR_BOOKING') && (
        <div className="flex flex-wrap gap-3">
          {/* Vert pour action transactionnelle d'ouverture */}
          <Button
            variant="action"
            onClick={() => handleAction('open')}
            isLoading={actionLoading}
            disabled={actionLoading}
          >
            Ouvrir à la réservation
          </Button>
        </div>
      )}
      {status === 'OPEN_FOR_BOOKING' && (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            onClick={() => handleAction('close')}
            isLoading={actionLoading}
            disabled={actionLoading}
          >
            Fermer la réservation
          </Button>
        </div>
      )}

      {actionError && (
        <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
          {actionError}
        </div>
      )}

      {/* Tarifs — dédupliqués par catégorie (le seed crée 1 Fare par siège) */}
      {fares && fares.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold text-brand-dark">Tarifs</h2>
            <Link href={`/fr/coop/fares/${tripId}/edit`} className="text-sm text-brand hover:underline">Modifier</Link>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Catégorie</th>
                  <th className="py-2 px-4 text-right text-xs font-semibold text-gray-500 uppercase">Prix</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(
                  fares.reduce((map, f) => {
                    const key = f.category ?? 'AUTRE';
                    if (!map.has(key)) map.set(key, f.priceMga);
                    return map;
                  }, new Map<string, number>()),
                ).map(([cat, price]) => (
                  <tr key={cat} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 px-4">{cat}</td>
                    <td className="py-2 px-4 text-right tabular-nums font-medium">{formatMGA(price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Passagers / réservations */}
      <section>
        <h2 className="text-base font-semibold text-brand-dark mb-2">
          Réservations ({bookings?.items?.length ?? 0})
        </h2>
        {!bookings || bookings.items.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-sm text-gray-500">
            Aucun passager
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[550px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Référence</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Passager</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Trajet</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Canal</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Montant</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.items.map((b) => (
                    <BookingRow
                      key={b.id}
                      bookingId={b.id}
                      reference={b.reference}
                      passengerName={b.buyer ? `${b.buyer.firstName ?? ''} ${b.buyer.lastName ?? ''}`.trim() || '—' : '—'}
                      tripLabel=""
                      channel={b.channel}
                      totalAmountMga={b.totalAmountMga}
                      platformFeeMga={b.platformFeeMga}
                      status={b.status}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
