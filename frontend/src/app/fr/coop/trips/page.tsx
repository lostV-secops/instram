'use client';

/**
 * Liste des trajets (TripInstance) — /fr/coop/trips
 *
 * Charge GET /coop/trips avec filtres date + statut.
 * Filtres persistés dans l'URL (searchParams) via router.push.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { TripInstance, TripInstanceList, TripStatus } from '@/lib/types';

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Tous les statuts' },
  { value: 'DRAFT', label: 'Brouillon' },
  { value: 'OPEN_FOR_BOOKING', label: 'Ouvert' },
  { value: 'CLOSED_FOR_BOOKING', label: 'Fermé' },
  { value: 'DEPARTED', label: 'En route' },
  { value: 'COMPLETED', label: 'Terminé' },
  { value: 'CANCELLED', label: 'Annulé' },
];

function statusVariant(
  status: TripStatus,
): 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (status) {
    case 'OPEN_FOR_BOOKING': return 'success';
    case 'DRAFT': return 'neutral';
    case 'CLOSED_FOR_BOOKING': return 'warning';
    case 'DEPARTED': case 'COMPLETED': return 'info';
    case 'CANCELLED': return 'error';
    default: return 'default';
  }
}

const STATUS_LABELS: Record<TripStatus, string> = {
  DRAFT: 'Brouillon',
  OPEN_FOR_BOOKING: 'Ouvert',
  CLOSED_FOR_BOOKING: 'Fermé',
  DEPARTED: 'En route',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
};

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-MG', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function TripsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [from, setFrom] = useState(searchParams.get('from') ?? '');
  const [to, setTo] = useState(searchParams.get('to') ?? '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');
  const [trips, setTrips] = useState<TripInstance[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildUrl = useCallback((cursor?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (statusFilter) params.set('status', statusFilter);
    params.set('limit', '20');
    if (cursor) params.set('cursor', cursor);
    return `/api/proxy/v1/coop/trips?${params.toString()}`;
  }, [from, to, statusFilter]);

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TripInstanceList = await res.json();
      setTrips(data.items ?? []);
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
      const data: TripInstanceList = await res.json();
      setTrips((prev) => [...prev, ...(data.items ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      /* silencieux */
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => { loadTrips(); }, [loadTrips]);

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (statusFilter) params.set('status', statusFilter);
    router.push(`/fr/coop/trips?${params.toString()}`);
    loadTrips();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-brand-dark">Trajets</h1>
        <Link href="/fr/coop/trips/new">
          <Button variant="primary" size="sm">+ Nouveau trajet</Button>
        </Link>
      </div>

      {/* Filtres */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="from-date" className="text-xs font-medium text-gray-600">Du</label>
          <input
            id="from-date"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to-date" className="text-xs font-medium text-gray-600">Au</label>
          <input
            id="to-date"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="status-filter" className="text-xs font-medium text-gray-600">Statut</label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <Button variant="secondary" size="sm" onClick={applyFilters}>
          Filtrer
        </Button>
      </div>

      {/* Tableau */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center animate-pulse">
          <p className="text-sm text-gray-400">Chargement...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{error}</p>
            <button type="button" onClick={loadTrips} className="text-sm underline mt-1">Réessayer</button>
          </div>
        </div>
      ) : trips.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-500">
          Aucun trajet trouvé
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[550px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Ligne</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Départ</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-sm font-medium text-gray-900 truncate max-w-[10rem]">
                      {t.route ? `${t.route.originCity?.nameFr ?? '?'} → ${t.route.destinationCity?.nameFr ?? '?'}` : t.routeId}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-700 tabular-nums whitespace-nowrap">
                      {formatDateTime(t.departureAt)}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={statusVariant(t.status)}>
                        {STATUS_LABELS[t.status]}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/fr/coop/trips/${t.id}`}
                          className="text-brand text-sm font-medium hover:underline"
                        >
                          Voir
                        </Link>
                        <Link
                          href={`/fr/coop/trips/${t.id}/edit`}
                          className="text-gray-500 text-sm hover:underline"
                        >
                          Modifier
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {nextCursor && (
            <div className="px-4 py-3 border-t border-gray-200 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={loadMore}
                isLoading={loadingMore}
              >
                Charger plus
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
