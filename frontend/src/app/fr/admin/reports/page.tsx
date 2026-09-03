'use client';

/**
 * Rapport financier global — /fr/admin/reports
 *
 * Affiche :
 *  - KPI globaux issus de GET /v1/admin/dashboard (AdminDashboard)
 *  - Formulaire d'export de rapport financier
 *  - Historique des exports
 *
 * Endpoints (contrat-api.yaml) :
 *  - GET  /v1/admin/dashboard     → recette totale, commissions, réservations
 *  - POST /v1/coop/exports        → déclencher un export FINANCIAL_REPORT
 *  - GET  /v1/coop/exports        → historique des exports
 *
 * NOTE : Un endpoint /admin/exports dédié n'existe pas dans le contrat actuel.
 * On utilise /coop/exports disponible pour tous les rôles admin.
 *
 * États de chargement et d'erreur explicites (réseau instable = cas fréquent).
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { GlobalStatsCard } from '@/components/admin/GlobalStatsCard';
import type { AdminDashboard, ExportJob, ExportJobStatus } from '@/lib/types';

const FORMAT_OPTIONS = ['XLSX', 'CSV', 'PDF'] as const;
type ExportFormat = (typeof FORMAT_OPTIONS)[number];

const statusVariants: Record<ExportJobStatus, 'warning' | 'info' | 'success' | 'error' | 'neutral'> = {
  QUEUED: 'warning',
  RUNNING: 'info',
  READY: 'success',
  FAILED: 'error',
  EXPIRED: 'neutral',
};

const statusLabels: Record<ExportJobStatus, string> = {
  QUEUED: 'En file',
  RUNNING: 'En cours',
  READY: 'Prêt',
  FAILED: 'Échoué',
  EXPIRED: 'Expiré',
};

function formatMGA(amount: number): string {
  return `${amount.toLocaleString('fr-MG')} Ar`;
}

const today = new Date().toISOString().slice(0, 10);
const monthStart = new Date(new Date().setDate(1)).toISOString().slice(0, 10);

export default function AdminReportsPage() {
  // Dashboard
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState<string | null>(null);

  // Exports
  const [exports, setExports] = useState<ExportJob[]>([]);
  const [exportsLoading, setExportsLoading] = useState(true);
  const [exportsError, setExportsError] = useState<string | null>(null);

  // Formulaire
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(today);
  const [format, setFormat] = useState<ExportFormat>('XLSX');
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    setDashError(null);
    try {
      const res = await fetch('/api/proxy/v1/admin/dashboard', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data: AdminDashboard = await res.json();
      setDashboard(data);
    } catch {
      setDashError('Impossible de charger les KPI. Vérifiez votre connexion.');
    } finally {
      setDashLoading(false);
    }
  }, []);

  const loadExports = useCallback(async () => {
    setExportsLoading(true);
    setExportsError(null);
    try {
      const res = await fetch('/api/proxy/v1/coop/exports', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data: ExportJob[] = await res.json();
      // Filtrer uniquement les rapports financiers
      setExports((data ?? []).filter((j) => j.type === 'FINANCIAL_REPORT'));
    } catch {
      setExportsError('Impossible de charger l\'historique des exports. Vérifiez votre connexion.');
    } finally {
      setExportsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    loadExports();
  }, [loadDashboard, loadExports]);

  const handleGenerateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitSuccess(null);
    setSubmitError(null);

    try {
      const res = await fetch('/api/proxy/v1/coop/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'FINANCIAL_REPORT',
          format,
          filters: {
            from: fromDate || undefined,
            to: toDate || undefined,
          },
        }),
      });

      if (!res.ok) throw new Error();
      const newJob: ExportJob = await res.json();
      setExports((prev) => [newJob, ...prev]);
      setSubmitSuccess('Export lancé. Actualisez l\'historique dans quelques instants pour vérifier le statut.');
    } catch {
      setSubmitError('Erreur lors de la demande d\'export. Vérifiez votre connexion.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Titre */}
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Rapport financier global</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Recettes, commissions et exports — vue consolidée InsTRAM
        </p>
      </div>

      {/* KPI globaux */}
      <section>
        <h2 className="text-base font-semibold text-brand-dark mb-3">KPI du jour</h2>

        {dashLoading && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-xl" />
            ))}
          </div>
        )}

        {!dashLoading && dashError && (
          <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <p className="font-medium">{dashError}</p>
              <button type="button" onClick={loadDashboard} className="text-sm underline mt-1">Réessayer</button>
            </div>
          </div>
        )}

        {!dashLoading && dashboard && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <GlobalStatsCard
              label="Recettes totales (jour)"
              value={formatMGA(dashboard.revenueToday)}
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              }
              accent="success"
            />
            <GlobalStatsCard
              label="Commissions InsTRAM (jour)"
              value={formatMGA(dashboard.platformFeeToday)}
              sub={dashboard.revenueToday > 0
                ? `${((dashboard.platformFeeToday / dashboard.revenueToday) * 100).toFixed(1)} % des recettes`
                : undefined}
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              }
            />
            <GlobalStatsCard
              label="Réservations (jour)"
              value={dashboard.bookingsToday}
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" />
                </svg>
              }
            />
          </div>
        )}
      </section>

      {/* Formulaire — export rapport financier */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-brand-dark">Exporter un rapport financier</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Le fichier est disponible dès que le statut passe à « Prêt ».
            Consultez l'historique ci-dessous.
          </p>
        </div>

        <form onSubmit={handleGenerateReport} className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <label htmlFor="from-date" className="text-sm font-medium text-gray-800">
                Du
              </label>
              <input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900
                  focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <label htmlFor="to-date" className="text-sm font-medium text-gray-800">
                Au
              </label>
              <input
                id="to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900
                  focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="export-format" className="text-sm font-medium text-gray-800">
                Format
              </label>
              <select
                id="export-format"
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
                className="block rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900
                  focus:outline-none focus:ring-2 focus:ring-brand bg-white"
              >
                {FORMAT_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          </div>

          {submitSuccess && (
            <p role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              {submitSuccess}
            </p>
          )}
          {submitError && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {submitError}
            </p>
          )}

          {/* Exporter XLSX — variant="action" car c'est une action de confirmation */}
          <Button
            variant="action"
            type="submit"
            isLoading={submitting}
          >
            Exporter {format}
          </Button>
        </form>
      </section>

      {/* Historique des exports */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-brand-dark">Historique des rapports financiers</h2>
          <button
            type="button"
            onClick={loadExports}
            className="text-sm text-brand hover:underline"
          >
            Actualiser
          </button>
        </div>

        {exportsLoading && (
          <div className="space-y-2 animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded-lg" />
            ))}
          </div>
        )}

        {!exportsLoading && exportsError && (
          <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <p className="font-medium">{exportsError}</p>
              <button type="button" onClick={loadExports} className="text-sm underline mt-1">Réessayer</button>
            </div>
          </div>
        )}

        {!exportsLoading && !exportsError && (
          <>
            {exports.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-sm text-gray-500">
                Aucun rapport financier généré pour le moment.
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Format</th>
                        <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                        <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Demandé le</th>
                        <th className="py-2 px-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {exports.map((job) => (
                        <tr key={job.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-4 text-sm text-gray-700">{job.format}</td>
                          <td className="py-3 px-4">
                            <Badge variant={statusVariants[job.status]}>
                              {statusLabels[job.status]}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-xs text-gray-500">
                            {new Date(job.createdAt).toLocaleDateString('fr-FR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {job.status === 'READY' && job.resultUrl ? (
                              <a
                                href={job.resultUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-brand hover:underline font-medium"
                              >
                                Télécharger
                              </a>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
