'use client';

/**
 * Journal d'audit — /fr/admin/audit-logs
 *
 * Appelle GET /v1/admin/audit-logs (contrat-api.yaml, tag Admin) :
 *   filtres : action, entityType, actorUserId, from, to, cursor, limit
 *
 * Affiche un tableau chronologique des actions d'audit InsTRAM
 * (validation coop, suspension, changement plan, modération avis…)
 */

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
  actor?: { firstName: string; lastName: string; email: string } | null;
}

interface AuditListResponse {
  items: AuditEntry[];
  nextCursor: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  COOP_VALIDATED: 'Coop. validée',
  COOP_SUSPENDED: 'Coop. suspendue',
  PLAN_CHANGED: 'Plan modifié',
  RATING_MODERATED: 'Avis modéré',
  USER_SUSPENDED: 'Utilisateur suspendu',
  ADMIN_ACCESS: 'Accès admin',
  SUBSCRIPTION_PAID: 'Abonnement payé',
};

const ACTION_VARIANTS: Record<string, 'success' | 'error' | 'warning' | 'info' | 'neutral'> = {
  COOP_VALIDATED: 'success',
  COOP_SUSPENDED: 'error',
  PLAN_CHANGED: 'info',
  RATING_MODERATED: 'warning',
  USER_SUSPENDED: 'error',
  ADMIN_ACCESS: 'neutral',
  SUBSCRIPTION_PAID: 'success',
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-MG', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

const today = new Date().toISOString().slice(0, 10);
const monthStart = new Date(new Date().setDate(1)).toISOString().slice(0, 10);

export default function AdminAuditLogsPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [actionFilter, setActionFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(today);

  const buildUrl = useCallback((cursor?: string) => {
    const params = new URLSearchParams();
    if (actionFilter) params.set('action', actionFilter);
    if (entityTypeFilter) params.set('entityType', entityTypeFilter);
    if (fromDate) params.set('from', `${fromDate}T00:00:00.000Z`);
    if (toDate) params.set('to', `${toDate}T23:59:59.999Z`);
    if (cursor) params.set('cursor', cursor);
    params.set('limit', '50');
    return `/api/proxy/v1/admin/audit-logs?${params.toString()}`;
  }, [actionFilter, entityTypeFilter, fromDate, toDate]);

  const load = useCallback(async (append = false, cursor?: string) => {
    if (!append) setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(cursor));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AuditListResponse = await res.json();
      setEntries((prev) => append ? [...prev, ...data.items] : data.items);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setError("Erreur lors du chargement du journal d'audit.");
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-brand-dark">Journal d&apos;audit</h1>
        <Button variant="secondary" size="sm" onClick={() => load()}>
          Actualiser
        </Button>
      </div>

      {/* Filtres */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">Toutes les actions</option>
              {Object.entries(ACTION_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Type d&apos;entité</label>
            <select
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">Tous les types</option>
              <option value="Cooperative">Coopérative</option>
              <option value="User">Utilisateur</option>
              <option value="Rating">Avis</option>
              <option value="CooperativeSubscription">Abonnement</option>
              <option value="CooperativePricingPlan">Plan tarifaire</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Depuis</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Jusqu&apos;au</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
        </div>
      </div>

      {/* Erreur */}
      {error && (
        <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Tableau */}
      {loading && entries.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center animate-pulse">
          <p className="text-sm text-gray-400">Chargement du journal…</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">Aucune entrée pour les filtres sélectionnés.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Action</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Entité</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Acteur</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap font-mono text-xs">
                      {formatDate(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={ACTION_VARIANTS[entry.action] ?? 'neutral'}>
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <span className="font-medium">{entry.entityType}</span>
                      {entry.entityId && (
                        <p className="text-xs text-gray-400 font-mono truncate max-w-[140px]">
                          {entry.entityId}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {entry.actor ? (
                        <div>
                          <p className="font-medium text-xs">
                            {entry.actor.firstName} {entry.actor.lastName}
                          </p>
                          <p className="text-gray-400 text-xs">{entry.actor.email}</p>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs italic">Système</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                      {entry.ipAddress ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {nextCursor && (
            <div className="px-4 py-3 border-t border-gray-100 text-center">
              <Button
                variant="secondary"
                size="sm"
                isLoading={loading}
                onClick={() => load(true, nextCursor)}
              >
                Charger plus
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
