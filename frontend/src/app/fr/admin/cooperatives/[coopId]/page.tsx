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
import { useAdmin } from '@/app/fr/admin/context';
import type { Cooperative, CooperativeStatus, CoopPricingPlan, CoopSubscription, PricingPlanType } from '@/lib/types';

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

type ActionModal = 'suspend' | 'new-plan' | 'new-sub' | null;

const PLAN_TYPE_LABELS: Record<PricingPlanType, string> = {
  COMMISSION: 'Commission',
  SUBSCRIPTION: 'Abonnement mensuel',
};

function formatMGA(amount: number): string {
  return new Intl.NumberFormat('fr-MG').format(amount) + ' Ar';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

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

  // Plans tarifaires
  const [plans, setPlans] = useState<CoopPricingPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [planForm, setPlanForm] = useState<{ type: PricingPlanType; commissionRate: string; monthlyFeeMga: string; effectiveFrom: string }>({
    type: 'COMMISSION', commissionRate: '', monthlyFeeMga: '', effectiveFrom: new Date().toISOString().slice(0, 10),
  });
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // Abonnements
  const [subs, setSubs] = useState<CoopSubscription[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [subForm, setSubForm] = useState({ periodStart: '', periodEnd: '', amountMga: '' });
  const [subSaving, setSubSaving] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

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

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const res = await fetch(`/api/proxy/v1/admin/cooperatives/${coopId}/pricing-plans`, { cache: 'no-store' });
      if (res.ok) setPlans(await res.json());
    } finally {
      setPlansLoading(false);
    }
  }, [coopId]);

  const loadSubs = useCallback(async () => {
    setSubsLoading(true);
    try {
      const res = await fetch(`/api/proxy/v1/admin/cooperatives/${coopId}/subscriptions`, { cache: 'no-store' });
      if (res.ok) setSubs(await res.json());
    } finally {
      setSubsLoading(false);
    }
  }, [coopId]);

  const handleCreatePlan = async () => {
    setPlanError(null);
    const body: Record<string, unknown> = {
      type: planForm.type,
      effectiveFrom: new Date(planForm.effectiveFrom).toISOString(),
    };
    if (planForm.type === 'COMMISSION') {
      const rate = parseFloat(planForm.commissionRate);
      if (!planForm.commissionRate || isNaN(rate)) { setPlanError('Taux de commission requis (ex. 4).'); return; }
      body.commissionRate = rate;
    } else {
      const fee = parseInt(planForm.monthlyFeeMga, 10);
      if (!planForm.monthlyFeeMga || isNaN(fee)) { setPlanError('Montant mensuel requis.'); return; }
      body.monthlyFeeMga = fee;
    }
    setPlanSaving(true);
    try {
      const res = await fetch(`/api/proxy/v1/admin/cooperatives/${coopId}/pricing-plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as {message?: string}).message ?? `HTTP ${res.status}`); }
      setActionModal(null);
      await loadPlans();
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Erreur lors de la création du plan.');
    } finally {
      setPlanSaving(false);
    }
  };

  const handleCreateSub = async () => {
    setSubError(null);
    const amount = parseInt(subForm.amountMga, 10);
    if (!subForm.periodStart || !subForm.periodEnd) { setSubError('Dates de période requises.'); return; }
    if (!subForm.amountMga || isNaN(amount)) { setSubError('Montant requis.'); return; }
    setSubSaving(true);
    try {
      const res = await fetch(`/api/proxy/v1/admin/cooperatives/${coopId}/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodStart: new Date(subForm.periodStart).toISOString(), periodEnd: new Date(subForm.periodEnd).toISOString(), amountMga: amount }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as {message?: string}).message ?? `HTTP ${res.status}`); }
      setActionModal(null);
      setSubForm({ periodStart: '', periodEnd: '', amountMga: '' });
      await loadSubs();
    } catch (err) {
      setSubError(err instanceof Error ? err.message : "Erreur lors de la création de l'abonnement.");
    } finally {
      setSubSaving(false);
    }
  };

  const handleMarkPaid = async (subId: string) => {
    try {
      const res = await fetch(`/api/proxy/v1/admin/subscriptions/${subId}/mark-paid`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) await loadSubs();
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadCoop();
    loadPlans();
    loadSubs();
  }, [loadCoop, loadPlans, loadSubs]);

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

      {/* ─── Plans tarifaires ─────────────────────────────────────────────── */}
      <section aria-labelledby="plans-heading">
        <div className="flex items-center justify-between mb-3">
          <h2 id="plans-heading" className="text-base font-semibold text-gray-900">Plans tarifaires</h2>
          {canAct && (
            <Button variant="secondary" size="sm" onClick={() => { setPlanError(null); setActionModal('new-plan'); }}>
              + Nouveau plan
            </Button>
          )}
        </div>
        {plansLoading ? (
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-center animate-pulse">
            <p className="text-xs text-gray-400">Chargement…</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500">Aucun plan configuré.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {plans.map((plan) => (
              <div key={plan.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-brand-dark">{PLAN_TYPE_LABELS[plan.type]}</p>
                  <p className="text-xs text-gray-500">
                    {plan.type === 'COMMISSION'
                      ? `${plan.commissionRate ?? 0} % de commission`
                      : `${formatMGA(plan.monthlyFeeMga ?? 0)} / mois`}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Depuis le {fmtDate(plan.effectiveFrom)}
                    {plan.effectiveUntil ? ` — jusqu'au ${fmtDate(plan.effectiveUntil)}` : ' (actif)'}
                  </p>
                </div>
                {!plan.effectiveUntil && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    Actif
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── Abonnements ──────────────────────────────────────────────────── */}
      <section aria-labelledby="subs-heading">
        <div className="flex items-center justify-between mb-3">
          <h2 id="subs-heading" className="text-base font-semibold text-gray-900">Abonnements</h2>
          {canAct && (
            <Button variant="secondary" size="sm" onClick={() => { setSubError(null); setActionModal('new-sub'); }}>
              + Nouvel abonnement
            </Button>
          )}
        </div>
        {subsLoading ? (
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-center animate-pulse">
            <p className="text-xs text-gray-400">Chargement…</p>
          </div>
        ) : subs.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500">Aucun abonnement enregistré.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {subs.map((sub) => (
              <div key={sub.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-brand-dark">{formatMGA(sub.amountMga)}</p>
                  <p className="text-xs text-gray-500">
                    {fmtDate(sub.periodStart)} → {fmtDate(sub.periodEnd)}
                  </p>
                  {sub.paidAt && (
                    <p className="text-xs text-green-600 mt-0.5">Payé le {fmtDate(sub.paidAt)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    sub.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {sub.status === 'PAID' ? 'Payé' : 'En attente'}
                  </span>
                  {sub.status !== 'PAID' && canAct && (
                    <Button variant="secondary" size="sm" onClick={() => handleMarkPaid(sub.id)}>
                      Marquer payé
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
      {/* Modal nouveau plan tarifaire */}
      {actionModal === 'new-plan' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-brand-dark">Nouveau plan tarifaire</h2>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select
                value={planForm.type}
                onChange={(e) => setPlanForm((p) => ({ ...p, type: e.target.value as PricingPlanType }))}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                <option value="COMMISSION">Commission (%)</option>
                <option value="SUBSCRIPTION">Abonnement mensuel (Ar)</option>
              </select>
            </div>
            {planForm.type === 'COMMISSION' ? (
              <Input
                label="Taux de commission (%)"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={planForm.commissionRate}
                onChange={(e) => setPlanForm((p) => ({ ...p, commissionRate: e.target.value }))}
                placeholder="4"
              />
            ) : (
              <Input
                label="Montant mensuel (Ar)"
                type="number"
                min={0}
                value={planForm.monthlyFeeMga}
                onChange={(e) => setPlanForm((p) => ({ ...p, monthlyFeeMga: e.target.value }))}
                placeholder="50000"
              />
            )}
            <Input
              label="Date d'effet"
              type="date"
              value={planForm.effectiveFrom}
              onChange={(e) => setPlanForm((p) => ({ ...p, effectiveFrom: e.target.value }))}
            />
            {planError && <p role="alert" className="text-xs text-red-600">{planError}</p>}
            <div className="flex gap-3 pt-2">
              <Button variant="action" fullWidth isLoading={planSaving} onClick={handleCreatePlan}>
                Appliquer
              </Button>
              <Button variant="ghost" fullWidth disabled={planSaving} onClick={() => setActionModal(null)}>
                Annuler
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nouvel abonnement */}
      {actionModal === 'new-sub' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-brand-dark">Nouvel abonnement</h2>
            <Input
              label="Début de période"
              type="date"
              value={subForm.periodStart}
              onChange={(e) => setSubForm((p) => ({ ...p, periodStart: e.target.value }))}
            />
            <Input
              label="Fin de période"
              type="date"
              value={subForm.periodEnd}
              onChange={(e) => setSubForm((p) => ({ ...p, periodEnd: e.target.value }))}
            />
            <Input
              label="Montant (Ar)"
              type="number"
              min={0}
              value={subForm.amountMga}
              onChange={(e) => setSubForm((p) => ({ ...p, amountMga: e.target.value }))}
              placeholder="50000"
            />
            {subError && <p role="alert" className="text-xs text-red-600">{subError}</p>}
            <div className="flex gap-3 pt-2">
              <Button variant="action" fullWidth isLoading={subSaving} onClick={handleCreateSub}>
                Créer
              </Button>
              <Button variant="ghost" fullWidth disabled={subSaving} onClick={() => setActionModal(null)}>
                Annuler
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
