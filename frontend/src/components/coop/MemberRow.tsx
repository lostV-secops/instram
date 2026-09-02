/**
 * Ligne de tableau — membre de la coopérative.
 * Server Component.
 */

import type { Member, CooperativeRole } from '@/lib/types';

interface MemberRowProps {
  member: Member;
}

const roleLabels: Record<CooperativeRole, string> = {
  COOP_ADMIN: 'Administrateur',
  COOP_ASSISTANT: 'Assistant',
  COOP_DRIVER: 'Conducteur',
  COOP_CONTROLLER: 'Contrôleur',
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-MG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function MemberRow({ member }: MemberRowProps) {
  const { user, role, active, createdAt } = member;

  const displayName =
    user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`
      : user.email ?? user.phone ?? '—';

  const contact = user.phone ?? user.email ?? '—';

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="py-3 px-4 text-sm font-medium text-gray-900">
        {displayName}
      </td>
      <td className="py-3 px-4 text-sm text-gray-600">{contact}</td>
      <td className="py-3 px-4">
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-brand/10 text-brand">
          {roleLabels[role]}
        </span>
      </td>
      <td className="py-3 px-4">
        <span
          className={[
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
            active
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-500',
          ].join(' ')}
        >
          {active ? 'Actif' : 'Inactif'}
        </span>
      </td>
      <td className="py-3 px-4 text-xs text-gray-400 tabular-nums">
        {formatDate(createdAt)}
      </td>
    </tr>
  );
}

export default MemberRow;
