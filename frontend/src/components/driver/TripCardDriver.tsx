'use client';

/**
 * Carte trajet pour l'application conducteur.
 *
 * Grand, tactile, lisible sans lunettes.
 * Hauteur minimale adaptée pour les doigts (min-h-24).
 * Affiche : route, heure de départ, passagers, statut.
 * Pas de vert (#9CC43D) — navigation uniquement.
 */

import Link from 'next/link';
import type { DriverTripSummary, TripStatus } from '@/lib/types';

interface TripCardDriverProps {
  trip: DriverTripSummary;
}

const statusLabels: Record<TripStatus, string> = {
  DRAFT: 'Brouillon',
  OPEN_FOR_BOOKING: 'Ouvert',
  CLOSED_FOR_BOOKING: 'Fermé',
  DEPARTED: 'En route',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
};

const statusColors: Record<TripStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  OPEN_FOR_BOOKING: 'bg-blue-100 text-blue-800',
  CLOSED_FOR_BOOKING: 'bg-yellow-100 text-yellow-800',
  DEPARTED: 'bg-indigo-100 text-indigo-800',
  COMPLETED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-red-100 text-red-700',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}h${m}`;
}

const IconChevron = () => (
  <svg
    className="w-5 h-5 text-gray-400 flex-shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const IconBus = () => (
  <svg
    className="w-4 h-4 text-gray-400 flex-shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <rect x="1" y="3" width="22" height="16" rx="2" />
    <path d="M1 11h22" />
    <path d="M5 19v2M19 19v2" />
    <circle cx="7" cy="15" r="1" />
    <circle cx="17" cy="15" r="1" />
  </svg>
);

const IconUsers = () => (
  <svg
    className="w-4 h-4 text-gray-400 flex-shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export function TripCardDriver({ trip }: TripCardDriverProps) {
  const { tripInstanceId, route, departureAt, vehicleRegistration, passengersCount, boardedCount, status } = trip;

  const boardingRatio = passengersCount > 0
    ? Math.round((boardedCount / passengersCount) * 100)
    : 0;

  return (
    <Link
      href={`/fr/driver/trips/${tripInstanceId}`}
      className={[
        'flex items-center gap-4 p-4 bg-white rounded-xl shadow-sm',
        'border border-gray-100 active:bg-gray-50',
        'transition-colors duration-100 min-h-[88px]',
        'focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2',
      ].join(' ')}
      aria-label={`Trajet ${route.originName} vers ${route.destinationName} — départ ${formatTime(departureAt)}`}
    >
      {/* Heure de départ — grande et lisible */}
      <div className="flex-shrink-0 text-center w-14">
        <span className="block text-2xl font-bold text-brand leading-none">
          {formatTime(departureAt)}
        </span>
        <span className="text-xs text-gray-500 mt-0.5 block">départ</span>
      </div>

      {/* Séparateur vertical */}
      <div className="w-px h-12 bg-gray-200 flex-shrink-0" aria-hidden="true" />

      {/* Infos trajet */}
      <div className="flex-1 min-w-0">
        {/* Route */}
        <p className="text-base font-semibold text-gray-900 truncate">
          {route.originName} → {route.destinationName}
        </p>

        {/* Métadonnées */}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {/* Véhicule */}
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <IconBus />
            {vehicleRegistration}
          </span>

          {/* Passagers */}
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <IconUsers />
            {boardedCount}/{passengersCount} passager{passengersCount > 1 ? 's' : ''}
          </span>

          {/* Statut (si disponible) */}
          {status && (
            <span
              className={[
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                statusColors[status],
              ].join(' ')}
            >
              {statusLabels[status]}
            </span>
          )}
        </div>

        {/* Barre de progression embarquement */}
        {passengersCount > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand rounded-full transition-all duration-300"
                style={{ width: `${boardingRatio}%` }}
                role="progressbar"
                aria-valuenow={boardedCount}
                aria-valuemin={0}
                aria-valuemax={passengersCount}
                aria-label={`${boardedCount} passagers embarqués sur ${passengersCount}`}
              />
            </div>
            <span className="text-xs text-gray-400 flex-shrink-0 w-8 text-right">
              {boardingRatio}%
            </span>
          </div>
        )}
      </div>

      {/* Flèche de navigation */}
      <IconChevron />
    </Link>
  );
}

export default TripCardDriver;
