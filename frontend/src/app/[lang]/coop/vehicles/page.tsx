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

type VehicleType = 'STANDARD' | 'PREMIUM' | 'VIP';

const VEHICLE_PRESETS: Record<VehicleType, { cols: number; rows: number; category: string; label: string; desc: string }> = {
  STANDARD: { cols: 4, rows: 4, category: 'STANDARD', label: 'Standard',  desc: '4 × 4 — 16 places, bus classique' },
  PREMIUM:  { cols: 3, rows: 4, category: 'PREMIUM',  label: 'Premium',   desc: '3 × 4 — 12 places, confort amélioré' },
  VIP:      { cols: 3, rows: 3, category: 'VIP',      label: 'VIP',       desc: '3 × 3 — 9 places, grande aisance' },
};

interface VehicleForm {
  registration: string;
  displayName: string;
  model: string;
  capacity: string;
  vehicleType: VehicleType;
}

interface EditForm {
  displayName: string;
  registration: string;
  model: string;
}

const EMPTY_FORM: VehicleForm = { registration: '', displayName: '', model: '', capacity: '16', vehicleType: 'STANDARD' };

export default function VehiclesPage() {
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [vehicles, setVehicles] = useState<CoopVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'inactive'>('active');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ displayName: '', registration: '', model: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const openEdit = (v: CoopVehicle) => {
    setEditingId(v.id);
    setEditForm({
      displayName: v.displayName ?? '',
      registration: v.registration ?? '',
      model: v.model ?? '',
    });
    setEditError(null);
  };

  const handleEditSave = async (vehicleId: string) => {
    if (!editForm.displayName.trim() || !editForm.registration.trim()) {
      setEditError('Le nom et l\'immatriculation sont obligatoires');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const body: Record<string, unknown> = {
        displayName: editForm.displayName.trim(),
        registration: editForm.registration.trim(),
      };
      if (editForm.model.trim()) body.model = editForm.model.trim();

      const res = await fetch(`/api/proxy/v1/coop/vehicles/${vehicleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { message?: string }).message ?? `Erreur ${res.status}`);
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Erreur lors de la modification');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (vehicleId: string) => {
    setDeletingId(vehicleId);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/proxy/v1/coop/vehicles/${vehicleId}`, { method: 'DELETE' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { message?: string }).message ?? `Erreur ${res.status}`);
      }
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Suppression impossible');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cap = parseInt(form.capacity, 10);
    if (!form.registration.trim()) { setFormError(t.coop.vehicles.validation.registration); return; }
    if (!form.displayName.trim()) { setFormError(t.coop.vehicles.validation.displayName); return; }
    if (!cap || cap < 1) { setFormError(t.coop.vehicles.validation.capacity); return; }

    const preset = VEHICLE_PRESETS[form.vehicleType];
    const cols = preset.cols;
    const rows = Math.ceil(cap / cols);
    const colLetters = ['A', 'B', 'C', 'D'];
    const defaultSeats: { code: string; row: number; col: number; category: string }[] = [];
    for (let r = 0; r < rows && defaultSeats.length < cap; r++) {
      for (let c = 0; c < cols && defaultSeats.length < cap; c++) {
        defaultSeats.push({ code: `${r + 1}${colLetters[c]}`, row: r, col: c, category: preset.category });
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

  const displayed = vehicles.filter((v) => filter === 'active' ? v.isActive : !v.isActive);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-brand-dark">{t.coop.vehicles.title}</h1>
        <Button variant="primary" size="sm" onClick={() => { setShowForm((p) => !p); setFormError(null); }}>
          {showForm ? t.coop.vehicles.cancel : t.coop.vehicles.newVehicle}
        </Button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setFilter('active')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === 'active' ? 'bg-brand-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          Actifs ({vehicles.filter((v) => v.isActive).length})
        </button>
        <button
          onClick={() => setFilter('inactive')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === 'inactive' ? 'bg-brand-dark text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          Inactifs ({vehicles.filter((v) => !v.isActive).length})
        </button>
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

      {deleteError && (
        <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-3 text-sm">
          {deleteError}
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
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-sm font-medium text-gray-700">Type de véhicule</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(Object.entries(VEHICLE_PRESETS) as [VehicleType, typeof VEHICLE_PRESETS[VehicleType]][]).map(([key, p]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, vehicleType: key, capacity: String(p.cols * p.rows) }))}
                    className={`text-left border rounded-xl px-4 py-3 transition-all ${
                      form.vehicleType === key
                        ? 'border-brand-blue bg-blue-50 ring-2 ring-brand-blue'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-semibold text-brand-dark text-sm">{p.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <Input
              label="Capacité (places)"
              type="number"
              min={1}
              max={100}
              value={form.capacity}
              onChange={(e) => setForm((p) => ({ ...p, capacity: e.target.value }))}
              placeholder="16"
              required
            />
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
      ) : displayed.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">
            {filter === 'active' ? 'Aucun véhicule actif.' : 'Aucun véhicule inactif.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((v) => (
            <div key={v.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Ligne principale */}
              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-brand-dark truncate">{v.displayName}</p>
                  <p className="text-sm text-gray-500 font-mono">{v.registration}</p>
                  {v.model && <p className="text-xs text-gray-400">{v.model}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">{v.capacity} {t.coop.vehicles.places}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                  <Badge variant={v.isActive ? 'success' : 'neutral'}>
                    {v.isActive ? t.coop.vehicles.active : t.coop.vehicles.inactive}
                  </Badge>
                  <Link href={`/${lang}/coop/vehicles/${v.id}`}>
                    <Button variant="secondary" size="sm">{t.coop.vehicles.see}</Button>
                  </Link>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => editingId === v.id ? setEditingId(null) : openEdit(v)}
                  >
                    {editingId === v.id ? 'Fermer' : 'Modifier'}
                  </Button>
                  {filter === 'inactive' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      isLoading={deletingId === v.id}
                      onClick={() => handleDelete(v.id)}
                      className="text-red-600 border-red-200 hover:bg-red-50"
                    >
                      Supprimer
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => handleToggleActive(v)}>
                    {v.isActive ? t.coop.vehicles.deactivate : t.coop.vehicles.reactivate}
                  </Button>
                </div>
              </div>

              {/* Formulaire d'édition inline */}
              {editingId === v.id && (
                <div className="border-t border-gray-100 bg-blue-50 px-4 py-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Input
                      label="Nom d'affichage"
                      value={editForm.displayName}
                      onChange={(e) => setEditForm((p) => ({ ...p, displayName: e.target.value }))}
                      required
                    />
                    <Input
                      label="Immatriculation"
                      value={editForm.registration}
                      onChange={(e) => setEditForm((p) => ({ ...p, registration: e.target.value }))}
                      required
                    />
                    <Input
                      label="Modèle"
                      value={editForm.model}
                      onChange={(e) => setEditForm((p) => ({ ...p, model: e.target.value }))}
                      placeholder="Toyota Hiace"
                    />
                  </div>
                  {editError && <p className="text-red-600 text-xs">{editError}</p>}
                  <div className="flex gap-2">
                    <Button variant="action" size="sm" isLoading={editSaving} onClick={() => handleEditSave(v.id)}>
                      Enregistrer
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>
                      Annuler
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
