'use client';

/**
 * Facturation coopérative — /fr/coop/billing
 *
 * Affiche :
 *  - Plan tarifaire actif (GET /v1/coop/pricing-plan)
 *  - Historique des abonnements (GET /v1/coop/subscriptions)
 *
 * Lecture seule : la modification du plan se fait via la console admin InsTRAM.
 */

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/Badge';

interface PricingPlan {
  id: string;
  type: 'COMMISSION' | 'SUBSCRIPTION';
  commissionRate: number | null;
  monthlyFeeMga: number | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

interface Subscription {
  id: string;
  periodStart: string;
  periodEnd: string;
  amountMga: number;
  status: string;
  paidAt: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  MANUAL: 'Suivi manuel',
  PAID: 'Payé',
  OVERDUE: 'En retard',
};

function statusVariant(status: string) {
  switch (status) {
    case 'PAID': return 'success' as const;
    case 'OVERDUE': return 'error' as const;
    default: return 'neutral' as const;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-MG', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatMga(amount: number) {
  return `${amount.toLocaleString('fr-FR')} MGA`;
}

export default function BillingPage() {
  const [plan, setPlan] = useState<PricingPlan | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [planRes, subsRes] = await Promise.all([
          fetch('/api/proxy/v1/coop/pricing-plan'),
          fetch('/api/proxy/v1/coop/subscriptions'),
        ]);

        if (planRes.ok) {
          setPlan(await planRes.json() as PricingPlan);
        } else if (planRes.status !== 404) {
          throw new Error(`Plan tarifaire : ${planRes.status}`);
        }

        if (!subsRes.ok) throw new Error(`Abonnements : ${subsRes.status}`);
        setSubs(await subsRes.json() as Subscription[]);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-[#162E49] mb-4">Facturation</h1>
        <p className="text-gray-500">Chargement…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-[#162E49] mb-4">Facturation</h1>
        <p className="text-red-600">Erreur : {error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl space-y-8">
      <h1 className="text-xl font-semibold text-[#162E49]">Facturation</h1>

      {/* Plan tarifaire actif */}
      <section>
        <h2 className="text-base font-semibold text-[#162E49] mb-3">Plan tarifaire actif</h2>
        {plan ? (
          <div className="rounded-lg border border-gray-200 p-4 space-y-2 bg-white">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700">Type</span>
              <Badge variant="neutral">
                {plan.type === 'COMMISSION' ? 'À la commission' : 'Abonnement mensuel'}
              </Badge>
            </div>
            {plan.type === 'COMMISSION' && plan.commissionRate !== null && (
              <p className="text-sm text-gray-700">
                Taux de commission : <strong>{plan.commissionRate} %</strong>
              </p>
            )}
            {plan.type === 'SUBSCRIPTION' && plan.monthlyFeeMga !== null && (
              <p className="text-sm text-gray-700">
                Frais mensuels : <strong>{formatMga(plan.monthlyFeeMga)}</strong>
              </p>
            )}
            <p className="text-sm text-gray-500">
              En vigueur depuis le {formatDate(plan.effectiveFrom)}
              {plan.effectiveUntil && ` jusqu'au ${formatDate(plan.effectiveUntil)}`}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Pour modifier votre plan, contactez l'équipe InsTRAM.
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Aucun plan tarifaire actif. Contactez l'équipe InsTRAM.
          </p>
        )}
      </section>

      {/* Historique abonnements */}
      <section>
        <h2 className="text-base font-semibold text-[#162E49] mb-3">Historique des abonnements</h2>
        {subs.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun abonnement enregistré.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-600">
                  <th className="px-3 py-2 border-b border-gray-200">Période</th>
                  <th className="px-3 py-2 border-b border-gray-200">Montant</th>
                  <th className="px-3 py-2 border-b border-gray-200">Statut</th>
                  <th className="px-3 py-2 border-b border-gray-200">Payé le</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 border-b border-gray-100">
                    <td className="px-3 py-2 text-gray-700">
                      {formatDate(s.periodStart)} — {formatDate(s.periodEnd)}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {formatMga(s.amountMga)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(s.status)}>
                        {STATUS_LABELS[s.status] ?? s.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-gray-500">
                      {s.paidAt ? formatDate(s.paidAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
