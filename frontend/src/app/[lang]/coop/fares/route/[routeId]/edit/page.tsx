'use client';

/**
 * Éditeur de tarifs par ligne — /[lang]/coop/fares/route/{routeId}/edit
 */

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useCoop } from '../../../../CoopContext';
import { getTranslations, cityName } from '@/lib/i18n';
import { FareEditor } from '@/components/coop/FareEditor';
import type { Fare } from '@/lib/types';

interface RouteDetail {
  id: string;
  displayName?: string;
  originCity: { id: string; nameFr: string; nameMg: string };
  destinationCity: { id: string; nameFr: string; nameMg: string };
}

interface RouteFare {
  id: string;
  routeId: string;
  category: string;
  priceMga: number;
  updatedAt: string;
}

export default function EditRouteFarePage() {
  const params = useParams();
  const routeId = params.routeId as string;
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [fares, setFares] = useState<Fare[]>([]);
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setError(null);
      try {
        const [faresRes, routeRes] = await Promise.all([
          fetch(`/api/proxy/v1/coop/routes/${routeId}/fares`, { cache: 'no-store' }),
          fetch(`/api/proxy/v1/coop/routes/${routeId}`, { cache: 'no-store' }),
        ]);
        if (!faresRes.ok) throw new Error(t.common.errorNetwork);
        const [faresData, routeData] = await Promise.all([
          faresRes.json() as Promise<RouteFare[]>,
          routeRes.ok ? (routeRes.json() as Promise<RouteDetail>) : Promise.resolve(null),
        ]);
        // Convertir RouteFare → Fare (même forme, tripInstanceId fictif)
        const asFares: Fare[] = (Array.isArray(faresData) ? faresData : []).map((rf) => ({
          id: rf.id,
          tripInstanceId: routeId,
          seatDefinitionId: null,
          category: rf.category as Fare['category'],
          priceMga: rf.priceMga,
          createdAt: rf.updatedAt,
          updatedAt: rf.updatedAt,
        }));
        setFares(asFares);
        setRoute(routeData);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.errorNetwork);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [routeId, t.common.errorNetwork]);

  const routeLabel = route
    ? `${cityName(route.originCity, lang)} → ${cityName(route.destinationCity, lang)}`
    : routeId;

  if (loading) {
    return (
      <div className="max-w-lg space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-32" />
        <div className="h-48 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg space-y-4">
        <Link href={`/${lang}/coop/fares`} className="text-brand text-sm hover:underline">← {t.coop.fares.title}</Link>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      <Link href={`/${lang}/coop/fares`} className="text-brand text-sm hover:underline">← {t.coop.fares.title}</Link>
      <div>
        <h1 className="text-xl font-bold text-brand-dark">{t.coop.fares.edit.title}</h1>
        <p className="text-sm text-gray-500 mt-1">Ligne : {routeLabel}</p>
        <p className="text-xs text-gray-400 mt-1">Ces tarifs s&apos;appliquent à tous les nouveaux trajets créés sur cette ligne.</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <FareEditor
          endpoint={`/api/proxy/v1/coop/routes/${routeId}/fares`}
          redirectTo={`/${lang}/coop/fares`}
          initialFares={fares}
        />
      </div>
    </div>
  );
}
