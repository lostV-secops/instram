'use client';

/**
 * Liste paginée de toutes les coopératives — /fr/admin/cooperatives
 *
 * Appelle GET /v1/admin/cooperatives?status=...&cursor=...
 * Filtre par statut : PENDING_VALIDATION | VALIDATED | SUSPENDED | REJECTED
 * (La valeur VALIDATED correspond à "Active" dans l'interface.)
 *
 * États de chargement et d'erreur explicites.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { CoopRow } from '@/components/admin/CoopRow';
import { Button } from '@/components/ui/Button';
import type { Cooperative, CooperativeStatus } from '@/lib/types';

const STATUS_OPTIONS: { value: CooperativeStatus | ''; label: string }[] = [
  { value: '', label: 'Tous les statuts' },
  { value: 'PENDING_VALIDATION', label: 'En attente' },
  { value: 'VALIDATED', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspendue' },
  { value: 'REJECTED', label: 'Rejetée' },
];

export default function AdminCooperativesPage() {
  const searchParams = useSearchParams();
  const initialStatus = (searchParams.get('status') as CooperativeStatus | null) ?? '';

  const [status, setStatus] = useState<CooperativeStatus | ''>(initialStatus);
  const [coops, setCoops] = useState<Cooperative[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildUrl = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: '20' });
      if (status) params.set('status', status);
      if (cursor) params.set('cursor', cursor);
      return `/api/proxy/v1/admin/cooperatives?${params.toString()}`;
    },
    [status],
  );

  const loadCoops = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Erreur lors du chargement.');
      const data: { items: Cooperative[]; nextCursor: string | null } =
        await res.json();
      setCoops(data.items ?? []);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setError('Impossible de charger les coopératives. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(nextCursor), { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data: { items: Cooperative[]; nextCursor: string | null } =
        await res.json();
      setCoops((prev) => [...prev, ...(data.items ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      // Erreur silencieuse sur "load more"
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadCoops();
  }, [loadCoops]);

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-brand-dark">Coopératives</h1>

        {/* Filtre statut */}
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm text-gray-600 whitespace-nowrap">
            Statut :
          </label>
          <select
            id="status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as CooperativeStatus | '')}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand bg-white"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* État de chargement */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-gray-200 rounded-lg" />
          ))}
        </div>
      )}

      {/* État d'erreur */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{error}</p>
            <button type="button" onClick={loadCoops} className="text-sm underline mt-1">
              Réessayer
            </button>
          </div>
        </div>
      )}

      {/* Tableau */}
      {!loading && !error && (
        <>
          {coops.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-sm text-gray-500">
              Aucune coopérative pour ce filtre.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Nom
                      </th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Contact
                      </th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Note
                      </th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Statut
                      </th>
                      <th className="py-2 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {coops.map((coop) => (
                      <CoopRow
                        key={coop.id}
                        coopId={coop.id}
                        legalName={coop.legalName}
                        displayName={coop.displayName}
                        contactEmail={coop.contactEmail}
                        contactPhone={coop.contactPhone}
                        status={coop.status}
                        ratingAverage={coop.ratingAverage}
                        ratingCount={coop.ratingCount}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Charger plus */}
          {nextCursor && (
            <div className="text-center pt-2">
              <Button
                variant="ghost"
                size="sm"
                isLoading={loadingMore}
                onClick={loadMore}
              >
                Charger plus
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
