'use client';

/**
 * Supervision des paiements / réservations — /fr/admin/bookings
 *
 * Appelle GET /v1/admin/payments (contrat-api.yaml, tag Admin) avec filtres :
 *  - status (PaymentStatus)
 *  - provider (PaymentProvider)
 *  - from / to (date)
 *
 * NOTE : L'endpoint /admin/bookings n'existe pas dans le contrat API.
 * Cette page utilise /admin/payments qui est l'équivalent admin disponible.
 * Un endpoint /admin/bookings avec filtres avancés est à implémenter si nécessaire.
 *
 * États de chargement et d'erreur explicites.
 */

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { Payment, PaymentProvider, PaymentStatus } from '@/lib/types';

const PAYMENT_STATUS_OPTIONS: { value: PaymentStatus | ''; label: string }[] = [
  { value: '', label: 'Tous les statuts' },
  { value: 'INITIATED', label: 'Initié' },
  { value: 'PENDING', label: 'En attente' },
  { value: 'CONFIRMED', label: 'Confirmé' },
  { value: 'FAILED', label: 'Échoué' },
  { value: 'EXPIRED', label: 'Expiré' },
  { value: 'REFUNDED_AT_COUNTER', label: 'Remboursé au guichet' },
];

const PROVIDER_OPTIONS: { value: PaymentProvider | ''; label: string }[] = [
  { value: '', label: 'Tous les opérateurs' },
  { value: 'MVOLA', label: 'MVola' },
  { value: 'ORANGE_MONEY', label: 'Orange Money' },
  { value: 'CASH', label: 'Espèces' },
];

const statusVariants: Record<PaymentStatus, 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'default'> = {
  INITIATED: 'warning',
  PENDING: 'warning',
  CONFIRMED: 'success',
  FAILED: 'error',
  EXPIRED: 'neutral',
  REFUNDED_AT_COUNTER: 'info',
};

const statusLabels: Record<PaymentStatus, string> = {
  INITIATED: 'Initié',
  PENDING: 'En attente',
  CONFIRMED: 'Confirmé',
  FAILED: 'Échoué',
  EXPIRED: 'Expiré',
  REFUNDED_AT_COUNTER: 'Remboursé (guichet)',
};

const today = new Date().toISOString().slice(0, 10);
const monthStart = new Date(new Date().setDate(1)).toISOString().slice(0, 10);

export default function AdminBookingsPage() {
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | ''>('');
  const [providerFilter, setProviderFilter] = useState<PaymentProvider | ''>('');
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(today);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (providerFilter) params.set('provider', providerFilter);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    return `/api/proxy/v1/admin/payments?${params.toString()}`;
  }, [statusFilter, providerFilter, fromDate, toDate]);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data: Payment[] = await res.json();
      setPayments(data ?? []);
    } catch {
      setError('Impossible de charger les données. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const totalConfirmed = payments
    .filter((p) => p.status === 'CONFIRMED')
    .reduce((sum, p) => sum + p.amountMga, 0);

  return (
    <div className="space-y-5">
      {/* Titre */}
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Supervision des paiements</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Source : <code className="text-xs bg-gray-100 px-1 rounded">GET /admin/payments</code>
        </p>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="from-date" className="text-xs text-gray-600">Du</label>
          <input
            id="from-date"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to-date" className="text-xs text-gray-600">Au</label>
          <input
            id="to-date"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="status-filter" className="text-xs text-gray-600">Statut</label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as PaymentStatus | '')}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand bg-white"
          >
            {PAYMENT_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="provider-filter" className="text-xs text-gray-600">Opérateur</label>
          <select
            id="provider-filter"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value as PaymentProvider | '')}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand bg-white"
          >
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Chargement */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          {[...Array(5)].map((_, i) => (
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
            <button type="button" onClick={loadPayments} className="text-sm underline mt-1">Réessayer</button>
          </div>
        </div>
      )}

      {/* Résultats */}
      {!loading && !error && (
        <>
          {/* Total confirmé */}
          {payments.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-sm">
              <span className="text-gray-500">Total confirmé sur la période :</span>{' '}
              <span className="font-bold text-brand-dark">
                {totalConfirmed.toLocaleString('fr-MG')} Ar
              </span>
              <span className="text-gray-400 ml-2">({payments.filter((p) => p.status === 'CONFIRMED').length} paiements)</span>
            </div>
          )}

          {payments.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-sm text-gray-500">
              Aucun paiement pour ces filtres.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[580px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">ID Réservation</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Montant</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Opérateur</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-xs text-gray-500 font-mono truncate max-w-[120px]">
                          {payment.bookingId.slice(0, 8)}…
                        </td>
                        <td className="py-3 px-4 text-sm font-medium text-brand-dark">
                          {payment.amountMga.toLocaleString('fr-MG')} Ar
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-700">
                          {payment.provider}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={statusVariants[payment.status]}>
                            {statusLabels[payment.status]}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-500">
                          {new Date(payment.initiatedAt).toLocaleDateString('fr-FR', {
                            day: '2-digit',
                            month: 'short',
                          })}
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
    </div>
  );
}
