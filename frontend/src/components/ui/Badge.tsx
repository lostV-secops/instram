/**
 * Composant Badge pour les statuts (réservations, sièges, paiements).
 */

import type { BookingStatus, PaymentStatus } from '@/lib/types';

type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
  info: 'bg-blue-100 text-blue-800',
  neutral: 'bg-gray-200 text-gray-600',
};

export function Badge({
  children,
  variant = 'default',
  className = '',
}: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}

/** Mappe un BookingStatus vers une variante de Badge */
export function bookingStatusVariant(status: BookingStatus): BadgeVariant {
  switch (status) {
    case 'CONFIRMED':
      return 'success';
    case 'COMPLETED':
      return 'info';
    case 'PENDING_PAYMENT':
      return 'warning';
    case 'PAYMENT_EXPIRED':
    case 'PAYMENT_FAILED':
    case 'CANCELLED_AT_COUNTER':
    case 'NO_SHOW':
      return 'error';
    default:
      return 'neutral';
  }
}

/** Mappe un PaymentStatus vers une variante de Badge */
export function paymentStatusVariant(status: PaymentStatus): BadgeVariant {
  switch (status) {
    case 'CONFIRMED':
      return 'success';
    case 'INITIATED':
    case 'PENDING':
      return 'warning';
    case 'FAILED':
    case 'EXPIRED':
      return 'error';
    case 'REFUNDED_AT_COUNTER':
      return 'info';
    default:
      return 'neutral';
  }
}

export default Badge;
