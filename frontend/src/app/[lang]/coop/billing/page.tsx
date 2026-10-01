'use client';

/**
 * Facturation coopérative — /[lang]/coop/billing
 *
 * Affiche :
 *  - Plan tarifaire actif (GET /v1/coop/pricing-plan)
 *  - Historique des abonnements (GET /v1/coop/subscriptions)
 *
 * Lecture seule : la modification du plan se fait via la console admin InsTRAM.
 */

import { useState, useEffect } from 'react';
import { useCoop } from '../CoopContext';
import { getTranslations } from '@/lib/i18n';
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
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const STATUS_LABELS: Record<string, string> = {
    MANUAL: t.coop.billing.statusManual,
    PAID: t.coop.billing.statusPaid,
    OVERDUE: t.coop.billing.statusOverdue,
  };

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
          throw new Error(`${t.coop.billing.activePlan} : ${planRes.status}`);
        }

        if (!subsRes.ok) throw new Error(`${t.coop.billing.history} : ${subsRes.status}`);
        setSubs(await subsRes.json() as Subscription[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.errorNetwork);
      } finally {
        setLoading(false);
      }
    };
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-40" />
        <div className="h-32 bg-gray-200 rounded-xl" />
        <div className="h-48 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-brand-dark">{t.coop.billing.title}</h1>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {t.coop.billing.error} : {error}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-xl font-bold text-brand-dark">{t.coop.billing.title}</h1>

      {/* Plan tarifaire actif */}
      <section>
        <h2 className="text-base font-semibold text-brand-dark mb-3">{t.coop.billing.activePlan}</h2>
        {plan ? (
          <div className="rounded-xl border border-gray-200 p-4 space-y-2 bg-white">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700">{t.coop.billing.typeLabel}</span>
              <Badge variant="neutral">
                {plan.type === 'COMMISSION' ? t.coop.billing.typeCommission : t.coop.billing.typeSubscription}
              </Badge>
            </div>
            {plan.type === 'COMMISSION' && plan.commissionRate !== null && (
              <p className="text-sm text-gray-700">
                {t.coop.billing.commissionRate} : <strong>{plan.commissionRate} %</strong>
              </p>
            )}
            {plan.type === 'SUBSCRIPTION' && plan.monthlyFeeMga !== null && (
              <p className="text-sm text-gray-700">
                {t.coop.billing.monthlyFee} : <strong>{formatMga(plan.monthlyFeeMga)}</strong>
              </p>
            )}
            <p className="text-sm text-gray-500">
              {t.coop.billing.effectiveFrom} {formatDate(plan.effectiveFrom)}
              {plan.effectiveUntil && ` ${t.coop.billing.effectiveUntil} ${formatDate(plan.effectiveUntil)}`}
            </p>
            <p className="text-xs text-gray-400 mt-1">{t.coop.billing.contactNote}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">{t.coop.billing.noPlan}</p>
        )}
      </section>

      {/* Historique abonnements */}
      <section>
        <h2 className="text-base font-semibold text-brand-dark mb-3">{t.coop.billing.history}</h2>
        {subs.length === 0 ? (
          <p className="text-sm text-gray-500">{t.coop.billing.noSubs}</p>
        ) : (
          <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
            <table className="w-full text-sm border-collapse min-w-[480px]">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-600 border-b border-gray-200">
                  <th className="px-4 py-2.5">{t.coop.billing.colPeriod}</th>
                  <th className="px-4 py-2.5">{t.coop.billing.colAmount}</th>
                  <th className="px-4 py-2.5">{t.coop.billing.colStatus}</th>
                  <th className="px-4 py-2.5">{t.coop.billing.colPaidAt}</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700">
                      {formatDate(s.periodStart)} — {formatDate(s.periodEnd)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{formatMga(s.amountMga)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={statusVariant(s.status)}>
                        {STATUS_LABELS[s.status] ?? s.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{s.paidAt ? formatDate(s.paidAt) : '—'}</td>
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
