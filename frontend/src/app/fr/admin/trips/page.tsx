'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { TripStatus } from '@/lib/types';

type AdminTripStatus = 'DRAFT' | 'OPEN_FOR_BOOKING' | 'BOARDING' | 'DEPARTED' | 'COMPLETED' | 'CANCELLED';

interface AdminTripCooperative {
  id: string;
  displayName: string;
}

interface AdminTripRoute {
  id: string;
  displayName: string;
}

interface AdminTripVehicle {
  id: string;
  registration: string;
  displayName: string | null;
}

interface AdminTripRow {
  id: string;
  departureAt: string;
  arrivalEstimatedAt: string | null;
  status: AdminTripStatus;
  cooperative: AdminTripCooperative;
  route: AdminTripRoute;
  vehicle: AdminTripVehicle | null;
  _count: { bookings: number; bookingSeats: number };
}

const TRIP_STATUS_OPTIONS: { value: AdminTripStatus | ''; label: string }[] = [
  { value: '', label: 'Tous les statuts' },
  { value: 'DRAFT', label: 'Brouillon' },
  { value: 'OPEN_FOR_BOOKING', label: 'Ouvert' },
  { value: 'BOARDING', label: 'Embarquement' },
  { value: 'DEPARTED', label: 'En route' },
  { value: 'COMPLETED', label: 'Terminé' },
  { value: 'CANCELLED', label: 'Annulé' },
];

const statusVariants: Record<AdminTripStatus, 'default' | 'success' | 'warning' | 'error' | 'neutral' | 'info'> = {
  DRAFT: 'neutral',
  OPEN_FOR_BOOKING: 'success',
  BOARDING: 'warning',
  DEPARTED: 'info',
  COMPLETED: 'default',
  CANCELLED: 'error',
};

const statusLabels: Record<AdminTripStatus, string> = {
  DRAFT: 'Brouillon',
  OPEN_FOR_BOOKING: 'Ouvert',
  BOARDING: 'Embarquement',
  DEPARTED: 'En route',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
};

const today = new Date().toISOString().slice(0, 10);

export default function AdminTripsPage() {
  const [statusFilter, setStatusFilter] = useState<AdminTripStatus | ''>('');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [trips, setTrips] = useState<AdminTripRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildUrl = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      if (fromDate) params.set('from', `${fromDate}T00:00:00.000Z`);
      if (toDate) params.set('to', `${toDate}T23:59:59.999Z`);
      if (cursor) params.set('cursor', cursor);
      return `/api/proxy/v1/admin/trips?${params.toString()}`;
    },
    [statusFilter, fromDate, toDate],
  );

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Erreur lors du chargement des trajets.');
      const data: { items: AdminTripRow[]; nextCursor: string | null } = await res.json();
      setTrips(data.items ?? []);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setError('Impossible de charger les trajets. Vérifiez votre connexion.');
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
      const data: { items: AdminTripRow[]; nextCursor: string | null } = await res.json();
      setTrips((prev) => [...prev, ...(data.items ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch { /* silencieux */ }
    finally { setLoadingMore(false); }
  };

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Tous les trajets</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Supervision globale — toutes coopératives confondues
        </p>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="from-date" className="text-xs text-gray-600">Du</label>
          <input
            id="from-date"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to-date" className="text-xs text-gray-600">Au</label>
          <input
            id="to-date"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="status-filter" className="text-xs text-gray-600">Statut</label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AdminTripStatus | '')}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand bg-white"
          >
            {TRIP_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Chargement */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded-lg" />
          ))}
        </div>
      )}

      {/* Erreur */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{error}</p>
            <button type="button" onClick={loadTrips} className="text-sm underline mt-1">Réessayer</button>
          </div>
        </div>
      )}

      {/* Tableau */}
      {!loading && !error && (
        <>
          {trips.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-sm text-gray-500">
              Aucun trajet pour ces filtres.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Coopérative</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ligne</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Départ</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Véhicule</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Rés.</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.map((trip) => (
                      <tr key={trip.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm text-gray-700 truncate max-w-[140px]">
                          {trip.cooperative.displayName}
                        </td>
                        <td className="py-3 px-4 text-sm text-brand-dark font-medium truncate max-w-[160px]">
                          {trip.route.displayName}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600 whitespace-nowrap">
                          {new Date(trip.departureAt).toLocaleString('fr-FR', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500">
                          {trip.vehicle ? (trip.vehicle.registration) : '—'}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-700 text-center">
                          {trip._count.bookings}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={statusVariants[trip.status]}>
                            {statusLabels[trip.status]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {nextCursor && (
            <div className="text-center pt-2">
              <Button variant="ghost" size="sm" isLoading={loadingMore} onClick={loadMore}>
                Charger plus
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
