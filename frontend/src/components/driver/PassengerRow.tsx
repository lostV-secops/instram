'use client';

/**
 * Ligne passager dans le manifeste conducteur.
 *
 * Affiche : nom complet, numéro de siège, badge de statut embarquement.
 * Hauteur min 56 px pour faciliter la lecture debout dans un véhicule.
 * Badge couleurs :
 *  - BOARDED   → vert (success) — confirmation d'embarquement
 *  - ABSENT    → rouge (error)
 *  - NOT_BOARDED → gris (neutral) — en attente
 *
 * Note : le vert du badge (bg-green-100 / text-green-800) est une couleur
 * système UI standard, distincte du vert transactionnel #9CC43D (action).
 */

import type { ManifestPassenger, BoardingStatus } from '@/lib/types';

interface PassengerRowProps {
  passenger: ManifestPassenger;
}

const boardingStatusConfig: Record<
  BoardingStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  BOARDED: {
    label: 'Embarqué',
    badgeClass: 'bg-green-100 text-green-800',
    dotClass: 'bg-green-500',
  },
  ABSENT: {
    label: 'Absent',
    badgeClass: 'bg-red-100 text-red-800',
    dotClass: 'bg-red-500',
  },
  NOT_BOARDED: {
    label: 'En attente',
    badgeClass: 'bg-gray-100 text-gray-600',
    dotClass: 'bg-gray-400',
  },
};

const IconSeat = () => (
  <svg
    className="w-3.5 h-3.5 text-gray-400"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path d="M20.5 17H3.5a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h17a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1z" />
    <path d="M5 17V7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6a4 4 0 0 0 4 4" />
  </svg>
);

export function PassengerRow({ passenger }: PassengerRowProps) {
  const {
    firstName,
    lastName,
    seatCode,
    boardingStatus,
    bookingReference,
    channel,
  } = passenger;

  const config = boardingStatusConfig[boardingStatus];
  const fullName = `${firstName} ${lastName}`;

  return (
    <li className="flex items-center gap-3 py-3 px-1 min-h-[56px]">
      {/* Indicateur de statut (point coloré) */}
      <div
        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${config.dotClass}`}
        aria-hidden="true"
      />

      {/* Infos passager */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{fullName}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {/* Numéro de siège */}
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <IconSeat />
            Siège {seatCode}
          </span>
          {/* Référence courte */}
          <span className="text-xs text-gray-400 font-mono">{bookingReference}</span>
          {/* Canal walk-in */}
          {channel === 'WALK_IN' && (
            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">
              Guichet
            </span>
          )}
        </div>
      </div>

      {/* Badge statut embarquement */}
      <span
        className={[
          'flex-shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
          config.badgeClass,
        ].join(' ')}
        role="status"
        aria-label={`Statut : ${config.label}`}
      >
        {config.label}
      </span>
    </li>
  );
}

export default PassengerRow;
