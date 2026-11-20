'use client';

/**
 * Validation d'une coopérative — /fr/admin/cooperatives/[coopId]/validate
 *
 * Accessible : ADMIN_SUPER et ADMIN_OPS uniquement.
 *
 * Endpoints (contrat-api.yaml) :
 *  - GET  /v1/admin/cooperatives/{id}          → charger les infos de la coop
 *  - POST /v1/admin/cooperatives/{id}/validate → valider la coopérative
 *  - PUT  /v1/admin/cooperatives/{id}/pricing-plan → définir le plan tarifaire (commission)
 *
 * Flux :
 *  1. Afficher nom + statut courant de la coop
 *  2. Champ commission % (défaut 8 %, VH-04)
 *  3. Notes internes (non persistées côté API, affichage local)
 *  4. Bouton "Valider la coopérative" → variant="action"
 *
 * Règle graphique :
 *  - "Valider la coopérative" : variant="action" (vert #9CC43D) — action transactionnelle
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

export default function ValidateCoopPage() {
  const params = useParams();
  const router = useRouter();
  const coopId = params.coopId as string;

  // Vérification du rôle — seuls ADMIN_SUPER et ADMIN_OPS peuvent valider
  const { role } = useAdmin();
  const canValidate = role === 'ADMIN_SUPER' || role === 'ADMIN_OPS';

  // Chargement de la coopérative
  const [coop, setCoop] = useState<Cooperative | null>(null);
  const [loadingCoop, setLoadingCoop] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Formulaire
  const [commissionRate, setCommissionRate] = useState('8');
  const [notes, setNotes] = useState('');
  const [commissionError, setCommissionError] = useState<string | undefined>(undefined);

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

    // Validation du taux
    const rate = parseFloat(commissionRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      setCommissionError('Taux invalide. Entrez une valeur entre 0 et 100.');
      return;
    }
    setCommissionError(undefined);

    setSubmitting(true);
    setSubmitError(null);

    try {
      // 1. Définir le plan tarifaire (commission) via PUT /pricing-plan
      const pricingRes = await fetch(
        `/api/proxy/v1/admin/cooperatives/${coopId}/pricing-plan`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'COMMISSION',
            commissionRate: rate,
            effectiveFrom: new Date().toISOString(),
          }),
        },
      );
      if (!pricingRes.ok) {
        throw new Error("Erreur lors de la définition du plan tarifaire.");
      }

      // 2. Valider la coopérative via POST /validate
      const validateRes = await fetch(
        `/api/proxy/v1/admin/cooperatives/${coopId}/validate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (!validateRes.ok) throw new Error("Erreur lors de la validation.");

      setSuccess(true);
      // Rediriger vers le détail après 1.5s
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
  if (!canValidate) {
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
        <div className="bg-green-50 border border-green-300 rounded-xl px-4 py-6 text-center space-y-2">
          <svg className="w-8 h-8 text-green-600 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="font-semibold text-green-800">Coopérative validée avec succès.</p>
          <p className="text-sm text-green-700">Redirection en cours…</p>
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
        <h1 className="text-xl font-bold text-brand-dark">Valider la coopérative</h1>
        <p className="text-sm text-gray-500 mt-0.5">{coop.displayName} — {coop.legalName}</p>
      </div>

      {/* Statut actuel */}
      <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
        <span className="text-sm text-gray-500">Statut actuel :</span>
        <Badge variant={statusVariants[coop.status]}>
          {statusLabels[coop.status]}
        </Badge>
      </div>

      {/* Avertissement si déjà validée */}
      {coop.status !== 'PENDING_VALIDATION' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-700">
          Cette coopérative n'est pas en attente de validation. La validation peut néanmoins être réappliquée.
        </div>
      )}

      {/* Avertissement audit */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 flex items-start gap-2">
        <svg className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p className="text-xs text-yellow-700">
          Action irréversible — un AuditLog est créé à chaque validation. La coopérative recevra
          une notification SMS de confirmation.
        </p>
      </div>

      {/* Formulaire */}
      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-brand-dark mb-1">
            Plan tarifaire
          </h2>
          <p className="text-xs text-gray-500">
            Valeur par défaut : 8 %. Ce taux s'applique sur les réservations en ligne.
          </p>
        </div>

        <Input
          label="Taux de commission (%)"
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={commissionRate}
          onChange={(e) => setCommissionRate(e.target.value)}
          placeholder="8"
          hint="Entre 0 et 100. Exemple : 8 pour 8 %."
          error={commissionError}
          required
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="notes" className="text-sm font-medium text-gray-800">
            Notes internes (optionnel)
          </label>
          <textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observations, conditions particulières…"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900
              focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand resize-none"
          />
          <p className="text-xs text-gray-400">Ces notes ne sont pas envoyées à la coopérative.</p>
        </div>

        {/* Erreur de soumission */}
        {submitError && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
            {submitError}
          </div>
        )}

        {/* Bouton principal — variant="action" (vert transactionnel) */}
        <Button
          variant="action"
          type="submit"
          fullWidth
          isLoading={submitting}
        >
          Valider la coopérative
        </Button>
      </form>
    </div>
  );
}
