'use client';

/**
 * Suspension d'une coopérative — /fr/admin/cooperatives/[coopId]/suspend
 *
 * Accessible : ADMIN_SUPER et ADMIN_OPS uniquement.
 *
 * Endpoint (contrat-api.yaml) :
 *  - GET  /v1/admin/cooperatives/{id}         → charger les infos
 *  - POST /v1/admin/cooperatives/{id}/suspend  → suspendre { reason: string }
 *
 * Règle graphique :
 *  - Bouton "Suspendre" : variant="danger" (rouge) — action destructive
 *
 * Le motif de suspension est obligatoire.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useAdmin } from '@/app/fr/admin/context';
import type { Cooperative, CooperativeStatus } from '@/lib/types';

const statusLabels: Record<CooperativeStatus, string> = {
  PENDING_VALIDATION: 'En attente de validation',
  VALIDATED: 'Active',
  SUSPENDED: 'Suspendue',
  REJECTED: 'Rejetée',
};

const statusVariants: Record<CooperativeStatus, 'warning' | 'success' | 'error' | 'neutral'> = {
  PENDING_VALIDATION: 'warning',
  VALIDATED: 'success',
  SUSPENDED: 'error',
  REJECTED: 'neutral',
};

export default function SuspendCoopPage() {
  const params = useParams();
  const router = useRouter();
  const coopId = params.coopId as string;

  // Vérification du rôle
  const { role } = useAdmin();
  const canSuspend = role === 'ADMIN_SUPER' || role === 'ADMIN_OPS';

  // Chargement de la coopérative
  const [coop, setCoop] = useState<Cooperative | null>(null);
  const [loadingCoop, setLoadingCoop] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Formulaire
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  // Soumission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const loadCoop = useCallback(async () => {
    setLoadingCoop(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/proxy/v1/admin/cooperatives/${coopId}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error();
      const data: Cooperative = await res.json();
      setCoop(data);
    } catch {
      setLoadError('Impossible de charger la coopérative. Vérifiez votre connexion.');
    } finally {
      setLoadingCoop(false);
    }
  }, [coopId]);

  useEffect(() => {
    loadCoop();
  }, [loadCoop]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!reason.trim()) {
      setReasonError('Le motif de suspension est obligatoire.');
      return;
    }
    setReasonError(undefined);

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(
        `/api/proxy/v1/admin/cooperatives/${coopId}/suspend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!res.ok) throw new Error('Erreur lors de la suspension.');
      setSuccess(true);
      setTimeout(() => {
        router.push(`/fr/admin/cooperatives/${coopId}`);
      }, 1500);
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Erreur réseau. Vérifiez votre connexion et réessayez.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Accès interdit ────────────────────────────────────────────────────────
  if (!canSuspend) {
    return (
      <div className="space-y-4">
        <Link href={`/fr/admin/cooperatives/${coopId}`} className="text-sm text-brand hover:underline">
          ← Retour au détail
        </Link>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-6 text-center">
          <p className="font-medium">Accès restreint</p>
          <p className="text-sm mt-1">
            Cette action est réservée aux rôles ADMIN_SUPER et ADMIN_OPS.
          </p>
        </div>
      </div>
    );
  }

  // ─── Chargement ────────────────────────────────────────────────────────────
  if (loadingCoop) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-32" />
        <div className="h-40 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link href={`/fr/admin/cooperatives/${coopId}`} className="text-sm text-brand hover:underline">
          ← Retour au détail
        </Link>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{loadError}</p>
            <button type="button" onClick={loadCoop} className="text-sm underline mt-1">
              Réessayer
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!coop) return null;

  // ─── Succès ────────────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="space-y-4 max-w-lg">
        <div className="bg-orange-50 border border-orange-300 rounded-xl px-4 py-6 text-center space-y-2">
          <svg className="w-8 h-8 text-orange-600 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="font-semibold text-orange-800">Coopérative suspendue.</p>
          <p className="text-sm text-orange-700">Redirection en cours…</p>
        </div>
      </div>
    );
  }

  // ─── Page principale ────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-lg">
      {/* Fil d'Ariane */}
      <Link href={`/fr/admin/cooperatives/${coopId}`} className="text-sm text-brand hover:underline">
        ← Retour au détail
      </Link>

      {/* Titre */}
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Suspendre la coopérative</h1>
        <p className="text-sm text-gray-500 mt-0.5">{coop.displayName} — {coop.legalName}</p>
      </div>

      {/* Statut actuel */}
      <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
        <span className="text-sm text-gray-500">Statut actuel :</span>
        <Badge variant={statusVariants[coop.status]}>
          {statusLabels[coop.status]}
        </Badge>
      </div>

      {/* Avertissement audit */}
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-2">
        <svg className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p className="text-xs text-red-700">
          Action irréversible — un AuditLog est créé. La suspension bloque l'accès de la coopérative
          à la plateforme et suspend les nouvelles réservations. La réactivation est possible
          depuis la fiche détail.
        </p>
      </div>

      {/* Formulaire */}
      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
        <Input
          label="Motif de suspension"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex. : Non-paiement d'abonnement, signalement de fraude, non-conformité..."
          error={reasonError}
          hint="Ce motif est enregistré dans le journal d'audit. Il n'est pas communiqué à la coopérative."
          required
        />

        {/* Erreur de soumission */}
        {submitError && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
            {submitError}
          </div>
        )}

        <div className="flex gap-3">
          {/* Bouton principal — variant="danger" */}
          <Button
            variant="danger"
            type="submit"
            isLoading={submitting}
          >
            Confirmer la suspension
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={submitting}
            onClick={() => router.push(`/fr/admin/cooperatives/${coopId}`)}
          >
            Annuler
          </Button>
        </div>
      </form>
    </div>
  );
}
