'use client';

/**
 * Gestion des tarifs — /[lang]/coop/fares
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useCoop } from '../CoopContext';
import { getTranslations, cityName, dateLocale } from '@/lib/i18n';
import type { TripInstance, TripInstanceList } from '@/lib/types';

function formatDateTime(iso: string, lang: string): string {
  try {
    return new Date(iso).toLocaleString(dateLocale(lang), {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function FaresPage() {
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [trips, setTrips] = useState<TripInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const from = new Date().toISOString().slice(0, 10);
      const toDate = new Date();
      toDate.setDate(toDate.getDate() + 7);
      const to = toDate.toISOString().slice(0, 10);
      const res = await fetch(
        `/api/proxy/v1/coop/trips?from=${from}&to=${to}&limit=50`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error();
      const data: TripInstanceList = await res.json();
      setTrips(data.items ?? []);
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
        <p className="text-sm text-gray-500 mt-1">{t.coop.fares.selectTrip}</p>
      </div>

      <div className="bg-brand/5 border border-brand/20 rounded-lg px-4 py-3 text-sm text-brand-dark">
        {t.coop.fares.sovereignty}
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
      ) : trips.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-500">
          {t.coop.fares.noTrips}{' '}
          <Link href={`/${lang}/coop/trips/new`} className="text-brand underline">{t.coop.trips.new.title}</Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[400px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.trips.route}</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.trips.departure}</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.trips.actions}</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => (
                  <tr key={trip.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-sm font-medium text-gray-900">
                      {trip.route ? `${cityName(trip.route.originCity, lang)} → ${cityName(trip.route.destinationCity, lang)}` : trip.routeId}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600 tabular-nums">{formatDateTime(trip.departureAt, lang)}</td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/${lang}/coop/fares/${trip.id}/edit`}
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
