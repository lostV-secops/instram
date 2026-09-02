/**
 * Ligne de tableau — réservation (Booking).
 * Server Component.
 */

import Link from 'next/link';
import { Badge, bookingStatusVariant } from '@/components/ui/Badge';
import type { BookingStatus, BookingChannel } from '@/lib/types';

interface BookingRowProps {
  bookingId: string;
  reference: string;
  passengerName: string;
  tripLabel: string;
  channel: BookingChannel;
  totalAmountMga: number;
  platformFeeMga: number;
  status: BookingStatus;
}

const channelLabels: Record<BookingChannel, string> = {
  ONLINE: 'En ligne',
  WALK_IN: 'Guichet',
};

const statusLabels: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'En attente',
  CONFIRMED: 'Confirmée',
  PAYMENT_EXPIRED: 'Expiré',
  PAYMENT_FAILED: 'Échoué',
  CANCELLED_AT_COUNTER: 'Annulée',
  COMPLETED: 'Terminée',
  NO_SHOW: 'Absent',
};

function formatMGA(amount: number): string {
  return `${amount.toLocaleString('fr-MG')} Ar`;
}

export function BookingRow({
  bookingId,
  reference,
  passengerName,
  tripLabel,
  channel,
  totalAmountMga,
  platformFeeMga,
  status,
}: BookingRowProps) {
  const isWalkIn = channel === 'WALK_IN';

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="py-3 px-4">
        <Link
          href={`/fr/coop/bookings/${bookingId}`}
          className="text-brand text-sm font-mono font-medium hover:underline"
        >
          {reference}
        </Link>
      </td>
      <td className="py-3 px-4 text-sm text-gray-900 truncate max-w-[10rem]">
        {passengerName}
      </td>
      <td className="py-3 px-4 text-sm text-gray-600 truncate max-w-[12rem]">
        {tripLabel}
      </td>
      <td className="py-3 px-4">
        <span
          className={[
            'text-xs font-medium px-2 py-0.5 rounded-full',
            isWalkIn
              ? 'bg-blue-100 text-blue-700'
              : 'bg-purple-100 text-purple-700',
          ].join(' ')}
        >
          {channelLabels[channel]}
        </span>
      </td>
      <td className="py-3 px-4 text-sm tabular-nums text-gray-900">
        {isWalkIn ? (
          <span title="Gratuit (RG-02)">{formatMGA(totalAmountMga)}</span>
        ) : (
          formatMGA(totalAmountMga)
        )}
      </td>
      <td className="py-3 px-4">
        <Badge variant={bookingStatusVariant(status)}>
          {statusLabels[status]}
        </Badge>
      </td>
    </tr>
  );
}

export default BookingRow;
