'use client';

/**
 * Page Exports — /[lang]/coop/exports
 */

import { useState, useEffect } from 'react';
import { useCoop } from '../CoopContext';
import { getTranslations } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ExportCard } from '@/components/coop/ExportCard';
import type { ExportJob, TripInstance, TripInstanceList } from '@/lib/types';

function ManifestModal({
  trips,
  onClose,
  onSubmit,
  submitting,
  error,
  t,
}: {
  trips: TripInstance[];
  onClose: () => void;
  onSubmit: (tripId: string, format: string) => Promise<void>;
  submitting: boolean;
  error: string | null;
  t: ReturnType<typeof getTranslations>;
}) {
  const [tripId, setTripId] = useState('');
  const [format, setFormat] = useState('PDF');

  function formatDt(iso: string) {
    try { return new Date(iso).toLocaleString('fr-MG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" aria-modal="true" role="dialog">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h2 className="text-lg font-bold text-brand-dark">{t.coop.exports.manifest.title}</h2>

        <div className="flex flex-col gap-1">
          <label htmlFor="manifest-trip" className="text-sm font-medium text-gray-800">
            {t.coop.trips.title} <span className="text-red-500">*</span>
          </label>
          <select
            id="manifest-trip"
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">{t.coop.exports.manifest.selectTrip}...</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.route ? `${trip.route.originCity?.nameFr ?? '?'} → ${trip.route.destinationCity?.nameFr ?? '?'}` : trip.routeId} — {formatDt(trip.departureAt)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="manifest-format" className="text-sm font-medium text-gray-800">{t.coop.exports.manifest.format}</label>
          <select
            id="manifest-format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="PDF">PDF</option>
            <option value="CSV">CSV</option>
          </select>
        </div>

        {error && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>
        )}

        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>{t.common.cancel}</Button>
          <Button
            variant="action"
            size="sm"
            isLoading={submitting}
            onClick={() => tripId && onSubmit(tripId, format)}
            disabled={!tripId || submitting}
          >
            {t.coop.exports.manifest.submit}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReportModal({
  onClose,
  onSubmit,
  submitting,
  error,
  t,
}: {
  onClose: () => void;
  onSubmit: (from: string, to: string, format: string) => Promise<void>;
  submitting: boolean;
  error: string | null;
  t: ReturnType<typeof getTranslations>;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [format, setFormat] = useState('XLSX');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" aria-modal="true" role="dialog">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h2 className="text-lg font-bold text-brand-dark">{t.coop.exports.report.title}</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="report-from" className="text-sm font-medium text-gray-800">{t.coop.exports.report.dateFrom} <span className="text-red-500">*</span></label>
            <input
              id="report-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="report-to" className="text-sm font-medium text-gray-800">{t.coop.exports.report.dateTo} <span className="text-red-500">*</span></label>
            <input
              id="report-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="report-format" className="text-sm font-medium text-gray-800">{t.coop.exports.report.format}</label>
          <select
            id="report-format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="XLSX">Excel (XLSX)</option>
            <option value="CSV">CSV</option>
          </select>
        </div>

        {error && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>
        )}

        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>{t.common.cancel}</Button>
          <Button
            variant="action"
            size="sm"
            isLoading={submitting}
            onClick={() => from && to && onSubmit(from, to, format)}
            disabled={!from || !to || submitting}
          >
            {t.coop.exports.report.submit}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ExportsPage() {
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [exports, setExports] = useState<ExportJob[]>([]);
  const [trips, setTrips] = useState<TripInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showManifest, setShowManifest] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadExports = async () => {
    try {
      const res = await fetch('/api/proxy/v1/coop/exports', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setExports(Array.isArray(data) ? data : []);
    } catch {
      setError(t.common.errorNetwork);
    } finally {
      setLoading(false);
    }
  };

  const loadTrips = async () => {
    try {
      const from = new Date().toISOString().slice(0, 10);
      const toDate = new Date(); toDate.setDate(toDate.getDate() + 30);
      const to = toDate.toISOString().slice(0, 10);
      const res = await fetch(`/api/proxy/v1/coop/trips?from=${from}&to=${to}&limit=100`, { cache: 'no-store' });
      if (!res.ok) return;
      const data: TripInstanceList = await res.json();
      setTrips(data.items ?? []);
    } catch { /* silencieux */ }
  };

  useEffect(() => {
    loadExports();
    loadTrips();
  }, []);

  const submitManifest = async (tripId: string, format: string) => {
    setModalSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch('/api/proxy/v1/coop/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'MANIFEST', format, filters: { tripInstanceId: tripId } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Erreur ${res.status}`);
      const job: ExportJob = await res.json();
      setExports((prev) => [job, ...prev]);
      setShowManifest(false);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : t.common.errorNetwork);
    } finally {
      setModalSubmitting(false);
    }
  };

  const submitReport = async (from: string, to: string, format: string) => {
    setModalSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch('/api/proxy/v1/coop/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'FINANCIAL_REPORT', format, filters: { from, to } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Erreur ${res.status}`);
      const job: ExportJob = await res.json();
      setExports((prev) => [job, ...prev]);
      setShowReport(false);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : t.common.errorNetwork);
    } finally {
      setModalSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-brand-dark">{t.coop.exports.title}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => { setShowManifest(true); setModalError(null); }}>
            {t.coop.exports.newManifest}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { setShowReport(true); setModalError(null); }}>
            {t.coop.exports.newReport}
          </Button>
        </div>
      </div>

      <p className="text-xs text-gray-500">{t.coop.exports.pollNote}</p>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {error}
          <button type="button" onClick={loadExports} className="block underline mt-1">{t.common.retry}</button>
        </div>
      ) : exports.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-500">
          {t.coop.exports.noExports}
        </div>
      ) : (
        <div className="space-y-3">
          {exports.map((job) => (
            <ExportCard key={job.id} initialJob={job} />
          ))}
        </div>
      )}

      {showManifest && (
        <ManifestModal
          trips={trips}
          onClose={() => setShowManifest(false)}
          onSubmit={submitManifest}
          submitting={modalSubmitting}
          error={modalError}
          t={t}
        />
      )}

      {showReport && (
        <ReportModal
          onClose={() => setShowReport(false)}
          onSubmit={submitReport}
          submitting={modalSubmitting}
          error={modalError}
          t={t}
        />
      )}
    </div>
  );
}
