'use client';

/**
 * Page d'accueil conducteur — Trajets du jour.
 *
 * Fetch GET /api/proxy/v1/driver/trips/today
 * Liste de TripCardDriver avec état vide, chargement, erreur.
 * Bouton "Actualiser" manual — pas de polling automatique.
 */

import { useState, useEffect, useCallback } from 'react';
import { TripCardDriver } from '@/components/driver/TripCardDriver';
import { Button } from '@/components/ui/Button';
import type { DriverTripSummary } from '@/lib/types';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; trips: DriverTripSummary[] }
  | { status: 'error'; message: string };

const IconRefresh = ({ spinning }: { spinning: boolean }) => (
  <svg
    className={`w-5 h-5 ${spinning ? 'animate-spin' : ''}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export default function DriverTripsPage() {
  const [pageState, setPageState] = useState<PageState>({ status: 'loading' });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadTrips = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else {
      setPageState({ status: 'loading' });
    }

    try {
      const response = await fetch('/api/proxy/v1/driver/trips/today', {
        cache: 'no-store',
      });

      if (!response.ok) {
        const message =
          response.status >= 500
            ? 'Erreur serveur. Veuillez réessayer dans quelques instants.'
            : 'Impossible de charger les trajets. Vérifiez votre connexion.';
        setPageState({ status: 'error', message });
        return;
      }

      const trips = await response.json() as DriverTripSummary[];
      setPageState({ status: 'ready', trips: Array.isArray(trips) ? trips : [] });

    } catch {
      setPageState({
        status: 'error',
        message: 'Problème de connexion réseau. Vérifiez votre connexion et réessayez.',
      });
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Chargement initial
  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  // ─── En-tête de la page ────────────────────────────────────────────────────
  const Header = () => (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-10">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Trajets du jour</h1>
        <p className="text-xs text-gray-500">
          {new Date().toLocaleDateString('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
      </div>
      <button
        type="button"
        onClick={() => loadTrips(true)}
        disabled={isRefreshing || pageState.status === 'loading'}
        aria-label="Actualiser la liste des trajets"
        className={[
          'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium',
          'text-brand border border-brand/30 bg-brand/5',
          'hover:bg-brand/10 active:bg-brand/20',
          'focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1',
          'min-h-[40px] transition-colors duration-150',
          isRefreshing ? 'opacity-60' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <IconRefresh spinning={isRefreshing} />
        <span>{isRefreshing ? 'Actualisation...' : 'Actualiser'}</span>
      </button>
    </div>
  );

  // ─── État de chargement ────────────────────────────────────────────────────
  if (pageState.status === 'loading') {
    return (
      <div>
        <Header />
        <div className="flex flex-col items-center justify-center py-16 px-4 gap-3">
          <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Chargement des trajets...</p>
        </div>
      </div>
    );
  }

  // ─── État d'erreur ─────────────────────────────────────────────────────────
  if (pageState.status === 'error') {
    return (
      <div>
        <Header />
        <div className="flex flex-col items-center justify-center py-12 px-4 gap-4 text-center">
          <svg
            className="w-12 h-12 text-red-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
          <p className="text-sm text-gray-700 font-medium max-w-xs">
            {pageState.message}
          </p>
          <Button
            variant="primary"
            size="md"
            onClick={() => loadTrips()}
          >
            Réessayer
          </Button>
        </div>
      </div>
    );
  }

  const { trips } = pageState;

  // ─── Liste vide ────────────────────────────────────────────────────────────
  if (trips.length === 0) {
    return (
      <div>
        <Header />
        <div className="flex flex-col items-center justify-center py-16 px-4 gap-3 text-center">
          <svg
            className="w-14 h-14 text-gray-300"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <rect x="1" y="3" width="22" height="16" rx="2" />
            <path d="M1 11h22M5 19v2M19 19v2" />
          </svg>
          <p className="text-base font-medium text-gray-500">
            Aucun trajet prévu aujourd&apos;hui
          </p>
          <p className="text-sm text-gray-400">
            Vos trajets assignés apparaîtront ici
          </p>
        </div>
      </div>
    );
  }

  // ─── Liste de trajets ─────────────────────────────────────────────────────
  return (
    <div>
      <Header />

      {/* Compteur */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
          {trips.length} trajet{trips.length > 1 ? 's' : ''} aujourd&apos;hui
        </p>
      </div>

      {/* Liste */}
      <ul className="px-4 py-2 space-y-3" role="list" aria-label="Liste des trajets du jour">
        {trips.map((trip) => (
          <li key={trip.tripInstanceId}>
            <TripCardDriver trip={trip} />
          </li>
        ))}
      </ul>

      {/* Pied de page informatif */}
      <p className="px-4 py-4 text-xs text-center text-gray-400">
        Appuyez sur un trajet pour voir les détails et scanner les passagers
      </p>
    </div>
  );
}
