'use client';

/**
 * Gestion des lignes — /[lang]/coop/routes
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useCoop } from '../CoopContext';
import { getTranslations } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { CoopRouteDetail } from '@/lib/types';

export default function RoutesPage() {
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [routes, setRoutes] = useState<CoopRouteDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/v1/coop/routes', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRoutes(Array.isArray(data) ? data : []);
    } catch {
      setError(t.common.errorNetwork);
    } finally {
      setLoading(false);
    }
  }, [t.common.errorNetwork]);

  const handleToggle = async (route: CoopRouteDetail) => {
    try {
      const res = await fetch(`/api/proxy/v1/coop/routes/${route.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !route.isActive }),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError(t.common.errorNetwork);
    }
  };

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-brand-dark">{t.coop.routes.title}</h1>
        <Link href={`/${lang}/coop/routes/new`}>
          <Button variant="primary" size="sm">+ {t.coop.routes.newRoute}</Button>
        </Link>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 animate-pulse text-center">
          <p className="text-sm text-gray-400">{t.common.loading}</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {error}
          <button type="button" onClick={load} className="block underline mt-1">{t.common.retry}</button>
        </div>
      ) : routes.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-500">
          {t.coop.routes.noRoutes}{' '}
          <Link href={`/${lang}/coop/routes/new`} className="text-brand underline">{t.coop.routes.new.title}</Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.members.name}</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.routes.origin}</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.routes.destination}</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.routes.duration}</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.trips.status}</th>
                  <th className="py-2 px-4" />
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-sm font-medium text-gray-900">{r.displayName}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{r.originCity?.name ?? '—'}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{r.destinationCity?.name ?? '—'}</td>
                    <td className="py-3 px-4 text-sm text-gray-500 tabular-nums">
                      {r.estimatedDurationMin ? `${r.estimatedDurationMin} ${t.coop.routes.min}` : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={r.isActive ? 'success' : 'neutral'}>
                        {r.isActive ? t.coop.routes.active : t.coop.routes.inactive}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/${lang}/coop/trips?routeId=${r.id}`}
                          className="text-sm text-brand hover:underline whitespace-nowrap"
                        >
                          {t.coop.trips.title}
                        </Link>
                        <Button variant="secondary" size="sm" onClick={() => handleToggle(r)}>
                          {r.isActive ? t.coop.vehicles.deactivate : t.coop.vehicles.reactivate}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
