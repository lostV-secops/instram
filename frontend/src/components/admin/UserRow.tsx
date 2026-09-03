/**
 * Ligne de tableau pour un utilisateur — console admin InsTRAM.
 * Affiche : contact (email/phone), rôles, statut, date d'inscription, action Suspendre.
 */

import { Badge } from '@/components/ui/Badge';
import type { AdminUserSummary, AdminUserStatus } from '@/lib/types';

const statusLabels: Record<AdminUserStatus, string> = {
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
  DELETED: 'Supprimé',
};

const statusVariants: Record<AdminUserStatus, 'success' | 'error' | 'neutral'> = {
  ACTIVE: 'success',
  SUSPENDED: 'error',
  DELETED: 'neutral',
};

interface UserRowProps {
  user: AdminUserSummary;
  onSuspend?: (userId: string) => void;
}

export function UserRow({ user, onSuspend }: UserRowProps) {
  const formattedDate = new Date(user.createdAt).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      {/* Contact */}
      <td className="py-3 px-4">
        {user.email && (
          <p className="text-sm text-gray-800 truncate max-w-[180px]">{user.email}</p>
        )}
        {user.phone && (
          <p className="text-xs text-gray-500">{user.phone}</p>
        )}
        {!user.email && !user.phone && (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      {/* Rôles */}
      <td className="py-3 px-4">
        <div className="flex flex-wrap gap-1">
          {user.roles.slice(0, 2).map((role) => (
            <Badge key={role} variant="info" className="text-xs">
              {role}
            </Badge>
          ))}
          {user.roles.length > 2 && (
            <Badge variant="neutral" className="text-xs">
              +{user.roles.length - 2}
            </Badge>
          )}
          {user.roles.length === 0 && (
            <span className="text-xs text-gray-400">—</span>
          )}
        </div>
      </td>

      {/* Statut */}
      <td className="py-3 px-4">
        <Badge variant={statusVariants[user.status]}>
          {statusLabels[user.status]}
        </Badge>
      </td>

      {/* Inscrit le */}
      <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">
        {formattedDate}
      </td>

      {/* Actions */}
      <td className="py-3 px-4 text-right">
        {user.status === 'ACTIVE' && onSuspend && (
          <button
            type="button"
            onClick={() => onSuspend(user.id)}
            className="text-xs text-red-600 hover:underline font-medium focus:outline-none focus:ring-2 focus:ring-red-400 rounded"
          >
            Suspendre
          </button>
        )}
      </td>
    </tr>
  );
}

export default UserRow;
