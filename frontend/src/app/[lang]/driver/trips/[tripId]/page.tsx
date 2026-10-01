'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import { dateLocale } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { DepartureButton } from '@/components/driver/DepartureButton';
import type { DriverTripSummary } from '@/lib/types';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; trip: DriverTripSummary }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

function formatDateTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(dateLocale(lang), {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

const IconScan = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM17 17h4M17 14h4M14 17v4" />
  </svg>
);
const IconList = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);
const IconChevronLeft = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export default function TripDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations();
  const lang = useLang();
  const td = t.driver;
  const tripId = params.tripId as string;

  const [pageState, setPageState] = useState<PageState>({ status: 'loading' });
  const [departed, setDeparted] = useState(false);

  const loadTrip = useCallback(async () => {
    setPageState({ status: 'loading' });
    try {
      const response = await fetch('/api/proxy/v1/driver/trips/today', { cache: 'no-store' });
      if (!response.ok) {
        setPageState({ status: 'error', message: td.tripDetail.errorLoad });
        return;
      }
      const trips = await response.json() as DriverTripSummary[];
      const trip = Array.isArray(trips) ? trips.find((tr) => tr.tripInstanceId === tripId) : undefined;
      if (!trip) { setPageState({ status: 'not-found' }); return; }
      if (trip.status === 'DEPARTED') setDeparted(true);
      setPageState({ status: 'ready', trip });
    } catch {
      setPageState({ status: 'error', message: t.common.errorNetwork });
    }
  }, [tripId, td, t]);

  useEffect(() => { loadTrip(); }, [loadTrip]);

  if (pageState.status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">{td.tripDetail.loading}</p>
      </div>
    );
  }

  if (pageState.status === 'not-found') {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 gap-4 text-center">
        <p className="text-gray-600 font-medium">{td.tripDetail.notFound}</p>
        <Button variant="primary" size="md" onClick={() => router.push(`/${lang}/driver`)}>{t.common.retry}</Button>
      </div>
    );
  }

  if (pageState.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 gap-4 text-center">
        <svg className="w-12 h-12 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className="text-sm text-gray-700 font-medium max-w-xs">{pageState.message}</p>
        <Button variant="primary" size="md" onClick={loadTrip}>{t.common.retry}</Button>
      </div>
    );
  }

  const { trip } = pageState;
  const isActuallyDeparted = departed || trip.status === 'DEPARTED';
  const passengersCount = trip.passengersCount ?? trip.totalPassengers ?? 0;
  const originName = trip.route.originName ?? trip.route.origin;
  const destinationName = trip.route.destinationName ?? trip.route.destination;
  const boardingPercent = passengersCount > 0 ? Math.round((trip.boardedCount / passengersCount) * 100) : 0;

  return (
    <div className="pb-4">
      <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-100">
        <Link href={`/${lang}/driver`} className="flex items-center justify-center w-10 h-10 -ml-2 rounded-lg text-gray-600 hover:bg-gray-100" aria-label={t.common.back}>
          <IconChevronLeft />
        </Link>
        <h1 className="text-base font-bold text-gray-900 truncate">{originName} → {destinationName}</h1>
      </div>

      <div className="mx-4 mt-4 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-4 border-b border-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{td.tripDetail.title}</p>
          <p className="text-xl font-bold text-brand">{originName} → {destinationName}</p>
        </div>

        <div className="grid grid-cols-2 divide-x divide-gray-50">
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500 mb-0.5">{td.tripDetail.departure}</p>
            <p className="text-sm font-semibold text-gray-800">{formatDateTime(trip.departureAt, lang)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500 mb-0.5">{td.tripDetail.vehicle}</p>
            <p className="text-sm font-semibold text-gray-800 font-mono">{trip.vehicleRegistration ?? '—'}</p>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-50">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500">{td.manifest.filterBoarded}</p>
            <p className="text-sm font-bold text-gray-800">
              {trip.boardedCount}<span className="text-gray-400 font-normal"> / {passengersCount} {td.tripDetail.seatsReserved}</span>
            </p>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-brand rounded-full transition-all duration-300" style={{ width: `${boardingPercent}%` }}
              role="progressbar" aria-valuenow={trip.boardedCount} aria-valuemin={0} aria-valuemax={passengersCount} />
          </div>
          <p className="text-xs text-gray-400 text-right mt-1">{boardingPercent}%</p>
        </div>

        {isActuallyDeparted && (
          <div className="px-4 py-2 bg-indigo-50 border-t border-indigo-100">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-700">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              {td.tripDetail.alreadyDeparted}
            </span>
          </div>
        )}
      </div>

      <div className="mx-4 mt-4 space-y-3">
        <Link href={`/${lang}/driver/trips/${tripId}/scan`}
          className="flex items-center justify-center gap-2.5 w-full min-h-[52px] px-4 py-3 rounded-xl bg-brand text-white font-semibold text-base hover:bg-brand-dark active:bg-brand-dark focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 transition-colors duration-150">
          <IconScan />{td.tripDetail.scanPassenger}
        </Link>
        <Link href={`/${lang}/driver/trips/${tripId}/manifest`}
          className="flex items-center justify-center gap-2.5 w-full min-h-[52px] px-4 py-3 rounded-xl bg-white text-brand font-semibold text-base border-2 border-brand/30 hover:bg-brand/5 active:bg-brand/10 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 transition-colors duration-150">
          <IconList />{td.tripDetail.viewManifest}
        </Link>
      </div>

      <div className="mx-4 mt-5">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">{td.departure.button}</p>
        <DepartureButton tripInstanceId={tripId} alreadyDeparted={isActuallyDeparted} onDeparted={() => setDeparted(true)} />
      </div>
    </div>
  );
}
