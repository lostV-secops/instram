'use client';

/**
 * Dashboard coopérative — /fr/coop
 *
 * Charge les KPIs via GET /coop/dashboard et affiche :
 *  - 4 StatsCards (trajets, réservations, recette nette, taux de remplissage)
 *  - Dernières réservations (GET /coop/bookings?limit=5)
 *  - Trajets du jour (GET /coop/trips?from=today&to=today)
 *
 * WebSocket canal cooperative:{id} — rafraîchit les données à chaque événement.
 *
 * États de chargement et d'erreur explicites (réseau instable = cas fréquent).
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useCoop } from './CoopContext';
import { StatsCard } from '@/components/coop/StatsCard';
import { BookingRow } from '@/components/coop/BookingRow';
import { TripRow } from '@/components/coop/TripRow';
import { useWebSocket } from '@/lib/ws';
import type {
  CooperativeDashboard,
  BookingList,
  TripInstanceList,
  Booking,
  TripInstance,
} from '@/lib/types';

function formatMGA(amount: number): string {
  return `${amount.toLocaleString('fr-MG')} Ar`;
}

function formatPct(rate: number): string {
  return `${Math.round(rate * 100)} %`;
}

export default function CoopDashboardPage() {
  const { cooperative } = useCoop();

  const [dashboard, setDashboard] = useState<CooperativeDashboard | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [trips, setTrips] = useState<TripInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // WS token pour abonnement temps réel
  const [wsToken, setWsToken] = useState<string | null>(null);

  const todayDate = new Date().toISOString().slice(0, 10);
  const todayFrom = `${todayDate}T00:00:00.000Z`;
  const todayTo = `${todayDate}T23:59:59.999Z`;

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [dashRes, bookRes, tripRes] = await Promise.all([
        fetch(
          `/api/proxy/v1/coop/dashboard?from=${todayFrom}&to=${todayTo}`,
          { cache: 'no-store' },
        ),
        fetch(
          `/api/proxy/v1/coop/bookings?limit=5`,
          { cache: 'no-store' },
        ),
        fetch(
          `/api/proxy/v1/coop/trips?from=${todayDate}&to=${todayDate}&limit=10`,
          { cache: 'no-store' },
        ),
      ]);

      if (!dashRes.ok || !bookRes.ok || !tripRes.ok) {
        throw new Error('Erreur lors du chargement des données');
      }

      const [dashData, bookData, tripData] = await Promise.all([
        dashRes.json() as Promise<CooperativeDashboard>,
        bookRes.json() as Promise<BookingList>,
        tripRes.json() as Promise<TripInstanceList>,
      ]);

      setDashboard(dashData);
      setBookings(bookData.items ?? []);
      setTrips(tripData.items ?? []);
    } catch {
      setError(
        'Erreur réseau. Vérifiez votre connexion et actualisez la page.',
      );
    } finally {
      setLoading(false);
    }
  }, [todayFrom, todayTo]);

  // Charger le WS token
  useEffect(() => {
    const getToken = async () => {
      try {
        const res = await fetch('/api/proxy/v1/realtime/ws-endpoint', {
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          setWsToken(data.ticket ?? null);
        }
      } catch { /* silencieux */ }
    };
    getToken();
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Abonnement WebSocket cooperative:{id}
  const { lastEvent } = useWebSocket(
    `cooperative:${cooperative.id}`,
    wsToken,
  );

  // Rafraîchir les données à chaque événement WS
  useEffect(() => {
    if (lastEvent) {
      loadData();
    }
  }, [lastEvent, loadData]);

  // ─── États ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-brand-dark">Tableau de bord</h1>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{error}</p>
            <button
              type="button"
              onClick={loadData}
              className="text-sm underline mt-1"
            >
              Réessayer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-brand-dark">Tableau de bord</h1>
          <p className="text-sm text-gray-500">Activité du {new Date().toLocaleDateString('fr-MG', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>

      {/* KPIs */}
      {dashboard && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatsCard
            label="Trajets prévus"
            value={dashboard.upcomingTrips}
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
          />
          <StatsCard
            label="Réservations"
            value={dashboard.bookingsOnline + dashboard.bookingsWalkIn}
            sub={`En ligne : ${dashboard.bookingsOnline} | Guichet : ${dashboard.bookingsWalkIn}`}
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></svg>}
          />
          <StatsCard
            label="Recette nette"
            value={formatMGA(dashboard.revenueNetMga)}
            sub={`Brute : ${formatMGA(dashboard.revenueGrossMga)}`}
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
          />
          <StatsCard
            label="Taux de remplissage"
            value={formatPct(dashboard.occupancyRate)}
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>}
          />
        </div>
      )}

      {/* Dernières réservations */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-brand-dark">
            Dernières réservations
          </h2>
          <Link
            href="/fr/coop/bookings"
            className="text-sm text-brand hover:underline"
          >
            Voir tout
          </Link>
        </div>

        {bookings.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-sm text-gray-500">
            Aucune réservation récente
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Référence</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Passager</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Trajet</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Canal</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Montant</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
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
          </div>
        )}
      </section>

      {/* Trajets du jour */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-brand-dark">
            Trajets aujourd'hui
          </h2>
          <Link
            href="/fr/coop/trips"
            className="text-sm text-brand hover:underline"
          >
            Voir tout
          </Link>
        </div>

        {trips.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-sm text-gray-500">
            Aucun trajet prévu aujourd'hui
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ligne</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Départ</th>
                    <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                    <th className="py-2 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {trips.map((t) => (
                    <TripRow
                      key={t.id}
                      tripId={t.id}
                      routeName={t.route ? `${t.route.originCity?.nameFr ?? '?'} → ${t.route.destinationCity?.nameFr ?? '?'}` : t.routeId}
                      departureAt={t.departureAt}
                      status={t.status}
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
