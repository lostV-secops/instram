/**
 * Ligne dans le journal d'audit — console admin InsTRAM.
 *
 * Affiche : acteur, action, entité, adresse IP, date.
 * Source : GET /v1/admin/audit-logs (contrat-api.yaml, schema AuditLogEntry).
 */

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditLogRowProps {
  entry: AuditLogEntry;
}

export function AuditLogRow({ entry }: AuditLogRowProps) {
  const formattedDate = new Date(entry.createdAt).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      {/* Acteur */}
      <td className="py-2.5 px-4 text-xs text-gray-500 font-mono">
        {entry.actorUserId ? (
          <span title={entry.actorUserId}>{entry.actorUserId.slice(0, 8)}…</span>
        ) : (
          <span className="text-gray-400">système</span>
        )}
      </td>

      {/* Action */}
      <td className="py-2.5 px-4">
        <span className="text-xs font-medium text-brand-dark bg-brand/10 px-2 py-0.5 rounded">
          {entry.action}
        </span>
      </td>

      {/* Entité */}
      <td className="py-2.5 px-4 text-xs text-gray-600">
        <span className="font-medium">{entry.entityType}</span>
        {entry.entityId && (
          <span className="text-gray-400 ml-1" title={entry.entityId}>
            #{entry.entityId.slice(0, 6)}
          </span>
        )}
      </td>

      {/* IP */}
      <td className="py-2.5 px-4 text-xs text-gray-400 font-mono">
        {entry.ipAddress ?? '—'}
      </td>

      {/* Date */}
      <td className="py-2.5 px-4 text-xs text-gray-500 whitespace-nowrap">
        {formattedDate}
      </td>
    </tr>
  );
}

export default AuditLogRow;
