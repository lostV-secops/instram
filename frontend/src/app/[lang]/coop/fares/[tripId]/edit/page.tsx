'use client';

/**
 * Éditeur de tarifs — /[lang]/coop/fares/{tripId}/edit
 */

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useCoop } from '../../../CoopContext';
import { getTranslations } from '@/lib/i18n';
import { FareEditor } from '@/components/coop/FareEditor';
import type { Fare, TripInstanceCoopDetail } from '@/lib/types';

export default function EditFarePage() {
  const params = useParams();
  const tripId = params.tripId as string;
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [fares, setFares] = useState<Fare[]>([]);
  const [trip, setTrip] = useState<TripInstanceCoopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setError(null);
      try {
        const [faresRes, tripRes] = await Promise.all([
          fetch(`/api/proxy/v1/coop/trips/${tripId}/fares`, { cache: 'no-store' }),
          fetch(`/api/proxy/v1/coop/trips/${tripId}`, { cache: 'no-store' }),
        ]);
        if (!faresRes.ok) throw new Error(t.common.errorNetwork);
        const [faresData, tripData] = await Promise.all([
          faresRes.json(),
          tripRes.ok ? (tripRes.json() as Promise<TripInstanceCoopDetail>) : Promise.resolve(null),
        ]);
        setFares(Array.isArray(faresData) ? faresData : []);
        setTrip(tripData);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.errorNetwork);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tripId, t.common.errorNetwork]);

  const tripLabel = trip
    ? `${trip.route?.originCity?.name ?? '—'} → ${trip.route?.destinationCity?.name ?? '—'}`
    : tripId;

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
        <p className="text-sm text-gray-500 mt-1">{t.coop.fares.edit.trip} : {tripLabel}</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <FareEditor tripId={tripId} initialFares={fares} />
      </div>
    </div>
  );
}
