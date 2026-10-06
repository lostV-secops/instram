'use client';

import { useState, useEffect } from 'react';
import { useCoop } from '../CoopContext';
import { getTranslations, dateLocale } from '@/lib/i18n';

// ─── Types locaux ────────────────────────────────────────────────────────────

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
  status: 'MANUAL' | 'PAID' | 'LATE' | 'UNPAID';
  paidAt: string | null;
}

interface Commission {
  id: string;
  bookingRef: string;
  passengerName: string | null;
  seatSubtotalMga: number;
  amountMga: number;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string, lang: string) {
  try {
    return new Date(iso).toLocaleDateString(dateLocale(lang), {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch { return iso; }
}

function fmtMga(amount: number) {
  return amount.toLocaleString('fr-MG') + ' Ar';
}

function SubStatusBadge({ status, t }: { status: Subscription['status']; t: ReturnType<typeof getTranslations> }) {
  const map: Record<Subscription['status'], string> = {
    MANUAL:  'bg-gray-100 text-gray-600',
    PAID:    'bg-green-100 text-green-700',
    LATE:    'bg-orange-100 text-orange-700',
    UNPAID:  'bg-red-100 text-red-700',
  };
  const label: Record<Subscription['status'], string> = {
    MANUAL:  t.coop.billing.statusManual,
    PAID:    t.coop.billing.statusPaid,
    LATE:    t.coop.billing.statusOverdue,
    UNPAID:  t.coop.billing.statusOverdue,
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status]}`}>
      {label[status]}
    </span>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [plan, setPlan] = useState<PricingPlan | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [planRes, subsRes, commissionsRes] = await Promise.all([
          fetch('/api/proxy/v1/coop/pricing-plan', { cache: 'no-store' }),
          fetch('/api/proxy/v1/coop/subscriptions', { cache: 'no-store' }),
          fetch('/api/proxy/v1/coop/commissions', { cache: 'no-store' }),
        ]);

        if (planRes.ok) {
          setPlan(await planRes.json());
        } else if (planRes.status !== 404) {
          throw new Error();
        }

        if (subsRes.ok) setSubs(await subsRes.json());
        if (commissionsRes.ok) setCommissions(await commissionsRes.json());
      } catch {
        setError(t.coop.billing.error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const totalCommissionsMga = commissions.reduce((acc, c) => acc + c.amountMga, 0);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-gray-200 rounded" />
        <div className="h-40 bg-gray-200 rounded-xl" />
        <div className="h-64 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">{t.coop.billing.title}</h1>

      {/* ── Plan tarifaire actif ── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold text-brand-dark">{t.coop.billing.activePlan}</h2>

        {!plan ? (
          <p className="text-sm text-gray-500">{t.coop.billing.noPlan}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <span className="text-gray-500 mr-2">{t.coop.billing.typeLabel}</span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  plan.type === 'COMMISSION'
                    ? 'bg-brand/10 text-brand'
                    : 'bg-purple-100 text-purple-700'
                }`}>
                  {plan.type === 'COMMISSION'
                    ? t.coop.billing.typeCommission
                    : t.coop.billing.typeSubscription}
                </span>
              </div>

              {plan.type === 'COMMISSION' && plan.commissionRate != null && (
                <div>
                  <span className="text-gray-500 mr-1">{t.coop.billing.commissionRate}</span>
                  <span className="font-semibold text-gray-900">{plan.commissionRate} %</span>
                </div>
              )}

              {plan.type === 'SUBSCRIPTION' && plan.monthlyFeeMga != null && (
                <div>
                  <span className="text-gray-500 mr-1">{t.coop.billing.monthlyFee}</span>
                  <span className="font-semibold text-gray-900">{fmtMga(plan.monthlyFeeMga)}</span>
                </div>
              )}

              <div>
                <span className="text-gray-500 mr-1">{t.coop.billing.effectiveFrom}</span>
                <span className="font-medium text-gray-900">{fmtDate(plan.effectiveFrom, lang)}</span>
                {plan.effectiveUntil && (
                  <>
                    <span className="text-gray-400 mx-1">{t.coop.billing.effectiveUntil}</span>
                    <span className="font-medium text-gray-900">{fmtDate(plan.effectiveUntil, lang)}</span>
                  </>
                )}
              </div>
            </div>

            <p className="text-xs text-gray-400 italic">{t.coop.billing.contactNote}</p>
          </div>
        )}
      </section>

      {/* ── Historique abonnements (plan SUBSCRIPTION) ── */}
      {plan?.type === 'SUBSCRIPTION' && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="text-base font-semibold text-brand-dark">{t.coop.billing.history}</h2>

          {subs.length === 0 ? (
            <p className="text-sm text-gray-500">{t.coop.billing.noSubs}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="py-2 px-3 text-left font-medium text-gray-500">{t.coop.billing.colPeriod}</th>
                    <th className="py-2 px-3 text-right font-medium text-gray-500">{t.coop.billing.colAmount}</th>
                    <th className="py-2 px-3 text-left font-medium text-gray-500">{t.coop.billing.colStatus}</th>
                    <th className="py-2 px-3 text-left font-medium text-gray-500">{t.coop.billing.colPaidAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((sub) => (
                    <tr key={sub.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 text-gray-700">
                        {fmtDate(sub.periodStart, lang)} – {fmtDate(sub.periodEnd, lang)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-gray-900">
                        {fmtMga(sub.amountMga)}
                      </td>
                      <td className="py-2.5 px-3">
                        <SubStatusBadge status={sub.status} t={t} />
                      </td>
                      <td className="py-2.5 px-3 text-gray-500">
                        {sub.paidAt ? fmtDate(sub.paidAt, lang) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Commissions prélevées (plan COMMISSION) ── */}
      {plan?.type === 'COMMISSION' && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-base font-semibold text-brand-dark">{t.coop.billing.commissionsTitle}</h2>
            {commissions.length > 0 && (
              <span className="text-sm font-semibold text-brand">
                {t.coop.billing.totalCommissions} : {fmtMga(totalCommissionsMga)}
              </span>
            )}
          </div>

          {commissions.length === 0 ? (
            <p className="text-sm text-gray-500">{t.coop.billing.noCommissions}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="py-2 px-3 text-left font-medium text-gray-500">{t.coop.billing.colDate}</th>
                    <th className="py-2 px-3 text-left font-medium text-gray-500">{t.coop.billing.colBooking}</th>
                    <th className="py-2 px-3 text-left font-medium text-gray-500">{t.coop.billing.colPassenger}</th>
                    <th className="py-2 px-3 text-right font-medium text-gray-500">{t.coop.billing.colSubtotal}</th>
                    <th className="py-2 px-3 text-right font-medium text-gray-500">{t.coop.billing.colCommission}</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 text-gray-500">{fmtDate(c.createdAt, lang)}</td>
                      <td className="py-2.5 px-3 font-mono text-brand-dark text-xs">{c.bookingRef}</td>
                      <td className="py-2.5 px-3 text-gray-700">{c.passengerName ?? '—'}</td>
                      <td className="py-2.5 px-3 text-right text-gray-700">{fmtMga(c.seatSubtotalMga)}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-brand">{fmtMga(c.amountMga)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-brand/20">
                    <td colSpan={4} className="py-2.5 px-3 text-right font-medium text-gray-700">
                      {t.coop.billing.totalCommissions}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-brand">
                      {fmtMga(totalCommissionsMga)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
