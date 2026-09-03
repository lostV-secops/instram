/**
 * Ligne de tableau pour une coopérative dans la console admin InsTRAM.
 * Affiche : nom, contact, note, statut avec badge coloré, lien vers le détail.
 */

import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import type { CooperativeStatus } from '@/lib/types';

type CoopBadgeVariant = 'warning' | 'success' | 'error' | 'neutral' | 'info' | 'default';

const statusLabels: Record<CooperativeStatus, string> = {
  PENDING_VALIDATION: 'En attente',
  VALIDATED: 'Active',
  SUSPENDED: 'Suspendue',
  REJECTED: 'Rejetée',
};

const statusVariants: Record<CooperativeStatus, CoopBadgeVariant> = {
  PENDING_VALIDATION: 'warning',
  VALIDATED: 'success',
  SUSPENDED: 'error',
  REJECTED: 'neutral',
};

interface CoopRowProps {
  coopId: string;
  legalName: string;
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  status: CooperativeStatus;
  ratingAverage: number;
  ratingCount: number;
}

export function CoopRow({
  coopId,
  legalName,
  displayName,
  contactEmail,
  contactPhone,
  status,
  ratingAverage,
  ratingCount,
}: CoopRowProps) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      {/* Nom */}
      <td className="py-3 px-4">
        <p className="font-medium text-brand-dark text-sm truncate max-w-[180px]">
          {displayName}
        </p>
        <p className="text-xs text-gray-400 truncate max-w-[180px]">{legalName}</p>
      </td>

      {/* Contact */}
      <td className="py-3 px-4">
        {contactEmail && (
          <p className="text-xs text-gray-600 truncate max-w-[160px]">{contactEmail}</p>
        )}
        {contactPhone && (
          <p className="text-xs text-gray-500">{contactPhone}</p>
        )}
        {!contactEmail && !contactPhone && (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      {/* Note */}
      <td className="py-3 px-4 text-sm">
        {ratingCount > 0 ? (
          <span className="font-medium text-brand-dark">
            {ratingAverage.toFixed(1)}{' '}
            <span className="text-xs font-normal text-gray-400">({ratingCount})</span>
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      {/* Statut */}
      <td className="py-3 px-4">
        <Badge variant={statusVariants[status]}>
          {statusLabels[status]}
        </Badge>
      </td>

      {/* Action */}
      <td className="py-3 px-4 text-right">
        <Link
          href={`/fr/admin/cooperatives/${coopId}`}
          className="text-sm text-brand hover:underline font-medium"
        >
          Voir
        </Link>
      </td>
    </tr>
  );
}

export default CoopRow;
