'use client';

/**
 * Dashboard global — /fr/admin
 *
 * Appelle GET /v1/admin/dashboard (schema AdminDashboard).
 * Affiche :
 *  - 4 KPI plateforme (GlobalStatsCard)
 *  - 5 dernières coopératives en attente de validation
 *
 * États de chargement et d'erreur explicites (réseau instable = cas fréquent).
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { GlobalStatsCard } from '@/components/admin/GlobalStatsCard';
import { CoopRow } from '@/components/admin/CoopRow';
import type { AdminDashboard, Cooperative } from '@/lib/types';

function formatMGA(amount: number): string {
  return `${amount.toLocaleString('fr-MG')} Ar`;
}

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [pendingCoops, setPendingCoops] = useState<Cooperative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [dashRes, coopsRes] = await Promise.all([
        fetch('/api/proxy/v1/admin/dashboard', { cache: 'no-store' }),
        fetch('/api/proxy/v1/admin/cooperatives?status=PENDING_VALIDATION&limit=5', {
          cache: 'no-store',
        }),
      ]);

      if (!dashRes.ok || !coopsRes.ok) {
        throw new Error('Erreur lors du chargement des données.');
      }

      const [dashData, coopsData] = await Promise.all([
        dashRes.json() as Promise<AdminDashboard>,
        coopsRes.json() as Promise<{ items: Cooperative[]; nextCursor: string | null }>,
      ]);

      setDashboard(dashData);
      setPendingCoops(coopsData.items ?? []);
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion et actualisez la page.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-56" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-brand-dark">Tableau de bord</h1>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{error}</p>
            <button type="button" onClick={loadData} className="text-sm underline mt-1">
              Réessayer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Titre */}
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Tableau de bord plateforme</h1>
        <p className="text-sm text-gray-500">
          Vue globale InsTRAM —{' '}
          {new Date().toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>

      {/* KPIs */}
      {dashboard && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <GlobalStatsCard
            label="Coopératives actives"
            value={dashboard.cooperativesActive}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 21V9h6v12" />
                <path d="M3 9h18" />
              </svg>
            }
          />
          <GlobalStatsCard
            label="En attente de validation"
            value={dashboard.cooperativesPending}
            accent={dashboard.cooperativesPending > 0 ? 'warning' : 'default'}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            }
          />
          <GlobalStatsCard
            label="Réservations aujourd'hui"
            value={dashboard.bookingsToday}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                <rect x="8" y="2" width="8" height="4" rx="1" />
              </svg>
            }
          />
          <GlobalStatsCard
            label="Commission plateforme (jour)"
            value={formatMGA(dashboard.platformFeeToday)}
            sub={`Revenus totaux : ${formatMGA(dashboard.revenueToday)}`}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            }
          />
        </div>
      )}

      {/* Incidents */}
      {dashboard && dashboard.incidents.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-brand-dark mb-3">
            Incidents actifs ({dashboard.incidents.length})
          </h2>
          <div className="space-y-2">
            {dashboard.incidents.map((incident, idx) => (
              <div
                key={idx}
                className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-3"
              >
                <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div>
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                    {incident.type} — {incident.severity}
                  </p>
                  <p className="text-sm text-red-600">{incident.message}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Coopératives en attente de validation */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-brand-dark">
            Coopératives en attente de validation
          </h2>
          <Link
            href="/fr/admin/cooperatives?status=PENDING_VALIDATION"
            className="text-sm text-brand hover:underline"
          >
            Voir tout
          </Link>
        </div>

        {pendingCoops.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-sm text-gray-500">
            Aucune coopérative en attente de validation.
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
                  {pendingCoops.map((coop) => (
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
      </section>
    </div>
  );
}
