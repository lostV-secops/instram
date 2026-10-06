'use client';

/**
 * Gestion des véhicules — /[lang]/coop/vehicles
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useCoop } from '../CoopContext';
import { getTranslations } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import type { CoopVehicle } from '@/lib/types';

interface VehicleForm {
  registration: string;
  displayName: string;
  model: string;
  capacity: string;
  columns: string;
}

const EMPTY_FORM: VehicleForm = { registration: '', displayName: '', model: '', capacity: '', columns: '2' };

export default function VehiclesPage() {
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [vehicles, setVehicles] = useState<CoopVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/v1/coop/vehicles', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVehicles(Array.isArray(data) ? data : (data.items ?? []));
    } catch {
      setError(t.coop.vehicles.errorLoad);
    } finally {
      setLoading(false);
    }
  }, [t.coop.vehicles.errorLoad]);

  useEffect(() => { load(); }, [load]);

  const handleToggleActive = async (vehicle: CoopVehicle) => {
    try {
      const res = await fetch(`/api/proxy/v1/coop/vehicles/${vehicle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !vehicle.isActive }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch {
      setError(t.coop.vehicles.errorToggle);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cap = parseInt(form.capacity, 10);
    if (!form.registration.trim()) { setFormError(t.coop.vehicles.validation.registration); return; }
    if (!form.displayName.trim()) { setFormError(t.coop.vehicles.validation.displayName); return; }
    if (!cap || cap < 1) { setFormError(t.coop.vehicles.validation.capacity); return; }

    const cols = parseInt(form.columns, 10) || 2;
    const rows = Math.ceil(cap / cols);
    const colLetters = ['A', 'B'];
    const defaultSeats: { code: string; row: number; col: number; category: 'STANDARD' }[] = [];
    for (let r = 0; r < rows && defaultSeats.length < cap; r++) {
      for (let c = 0; c < cols && defaultSeats.length < cap; c++) {
        defaultSeats.push({ code: `${r + 1}${colLetters[c]}`, row: r, col: c, category: 'STANDARD' });
      }
    }

    setSaving(true);
    try {
      const res = await fetch('/api/proxy/v1/coop/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.displayName.trim(),
          licensePlate: form.registration.trim(),
          model: form.model.trim() || undefined,
          capacity: cap,
          seatMap: { rows, cols, seats: defaultSeats },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `Erreur ${res.status}`);
      }
      const created = await res.json() as CoopVehicle;
      setSavedId(created.id);
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t.coop.vehicles.errorCreate);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-brand-dark">{t.coop.vehicles.title}</h1>
        <Button variant="primary" size="sm" onClick={() => { setShowForm((p) => !p); setFormError(null); }}>
          {showForm ? t.coop.vehicles.cancel : t.coop.vehicles.newVehicle}
        </Button>
      </div>

      {savedId && (
        <div role="status" className="bg-green-50 border border-green-300 text-green-700 rounded-xl px-4 py-3 text-sm">
          {t.coop.vehicles.created}
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white border border-gray-200 rounded-xl p-5 space-y-4"
        >
          <h2 className="font-semibold text-brand-dark">{t.coop.vehicles.form.title}</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t.coop.vehicles.form.registration}
              value={form.registration}
              onChange={(e) => setForm((p) => ({ ...p, registration: e.target.value }))}
              placeholder="MG-1234-T"
              required
            />
            <Input
              label={t.coop.vehicles.form.displayName}
              value={form.displayName}
              onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
              placeholder="Minibus Antananarivo"
              required
            />
            <Input
              label={t.coop.vehicles.form.model}
              value={form.model}
              onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
              placeholder="Toyota Hiace"
            />
            <Input
              label={t.coop.vehicles.form.capacity}
              type="number"
              min={1}
              max={100}
              value={form.capacity}
              onChange={(e) => setForm((p) => ({ ...p, capacity: e.target.value }))}
              placeholder="15"
              required
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Disposition des sièges</label>
              <select
                value={form.columns}
                onChange={(e) => setForm((p) => ({ ...p, columns: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              >
                <option value="2">2 colonnes — Minibus (Hiace, Crafter…)</option>
                <option value="4">4 colonnes — Grand bus (2+2)</option>
              </select>
              <p className="text-xs text-gray-400">Les catégories de sièges (VIP, Premium…) se configurent sur la page du véhicule.</p>
            </div>
          </div>

          {formError && (
            <p role="alert" className="text-red-600 text-sm">{formError}</p>
          )}

          <Button type="submit" variant="action" isLoading={saving}>
            {t.coop.vehicles.form.submit}
          </Button>
        </form>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center animate-pulse">
          <p className="text-sm text-gray-400">{t.coop.vehicles.loading}</p>
        </div>
      ) : vehicles.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">{t.coop.vehicles.empty}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {vehicles.map((v) => (
            <div
              key={v.id}
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="font-medium text-brand-dark truncate">{v.displayName}</p>
                <p className="text-sm text-gray-500 font-mono">{v.registration}</p>
                {v.model && <p className="text-xs text-gray-400">{v.model}</p>}
                <p className="text-xs text-gray-400 mt-0.5">{v.capacity} {t.coop.vehicles.places}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant={v.isActive ? 'success' : 'neutral'}>
                  {v.isActive ? t.coop.vehicles.active : t.coop.vehicles.inactive}
                </Badge>
                <Link href={`/${lang}/coop/vehicles/${v.id}`}>
                  <Button variant="secondary" size="sm">{t.coop.vehicles.see}</Button>
                </Link>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleToggleActive(v)}
                >
                  {v.isActive ? t.coop.vehicles.deactivate : t.coop.vehicles.reactivate}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
