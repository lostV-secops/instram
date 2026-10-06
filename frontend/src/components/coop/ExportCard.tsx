'use client';

/**
 * Carte de suivi d'un export (ExportJob).
 *
 * - Affiche le statut, le type, le format et la date de création.
 * - Poll GET /coop/exports/{id} toutes les 3s tant que QUEUED ou RUNNING.
 * - Quand READY : affiche un lien de téléchargement.
 * - Badge animé pour RUNNING.
 *
 * NOTE : le poll n'est pas du polling REST "pur" — c'est un poll de statut
 * sur une ressource de job asynchrone. Acceptable per règles projet car
 * WebSocket ne couvre pas les jobs d'export longue durée.
 */

import { useEffect, useState, useCallback } from 'react';
import type { ExportJob, ExportJobStatus, ExportType } from '@/lib/types';

const TYPE_LABELS: Record<ExportType, string> = {
  MANIFEST: 'Manifeste passagers',
  FINANCIAL_REPORT: 'Rapport financier',
  BOOKINGS: 'Réservations',
  RATINGS: 'Avis',
};

const STATUS_LABELS: Record<ExportJobStatus, string> = {
  QUEUED: 'En file',
  RUNNING: 'En cours',
  READY: 'Prêt',
  FAILED: 'Échoué',
  EXPIRED: 'Expiré',
};

function StatusBadge({ status }: { status: ExportJobStatus }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium';
  const variants: Record<ExportJobStatus, string> = {
    QUEUED: 'bg-gray-100 text-gray-600',
    RUNNING: 'bg-brand/10 text-brand',
    READY: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700',
    EXPIRED: 'bg-gray-100 text-gray-400',
  };

  return (
    <span className={`${base} ${variants[status]}`}>
      {status === 'RUNNING' && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse flex-shrink-0"
          aria-hidden="true"
        />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-MG', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface ExportCardProps {
  initialJob: ExportJob;
}

const POLL_INTERVAL_MS = 3000;

export function ExportCard({ initialJob }: ExportCardProps) {
  const [job, setJob] = useState<ExportJob>(initialJob);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/v1/coop/exports/${job.id}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const updated = (await res.json()) as ExportJob;
        setJob(updated);
      }
    } catch {
      // Erreur réseau — on réessaie au prochain interval
    }
  }, [job.id]);

  useEffect(() => {
    if (job.status !== 'QUEUED' && job.status !== 'RUNNING') return;

    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [job.status, poll]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900">
            {TYPE_LABELS[job.type]}
          </span>
          <span className="text-xs text-gray-400 uppercase">{job.format}</span>
        </div>
        <p className="text-xs text-gray-400">
          Demandé le {formatDate(job.createdAt)}
        </p>
        {job.completedAt && (
          <p className="text-xs text-gray-400">
            Terminé le {formatDate(job.completedAt)}
          </p>
        )}
        <StatusBadge status={job.status} />
      </div>

      {job.status === 'READY' && (job.downloadUrl ?? job.resultUrl) && (
        <a
          href={(job.downloadUrl ?? job.resultUrl)!}
          download
          className="flex-shrink-0 inline-flex items-center gap-1.5 bg-brand text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-brand-dark transition-colors focus:outline-none focus:ring-2 focus:ring-brand"
          aria-label={`Télécharger ${TYPE_LABELS[job.type]}`}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Télécharger
        </a>
      )}

      {job.status === 'FAILED' && (
        <span className="flex-shrink-0 text-xs text-red-500 font-medium">
          Échec
        </span>
      )}
    </div>
  );
}

export default ExportCard;
