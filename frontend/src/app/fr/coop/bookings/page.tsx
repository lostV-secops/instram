'use client';

/**
 * Liste des réservations — /fr/coop/bookings
 *
 * Filtres : date, statut, canal (ONLINE/WALK_IN).
 * GET /coop/bookings avec pagination curseur.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { BookingRow } from '@/components/coop/BookingRow';
import type { BookingList } from '@/lib/types';

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'PENDING_PAYMENT', label: 'En attente' },
  { value: 'CONFIRMED', label: 'Confirmée' },
  { value: 'COMPLETED', label: 'Terminée' },
  { value: 'CANCELLED_AT_COUNTER', label: 'Annulée' },
  { value: 'NO_SHOW', label: 'Absent' },
  { value: 'PAYMENT_FAILED', label: 'Paiement échoué' },
];

const CHANNEL_OPTIONS = [
  { value: '', label: 'Tous les canaux' },
  { value: 'ONLINE', label: 'En ligne' },
  { value: 'WALK_IN', label: 'Guichet (walk-in)' },
];

export default function BookingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');
  const [channelFilter, setChannelFilter] = useState(searchParams.get('channel') ?? '');
  const [bookings, setBookings] = useState<BookingList['items']>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildUrl = useCallback((cursor?: string) => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (channelFilter) params.set('channel', channelFilter);
    params.set('limit', '20');
    if (cursor) params.set('cursor', cursor);
    return `/api/proxy/v1/coop/bookings?${params.toString()}`;
  }, [statusFilter, channelFilter]);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BookingList = await res.json();
      setBookings(data.items ?? []);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion et réessayez.');
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(nextCursor), { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data: BookingList = await res.json();
      setBookings((prev) => [...prev, ...(data.items ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch { /* silencieux */ } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => { loadBookings(); }, [loadBookings]);

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (channelFilter) params.set('channel', channelFilter);
    router.push(`/fr/coop/bookings?${params.toString()}`);
    loadBookings();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-brand-dark">Réservations</h1>

      {/* Filtres */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="status-filter" className="text-xs font-medium text-gray-600">Statut</label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="channel-filter" className="text-xs font-medium text-gray-600">Canal</label>
          <select
            id="channel-filter"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {CHANNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <Button variant="secondary" size="sm" onClick={applyFilters}>Filtrer</Button>
      </div>

      {/* Tableau */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 animate-pulse text-center">
          <p className="text-sm text-gray-400">Chargement...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {error}
          <button type="button" onClick={loadBookings} className="block underline mt-1">Réessayer</button>
        </div>
      ) : bookings.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-500">
          Aucune réservation trouvée
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[650px]">
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
                {bookings.map((b) => (
                  <BookingRow
                    key={b.id}
                    bookingId={b.id}
                    reference={b.reference}
                    passengerName={b.buyer ? `${b.buyer.firstName ?? ''} ${b.buyer.lastName ?? ''}`.trim() || '—' : '—'}
                    tripLabel={b.tripInstance?.route ? `${b.tripInstance.route.origin} → ${b.tripInstance.route.destination}` : b.tripInstanceId}
                    channel={b.channel}
                    totalAmountMga={b.totalAmountMga}
                    platformFeeMga={b.platformFeeMga}
                    status={b.status}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {nextCursor && (
            <div className="px-4 py-3 border-t border-gray-200 text-center">
              <Button variant="ghost" size="sm" onClick={loadMore} isLoading={loadingMore}>
                Charger plus
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
