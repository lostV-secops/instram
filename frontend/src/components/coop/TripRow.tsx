/**
 * Ligne de tableau — trajet (TripInstance).
 * Server Component (pas d'état, pas d'événements).
 */

import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import type { TripStatus } from '@/lib/types';
import { formatDateTimeMG } from '@/lib/i18n';

interface TripRowProps {
  tripId: string;
  routeName: string;
  departureAt: string;
  status: TripStatus;
  /** Facultatif — indisponible depuis la liste paginée GET /coop/trips */
  seatsSold?: number;
  /** Facultatif — indisponible depuis la liste paginée GET /coop/trips */
  seatsTotal?: number;
}

function statusLabel(status: TripStatus): string {
  const labels: Record<TripStatus, string> = {
    DRAFT: 'Brouillon',
    OPEN_FOR_BOOKING: 'Ouvert',
    CLOSED_FOR_BOOKING: 'Fermé',
    DEPARTED: 'En route',
    COMPLETED: 'Terminé',
    CANCELLED: 'Annulé',
  };
  return labels[status] ?? status;
}

function statusVariant(
  status: TripStatus,
): 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (status) {
    case 'OPEN_FOR_BOOKING':
      return 'success';
    case 'DRAFT':
      return 'neutral';
    case 'CLOSED_FOR_BOOKING':
      return 'warning';
    case 'DEPARTED':
    case 'COMPLETED':
      return 'info';
    case 'CANCELLED':
      return 'error';
    default:
      return 'default';
  }
}

function formatTime(iso: string): string {
  return formatDateTimeMG(iso, 'fr');
}

export function TripRow({
  tripId,
  routeName,
  departureAt,
  status,
  seatsSold,
  seatsTotal,
}: TripRowProps) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="py-3 px-4 text-sm font-medium text-gray-900 truncate max-w-[12rem]">
        {routeName}
      </td>
      <td className="py-3 px-4 text-sm text-gray-700 tabular-nums whitespace-nowrap">
        {formatTime(departureAt)}
      </td>
      <td className="py-3 px-4">
        <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
      </td>
      <td className="py-3 px-4 text-sm text-gray-700 tabular-nums">
        {seatsSold !== undefined && seatsTotal !== undefined
          ? `${seatsSold} / ${seatsTotal}`
          : '—'}
      </td>
      <td className="py-3 px-4">
        <Link
          href={`/fr/coop/trips/${tripId}`}
          className="text-brand text-sm font-medium hover:underline"
        >
          Voir
        </Link>
      </td>
    </tr>
  );
}

export default TripRow;
