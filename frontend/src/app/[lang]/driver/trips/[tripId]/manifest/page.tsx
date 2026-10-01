'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import { PassengerRow } from '@/components/driver/PassengerRow';
import { Button } from '@/components/ui/Button';
import { useWebSocket } from '@/lib/ws';
import type { Manifest, ManifestPassenger, BoardingStatus } from '@/lib/types';

type FilterMode = 'ALL' | 'BOARDED' | 'ABSENT';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: Manifest }
  | { status: 'error'; message: string };

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}h${d.getMinutes().toString().padStart(2, '0')}`;
}

const IconChevronLeft = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const IconRefresh = ({ spinning }: { spinning: boolean }) => (
  <svg className={`w-5 h-5 ${spinning ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

function filterPassengers(passengers: ManifestPassenger[], filter: FilterMode): ManifestPassenger[] {
  if (filter === 'ALL') return passengers;
  const statusMap: Record<FilterMode, BoardingStatus | null> = { ALL: null, BOARDED: 'BOARDED', ABSENT: 'ABSENT' };
  const target = statusMap[filter];
  if (!target) return passengers;
  return passengers.filter((p) => p.boardingStatus === target);
}

export default function ManifestPage() {
  const params = useParams();
  const t = useTranslations();
  const lang = useLang();
  const td = t.driver;
  const tripId = params.tripId as string;

  const [pageState, setPageState] = useState<PageState>({ status: 'loading' });
  const [filter, setFilter] = useState<FilterMode>('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [wsTicket, setWsTicket] = useState<string | null>(null);
  const [markingAbsentIds, setMarkingAbsentIds] = useState<Set<string>>(new Set());
  const [absentErrors, setAbsentErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchTicket = async () => {
      try {
        const res = await fetch('/api/proxy/v1/realtime/ws-endpoint', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json() as { wsUrl?: string; ticket?: string };
          if (data.ticket) setWsTicket(data.ticket);
        }
      } catch { /* WS non critique */ }
    };
    fetchTicket();
  }, []);

  const { lastEvent, isReconnecting } = useWebSocket(`driver:${tripId}`, wsTicket);

  const loadManifest = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setIsRefreshing(true);
    else setPageState({ status: 'loading' });
    try {
      const response = await fetch(`/api/proxy/v1/driver/trips/${tripId}/manifest`, { cache: 'no-store' });
      if (!response.ok) {
        setPageState({ status: 'error', message: td.manifest.errorLoad });
        return;
      }
      setPageState({ status: 'ready', manifest: await response.json() as Manifest });
    } catch {
      setPageState({ status: 'error', message: t.common.errorNetwork });
    } finally {
      setIsRefreshing(false);
    }
  }, [tripId, td, t]);

  useEffect(() => { loadManifest(); }, [loadManifest]);

  const markAbsent = useCallback(async (bookingId: string) => {
    setMarkingAbsentIds((prev) => new Set(prev).add(bookingId));
    setAbsentErrors((prev) => { const n = { ...prev }; delete n[bookingId]; return n; });
    try {
      const res = await fetch(`/api/proxy/v1/driver/trips/${tripId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
        cache: 'no-store',
      });
      if (res.ok) {
        loadManifest(true);
      } else {
        let msg = t.common.errorNetwork;
        try {
          const body = await res.json() as { code?: string; message?: string };
          if (body.code === 'NO_SHOW_BEFORE_DEPARTURE') msg = td.departure.errorMessage;
          else if (body.message) msg = body.message;
        } catch { /* ignorer */ }
        setAbsentErrors((prev) => ({ ...prev, [bookingId]: msg }));
      }
    } catch {
      setAbsentErrors((prev) => ({ ...prev, [bookingId]: t.common.errorNetwork }));
    } finally {
      setMarkingAbsentIds((prev) => { const n = new Set(prev); n.delete(bookingId); return n; });
    }
  }, [tripId, loadManifest, td, t]);

  useEffect(() => {
    if (!lastEvent) return;
    if (['BOARDING_CONFIRMED', 'PASSENGER_BOARDED', 'PASSENGER_ABSENT'].includes(lastEvent.event)) {
      loadManifest(true);
    }
  }, [lastEvent, loadManifest]);

  const filteredPassengers = useMemo(() => {
    if (pageState.status !== 'ready') return [];
    return filterPassengers(pageState.manifest.passengers, filter);
  }, [pageState, filter]);

  const counts = useMemo(() => {
    if (pageState.status !== 'ready') return null;
    const { manifest } = pageState;
    const { passengers } = manifest;
    return {
      total: manifest.totalPassengers ?? passengers.length,
      boarded: manifest.boarded ?? passengers.filter((p) => p.boardingStatus === 'BOARDED').length,
      absent: manifest.absent ?? passengers.filter((p) => p.boardingStatus === 'ABSENT').length,
      pending: manifest.pending ?? passengers.filter((p) => p.boardingStatus === 'NOT_BOARDED').length,
    };
  }, [pageState]);

  const FILTERS: Array<{ mode: FilterMode; label: string }> = [
    { mode: 'ALL', label: td.manifest.filterAll },
    { mode: 'BOARDED', label: td.manifest.filterBoarded },
    { mode: 'ABSENT', label: td.manifest.filterAbsent },
  ];

  if (pageState.status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">{td.manifest.loading}</p>
      </div>
    );
  }

  if (pageState.status === 'error') {
    return (
      <div>
        <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-100">
          <Link href={`/${lang}/driver/trips/${tripId}`} className="flex items-center justify-center w-10 h-10 -ml-2 rounded-lg text-gray-600 hover:bg-gray-100" aria-label={t.common.back}>
            <IconChevronLeft />
          </Link>
          <h1 className="text-base font-bold text-gray-900">{td.manifest.title}</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-12 px-4 gap-4 text-center">
          <svg className="w-12 h-12 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm text-gray-700 font-medium max-w-xs">{pageState.message}</p>
          <Button variant="primary" size="md" onClick={() => loadManifest()}>{t.common.retry}</Button>
        </div>
      </div>
    );
  }

  const { manifest } = pageState;

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-10">
        <Link href={`/${lang}/driver/trips/${tripId}`} className="flex items-center justify-center w-10 h-10 -ml-2 rounded-lg text-gray-600 hover:bg-gray-100" aria-label={t.common.back}>
          <IconChevronLeft />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-900">{td.manifest.title}</h1>
          {counts && (
            <p className="text-xs text-gray-500">
              {counts.boarded} {td.manifest.filterBoarded.toLowerCase()} / {counts.total} {td.trips.passengers}
            </p>
          )}
        </div>
        <button type="button" onClick={() => loadManifest(true)} disabled={isRefreshing} aria-label={td.manifest.refresh}
          className={['flex items-center justify-center w-10 h-10 rounded-lg', 'text-brand hover:bg-brand/10 active:bg-brand/20', 'focus:outline-none focus:ring-2 focus:ring-brand', isRefreshing ? 'opacity-60' : ''].filter(Boolean).join(' ')}>
          <IconRefresh spinning={isRefreshing} />
        </button>
      </div>

      {manifest.departureAt && (
        <div className="px-4 py-2 bg-brand-dark/5 border-b border-gray-100">
          <p className="text-xs text-gray-600">
            {td.tripDetail.departure}{' '}
            <span className="font-semibold text-brand">{formatTime(manifest.departureAt)}</span>
          </p>
        </div>
      )}

      {counts && (
        <div className="grid grid-cols-3 border-b border-gray-100 bg-white">
          <div className="flex flex-col items-center py-3 border-r border-gray-100">
            <span className="text-xl font-bold text-gray-900">{counts.boarded}</span>
            <span className="text-xs text-green-600 font-medium">{td.manifest.boardingStatuses.BOARDED}</span>
          </div>
          <div className="flex flex-col items-center py-3 border-r border-gray-100">
            <span className="text-xl font-bold text-gray-900">{counts.pending}</span>
            <span className="text-xs text-gray-500 font-medium">{td.manifest.boardingStatuses.NOT_BOARDED}</span>
          </div>
          <div className="flex flex-col items-center py-3">
            <span className="text-xl font-bold text-gray-900">{counts.absent}</span>
            <span className="text-xs text-red-600 font-medium">{td.manifest.boardingStatuses.ABSENT}</span>
          </div>
        </div>
      )}

      {isReconnecting && (
        <div className="px-4 py-2 bg-yellow-50 border-b border-yellow-200 flex items-center gap-2" role="alert" aria-live="polite">
          <div className="w-3 h-3 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="text-xs text-yellow-800 font-medium">{t.common.loading}</p>
        </div>
      )}

      <div className="flex gap-2 px-4 py-3 bg-white border-b border-gray-100 sticky top-[57px] z-10" role="group" aria-label={td.manifest.title}>
        {FILTERS.map(({ mode, label }) => (
          <button key={mode} type="button" onClick={() => setFilter(mode)} aria-pressed={filter === mode}
            className={['flex-1 py-2 rounded-lg text-sm font-medium', 'min-h-[40px] transition-colors duration-150', 'focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1', filter === mode ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'].filter(Boolean).join(' ')}>
            {label}
            {mode !== 'ALL' && counts && (
              <span className={`ml-1 text-xs ${filter === mode ? 'text-white/80' : 'text-gray-400'}`}>
                ({mode === 'BOARDED' ? counts.boarded : counts.absent})
              </span>
            )}
          </button>
        ))}
      </div>

      {filteredPassengers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
          <svg className="w-10 h-10 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <p className="text-sm text-gray-500">
            {filter === 'ALL' ? td.manifest.noPassengers : td.manifest.noPassengersFiltered}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 px-4 bg-white" role="list" aria-label={td.manifest.title}>
          {filteredPassengers.map((passenger) => (
            <Fragment key={passenger.bookingId}>
              <PassengerRow passenger={passenger} onMarkAbsent={() => markAbsent(passenger.bookingId)} markingAbsent={markingAbsentIds.has(passenger.bookingId)} />
              {absentErrors[passenger.bookingId] && (
                <li className="px-1 pb-2 text-xs text-red-600" role="alert">{absentErrors[passenger.bookingId]}</li>
              )}
            </Fragment>
          ))}
        </ul>
      )}

      {filteredPassengers.length > 0 && (
        <p className="px-4 py-3 text-xs text-center text-gray-400">
          {filteredPassengers.length} {td.trips.passengers}
        </p>
      )}
    </div>
  );
}
