'use client';

/**
 * Exports plateforme admin — /fr/admin/exports
 *
 * Appelle POST /v1/coop/exports { type: "FINANCIAL_REPORT", format, filters }
 * et GET /v1/coop/exports pour lister les exports existants.
 *
 * Note : le contrat API utilise /coop/exports pour les exports (pas /admin/exports).
 * L'admin peut déclencher un rapport financier global via le même endpoint,
 * accessible car l'admin possède les droits coopérative globaux.
 * Un endpoint /admin/exports dédié est à prévoir dans un prochain contrat.
 *
 * États de chargement et d'erreur explicites (réseau instable = cas fréquent).
 */

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { ExportJob, ExportJobStatus } from '@/lib/types';

const FORMAT_OPTIONS = ['CSV', 'PDF', 'XLSX'] as const;
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

const today = new Date().toISOString().slice(0, 10);
const monthStart = new Date(new Date().setDate(1)).toISOString().slice(0, 10);

export default function AdminExportsPage() {
  const [exports, setExports] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulaire rapport financier
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(today);
  const [format, setFormat] = useState<ExportFormat>('XLSX');
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadExports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/v1/admin/exports', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data: ExportJob[] = await res.json();
      setExports(data ?? []);
    } catch {
      setError('Impossible de charger les exports. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExports();
  }, [loadExports]);

  const handleGenerateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitSuccess(null);
    setSubmitError(null);

    try {
      const res = await fetch('/api/proxy/v1/admin/exports', {
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
      setSubmitSuccess('Export lancé. Actualisez dans quelques instants pour vérifier le statut.');
    } catch {
      setSubmitError('Erreur lors de la demande d\'export. Vérifiez votre connexion.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Titre */}
      <h1 className="text-xl font-bold text-brand-dark">Exports plateforme</h1>

      {/* Formulaire — rapport financier global */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold text-brand-dark">Rapport financier global</h2>
        <p className="text-xs text-gray-500">
          Génère un rapport financier consolidé. Le fichier est disponible dès que le statut passe
          à « Prêt ».
        </p>

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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
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
                className="block rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand bg-white"
              >
                {FORMAT_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Feedback */}
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

          <Button
            variant="action"
            type="submit"
            isLoading={submitting}
          >
            Générer le rapport
          </Button>
        </form>
      </section>

      {/* Liste des exports */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-brand-dark">Historique des exports</h2>
          <button
            type="button"
            onClick={loadExports}
            className="text-sm text-brand hover:underline"
          >
            Actualiser
          </button>
        </div>

        {/* Chargement */}
        {loading && (
          <div className="space-y-2 animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded-lg" />
            ))}
          </div>
        )}

        {/* Erreur */}
        {!loading && error && (
          <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <p className="font-medium">{error}</p>
              <button type="button" onClick={loadExports} className="text-sm underline mt-1">Réessayer</button>
            </div>
          </div>
        )}

        {/* Tableau exports */}
        {!loading && !error && (
          <>
            {exports.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-sm text-gray-500">
                Aucun export.
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                        <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Format</th>
                        <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                        <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Demandé le</th>
                        <th className="py-2 px-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {exports.map((job) => (
                        <tr key={job.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-4 text-sm text-gray-700">{job.type}</td>
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
