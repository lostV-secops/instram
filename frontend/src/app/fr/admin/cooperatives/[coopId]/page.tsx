'use client';

/**
 * Détail d'une coopérative — /fr/admin/cooperatives/[coopId]
 *
 * Endpoints utilisés (contrat-api.yaml) :
 *  - GET    /v1/admin/cooperatives/{id}        → détail
 *  - POST   /v1/admin/cooperatives/{id}/validate  → valider (PENDING_VALIDATION → VALIDATED)
 *  - POST   /v1/admin/cooperatives/{id}/suspend   → suspendre { reason: string }
 *  - POST   /v1/admin/cooperatives/{id}/reactivate → réactiver (SUSPENDED → VALIDATED)
 *    NOTE : l'endpoint /reactivate est absent du contrat API actuel (contrat-api.yaml).
 *           À implémenter côté backend. L'UI est prête.
 *
 * Règle graphique :
 *  - "Valider" : variant="action" (vert #9CC43D) — action transactionnelle de confirmation
 *  - "Suspendre" : variant="danger"
 *  - "Réactiver" : variant="primary"
 *
 * Avertissement affiché avant chaque action : "Action irréversible — un AuditLog est créé."
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { useAdmin } from '@/app/fr/admin/layout';
import type { Cooperative, CooperativeStatus } from '@/lib/types';

const statusLabels: Record<CooperativeStatus, string> = {
  PENDING_VALIDATION: 'En attente de validation',
  VALIDATED: 'Active',
  SUSPENDED: 'Suspendue',
  REJECTED: 'Rejetée',
};

const statusBadgeVariants: Record<CooperativeStatus, 'warning' | 'success' | 'error' | 'neutral'> =
  {
    PENDING_VALIDATION: 'warning',
    VALIDATED: 'success',
    SUSPENDED: 'error',
    REJECTED: 'neutral',
  };

type ActionModal = 'suspend' | null;

export default function AdminCoopDetailPage() {
  const params = useParams();
  const router = useRouter();
  const coopId = params.coopId as string;

  // Rôle pour conditionner les liens d'action
  const { role } = useAdmin();
  const canAct = role === 'ADMIN_SUPER' || role === 'ADMIN_OPS';

  const [coop, setCoop] = useState<Cooperative | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendReasonError, setSuspendReasonError] = useState<string | undefined>(undefined);

  const loadCoop = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/proxy/v1/admin/cooperatives/${coopId}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error();
      const data: Cooperative = await res.json();
      setCoop(data);
    } catch {
      setError('Impossible de charger la coopérative. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, [coopId]);

  useEffect(() => {
    loadCoop();
  }, [loadCoop]);

  const handleValidate = async () => {
    setActionLoading('validate');
    setActionError(null);
    try {
      const res = await fetch(
        `/api/proxy/v1/admin/cooperatives/${coopId}/validate`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      if (!res.ok) throw new Error();
      const updated: Cooperative = await res.json();
      setCoop(updated);
    } catch {
      setActionError('Erreur lors de la validation. Vérifiez votre connexion.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSuspend = async () => {
    if (!suspendReason.trim()) {
      setSuspendReasonError('Le motif est requis.');
      return;
    }
    setSuspendReasonError(undefined);
    setActionLoading('suspend');
    setActionError(null);
    try {
      const res = await fetch(
        `/api/proxy/v1/admin/cooperatives/${coopId}/suspend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: suspendReason }),
        },
      );
      if (!res.ok) throw new Error();
      const updated: Cooperative = await res.json();
      setCoop(updated);
      setActionModal(null);
      setSuspendReason('');
    } catch {
      setActionError('Erreur lors de la suspension. Vérifiez votre connexion.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReactivate = async () => {
    // NOTE : endpoint /reactivate absent du contrat-api.yaml — à implémenter côté backend.
    setActionLoading('reactivate');
    setActionError(null);
    try {
      const res = await fetch(
        `/api/proxy/v1/admin/cooperatives/${coopId}/reactivate`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      if (!res.ok) throw new Error();
      const updated: Cooperative = await res.json();
      setCoop(updated);
    } catch {
      setActionError('Erreur lors de la réactivation. Vérifiez votre connexion.');
    } finally {
      setActionLoading(null);
    }
  };

  // ─── Chargement ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-32" />
        <div className="h-48 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/fr/admin/cooperatives" className="text-sm text-brand hover:underline">
          ← Retour à la liste
        </Link>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{error}</p>
            <button type="button" onClick={loadCoop} className="text-sm underline mt-1">
              Réessayer
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!coop) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Fil d'Ariane */}
      <Link href="/fr/admin/cooperatives" className="text-sm text-brand hover:underline">
        ← Retour à la liste
      </Link>

      {/* Titre */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-brand-dark">{coop.displayName}</h1>
          <p className="text-sm text-gray-500">{coop.legalName}</p>
        </div>
        <Badge variant={statusBadgeVariants[coop.status]}>
          {statusLabels[coop.status]}
        </Badge>
      </div>

      {/* Fiche détail */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <dl className="divide-y divide-gray-100">
          {[
            { label: 'Raison sociale', value: coop.legalName },
            { label: "Nom d'affichage", value: coop.displayName },
            { label: 'Statut', value: statusLabels[coop.status] },
            { label: 'Email', value: coop.contactEmail ?? '—' },
            { label: 'Téléphone', value: coop.contactPhone ?? '—' },
            {
              label: 'Note moyenne',
              value:
                coop.ratingCount > 0
                  ? `${coop.ratingAverage.toFixed(1)} / 5 (${coop.ratingCount} avis)`
                  : 'Aucun avis',
            },
          ].map(({ label, value }) => (
            <div key={label} className="px-4 py-3 flex gap-4">
              <dt className="text-sm text-gray-500 w-36 flex-shrink-0">{label}</dt>
              <dd className="text-sm font-medium text-brand-dark">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Erreur d'action */}
      {actionError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm"
        >
          {actionError}
        </div>
      )}

      {/* Avertissement avant action */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 flex items-start gap-2">
        <svg className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p className="text-xs text-yellow-700">
          Action irréversible — un AuditLog est créé à chaque validation, suspension ou réactivation.
        </p>
      </div>

      {/* Boutons d'action contextuels */}
      <div className="flex gap-3 flex-wrap">
        {coop.status === 'PENDING_VALIDATION' && canAct && (
          <>
            {/* Lien vers la page de validation avec formulaire commission */}
            <Link href={`/fr/admin/cooperatives/${coopId}/validate`}>
              <Button variant="action">
                Valider la coopérative
              </Button>
            </Link>
            {/* Action rapide en ligne */}
            <Button
              variant="ghost"
              size="sm"
              isLoading={actionLoading === 'validate'}
              disabled={actionLoading !== null}
              onClick={handleValidate}
            >
              Validation rapide (sans commission)
            </Button>
          </>
        )}

        {coop.status === 'VALIDATED' && canAct && (
          <>
            {/* Lien vers la page de suspension avec formulaire motif */}
            <Link href={`/fr/admin/cooperatives/${coopId}/suspend`}>
              <Button variant="danger">
                Suspendre
              </Button>
            </Link>
          </>
        )}

        {coop.status === 'SUSPENDED' && canAct && (
          <Button
            variant="primary"
            isLoading={actionLoading === 'reactivate'}
            disabled={actionLoading !== null}
            onClick={handleReactivate}
          >
            Réactiver
          </Button>
        )}
      </div>

      {/* Modal de confirmation de suspension */}
      {actionModal === 'suspend' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-brand-dark">
              Confirmer la suspension
            </h2>
            <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
              Action irréversible — un AuditLog est créé.
            </p>
            <Input
              label="Motif de suspension"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Ex. : Non-paiement d'abonnement, fraude..."
              error={suspendReasonError}
              required
            />

            {actionError && (
              <p role="alert" className="text-xs text-red-600">
                {actionError}
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                variant="danger"
                fullWidth
                isLoading={actionLoading === 'suspend'}
                disabled={actionLoading !== null}
                onClick={handleSuspend}
              >
                Confirmer la suspension
              </Button>
              <Button
                variant="ghost"
                fullWidth
                disabled={actionLoading !== null}
                onClick={() => {
                  setActionModal(null);
                  setSuspendReason('');
                  setSuspendReasonError(undefined);
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
