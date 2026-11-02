'use client';

/**
 * Gestion des tarifs — /[lang]/coop/fares
 * Liste les lignes de la coopérative avec leurs tarifs.
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useCoop } from '../CoopContext';
import { getTranslations, cityName } from '@/lib/i18n';

interface RouteFare {
  category: string;
  priceMga: number;
}

interface Route {
  id: string;
  displayName?: string;
  originCity: { id: string; nameFr: string; nameMg: string };
  destinationCity: { id: string; nameFr: string; nameMg: string };
  routeFares?: RouteFare[];
}

export default function FaresPage() {
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/v1/coop/routes', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data: Route[] | { items: Route[] } = await res.json();
      const items = Array.isArray(data) ? data : (data as { items: Route[] }).items ?? [];
      setRoutes(items);
    } catch {
      setError(t.common.errorNetwork);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">{t.coop.fares.title}</h1>
        <p className="text-sm text-gray-500 mt-1">Définissez les tarifs par ligne. Chaque nouveau trajet héritera automatiquement ces tarifs.</p>
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
          Aucune ligne configurée.{' '}
          <Link href={`/${lang}/coop/routes/new`} className="text-brand underline">Créer une ligne</Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[400px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Ligne</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Tarifs configurés</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.trips.actions}</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((route) => (
                  <tr key={route.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-sm font-medium text-gray-900">
                      {cityName(route.originCity, lang)} → {cityName(route.destinationCity, lang)}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-500">
                      {route.routeFares && route.routeFares.length > 0
                        ? route.routeFares.map((f) => `${f.category} : ${f.priceMga.toLocaleString()} Ar`).join(' · ')
                        : <span className="text-amber-600 text-xs">Aucun tarif</span>
                      }
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/${lang}/coop/fares/route/${route.id}/edit`}
                        className="text-brand text-sm font-medium hover:underline"
                      >
                        {t.coop.fares.edit.title}
                      </Link>
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
