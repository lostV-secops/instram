'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import { TripCardDriver } from '@/components/driver/TripCardDriver';
import { Button } from '@/components/ui/Button';
import type { DriverTripSummary } from '@/lib/types';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; trips: DriverTripSummary[] }
  | { status: 'error'; message: string };

const IconRefresh = ({ spinning }: { spinning: boolean }) => (
  <svg className={`w-5 h-5 ${spinning ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export default function DriverTripsPage() {
  const t = useTranslations();
  const lang = useLang();
  const td = t.driver;
  const [pageState, setPageState] = useState<PageState>({ status: 'loading' });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadTrips = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setIsRefreshing(true);
    else setPageState({ status: 'loading' });

    try {
      const response = await fetch('/api/proxy/v1/driver/trips/today', { cache: 'no-store' });
      if (!response.ok) {
        setPageState({ status: 'error', message: td.trips.errorLoad });
        return;
      }
      const trips = await response.json() as DriverTripSummary[];
      setPageState({ status: 'ready', trips: Array.isArray(trips) ? trips : [] });
    } catch {
      setPageState({ status: 'error', message: t.common.errorNetwork });
    } finally {
      setIsRefreshing(false);
    }
  }, [td, t]);

  useEffect(() => { loadTrips(); }, [loadTrips]);

  const today = new Date().toLocaleDateString(lang === 'mg' ? 'fr-MG' : 'fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const Header = () => (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-10">
      <div>
        <h1 className="text-lg font-bold text-gray-900">{td.trips.title}</h1>
        <p className="text-xs text-gray-500">{today}</p>
      </div>
      <button
        type="button"
        onClick={() => loadTrips(true)}
        disabled={isRefreshing || pageState.status === 'loading'}
        aria-label={td.trips.refresh}
        className={['flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium', 'text-brand border border-brand/30 bg-brand/5', 'hover:bg-brand/10 active:bg-brand/20', 'focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1', 'min-h-[40px] transition-colors duration-150', isRefreshing ? 'opacity-60' : ''].filter(Boolean).join(' ')}
      >
        <IconRefresh spinning={isRefreshing} />
        <span>{isRefreshing ? td.trips.refreshing : td.trips.refresh}</span>
      </button>
    </div>
  );

  if (pageState.status === 'loading') {
    return (
      <div>
        <Header />
        <div className="flex flex-col items-center justify-center py-16 px-4 gap-3">
          <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">{td.trips.loading}</p>
        </div>
      </div>
    );
  }

  if (pageState.status === 'error') {
    return (
      <div>
        <Header />
        <div className="flex flex-col items-center justify-center py-12 px-4 gap-4 text-center">
          <svg className="w-12 h-12 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
          <p className="text-sm text-gray-700 font-medium max-w-xs">{pageState.message}</p>
          <Button variant="primary" size="md" onClick={() => loadTrips()}>{t.common.retry}</Button>
        </div>
      </div>
    );
  }

  const { trips } = pageState;

  if (trips.length === 0) {
    return (
      <div>
        <Header />
        <div className="flex flex-col items-center justify-center py-16 px-4 gap-3 text-center">
          <svg className="w-14 h-14 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <rect x="1" y="3" width="22" height="16" rx="2" />
            <path d="M1 11h22M5 19v2M19 19v2" />
          </svg>
          <p className="text-base font-medium text-gray-500">{td.trips.noTrips}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header />
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
          {trips.length} {td.trips.passengers}
        </p>
      </div>
      <ul className="px-4 py-2 space-y-3" role="list">
        {trips.map((trip) => (
          <li key={trip.tripInstanceId}>
            <TripCardDriver trip={trip} />
          </li>
        ))}
      </ul>
    </div>
  );
}
