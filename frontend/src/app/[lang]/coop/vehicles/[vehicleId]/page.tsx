'use client';

/**
 * Détail d'un véhicule — /[lang]/coop/vehicles/{vehicleId}
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCoop } from '../../CoopContext';
import { getTranslations } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { CoopVehicleDetail, SeatCategory } from '@/lib/types';

const CATEGORY_COLORS: Record<SeatCategory, string> = {
  VIP: 'bg-purple-100 border-purple-400 text-purple-800',
  PREMIUM: 'bg-blue-100 border-blue-400 text-blue-800',
  CLASSIC: 'bg-green-100 border-green-400 text-green-800',
  STANDARD: 'bg-gray-100 border-gray-300 text-gray-600',
};

export default function VehicleDetailPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const CATEGORY_LABELS: Record<SeatCategory, string> = {
    VIP: t.tripDetail.category.VIP,
    PREMIUM: t.tripDetail.category.PREMIUM,
    CLASSIC: t.tripDetail.category.CLASSIC,
    STANDARD: t.tripDetail.category.STANDARD,
  };

  const [vehicle, setVehicle] = useState<CoopVehicleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/proxy/v1/coop/vehicles/${vehicleId}`, { cache: 'no-store' });
      if (res.status === 404) { setError(t.coop.vehicles.detail.notFound); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVehicle(await res.json() as CoopVehicleDetail);
    } catch {
      setError(t.coop.vehicles.detail.errorLoad);
    } finally {
      setLoading(false);
    }
  }, [vehicleId, t.coop.vehicles.detail.notFound, t.coop.vehicles.detail.errorLoad]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async () => {
    if (!vehicle) return;
    setToggling(true);
    try {
      const res = await fetch(`/api/proxy/v1/coop/vehicles/${vehicleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !vehicle.isActive }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVehicle((prev) => prev ? { ...prev, isActive: !prev.isActive } : prev);
    } catch {
      setError(t.coop.vehicles.detail.errorToggle);
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-white border border-gray-200 rounded-xl p-8 animate-pulse text-center">
          <p className="text-sm text-gray-400">{t.common.loading}</p>
        </div>
      </div>
    );
  }

  if (error || !vehicle) {
    return (
      <div className="space-y-4">
        <Link href={`/${lang}/coop/vehicles`} className="text-sm text-brand hover:underline">
          {t.coop.vehicles.detail.back}
        </Link>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {error ?? t.coop.vehicles.detail.notFound}
        </div>
      </div>
    );
  }

  const { seatMap } = vehicle;
  const seatByPosition = new Map(
    seatMap.seats
      .filter((s) => s.row !== null && s.column !== null)
      .map((s) => [`${s.row}-${s.column}`, s]),
  );
  const hasGrid = seatMap.seats.some((s) => s.row !== null && s.column !== null);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/${lang}/coop/vehicles`} className="text-sm text-brand hover:underline">
          {t.coop.vehicles.detail.backLabel}
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-bold text-brand-dark">{vehicle.displayName}</h1>
        <Badge variant={vehicle.isActive ? 'success' : 'neutral'}>
          {vehicle.isActive ? t.coop.vehicles.active : t.coop.vehicles.inactive}
        </Badge>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">{t.coop.vehicles.detail.registration}</p>
              <p className="font-mono font-semibold text-brand-dark">{vehicle.registration}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">{t.coop.vehicles.detail.model}</p>
              <p className="text-sm text-gray-700">{vehicle.model ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">{t.coop.vehicles.detail.capacityLabel}</p>
              <p className="text-sm text-gray-700">{vehicle.capacity} {t.coop.vehicles.places}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">{t.coop.vehicles.detail.seatsLabel}</p>
              <p className="text-sm text-gray-700">{seatMap.seats.length} {t.coop.vehicles.seats}</p>
            </div>
          </div>
          <Button
            variant={vehicle.isActive ? 'secondary' : 'primary'}
            size="sm"
            isLoading={toggling}
            onClick={handleToggle}
          >
            {vehicle.isActive ? t.coop.vehicles.deactivate : t.coop.vehicles.reactivate}
          </Button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-brand-dark">{t.coop.vehicles.detail.seatPlan} — {seatMap.name}</h2>
          <span className="text-xs text-gray-400">{seatMap.layout.rows} lignes × {seatMap.layout.cols} colonnes</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(CATEGORY_COLORS) as SeatCategory[]).map((cat) => (
            <span
              key={cat}
              className={`text-xs px-2 py-0.5 rounded border font-medium ${CATEGORY_COLORS[cat]}`}
            >
              {CATEGORY_LABELS[cat]}
            </span>
          ))}
        </div>

        {hasGrid ? (
          <div className="overflow-x-auto">
            <div
              className="inline-grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${seatMap.layout.cols}, minmax(2.5rem, 1fr))` }}
            >
              {Array.from({ length: seatMap.layout.rows }, (_, row) =>
                Array.from({ length: seatMap.layout.cols }, (_, col) => {
                  const seat = seatByPosition.get(`${row}-${col}`);
                  return (
                    <div
                      key={`${row}-${col}`}
                      className={`
                        w-10 h-10 rounded-lg border text-xs font-semibold
                        flex items-center justify-center text-center leading-tight
                        ${seat ? CATEGORY_COLORS[seat.category as SeatCategory] : 'border-transparent bg-transparent'}
                      `}
                      title={seat ? `${seat.code} — ${CATEGORY_LABELS[seat.category as SeatCategory]}` : ''}
                    >
                      {seat ? seat.code : ''}
                    </div>
                  );
                }),
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {seatMap.seats.map((s) => (
              <span
                key={s.id}
                className={`text-xs px-2 py-1 rounded-lg border font-semibold ${CATEGORY_COLORS[s.category as SeatCategory]}`}
                title={CATEGORY_LABELS[s.category as SeatCategory]}
              >
                {s.code}
              </span>
            ))}
          </div>
        )}

        <details className="mt-2">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-brand select-none">
            {t.coop.vehicles.detail.seatList} ({seatMap.seats.length} {t.coop.vehicles.detail.seatListTotal})
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs min-w-[300px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-1.5 px-3 text-left text-gray-500">{t.coop.vehicles.detail.tableCode}</th>
                  <th className="py-1.5 px-3 text-left text-gray-500">{t.coop.vehicles.detail.tableCategory}</th>
                  <th className="py-1.5 px-3 text-left text-gray-500">{t.coop.vehicles.detail.tableRow}</th>
                  <th className="py-1.5 px-3 text-left text-gray-500">{t.coop.vehicles.detail.tableColumn}</th>
                </tr>
              </thead>
              <tbody>
                {seatMap.seats.map((s) => (
                  <tr key={s.id} className="border-b border-gray-100">
                    <td className="py-1.5 px-3 font-mono font-semibold">{s.code}</td>
                    <td className="py-1.5 px-3">
                      <span className={`px-1.5 py-0.5 rounded border text-xs font-medium ${CATEGORY_COLORS[s.category as SeatCategory]}`}>
                        {CATEGORY_LABELS[s.category as SeatCategory]}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-gray-500">{s.row ?? '—'}</td>
                    <td className="py-1.5 px-3 text-gray-500">{s.column ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}
