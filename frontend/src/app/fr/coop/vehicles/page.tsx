'use client';

/**
 * Gestion des véhicules — /fr/coop/vehicles
 * GET  /v1/coop/vehicles      → liste
 * POST /v1/coop/vehicles      → créer
 * PATCH /v1/coop/vehicles/:id → activer / désactiver
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import type { CoopVehicle } from '@/lib/types';

interface VehicleForm {
  registration: string;
  displayName: string;
  model: string;
  capacity: string;
}

const EMPTY_FORM: VehicleForm = { registration: '', displayName: '', model: '', capacity: '' };

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<CoopVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulaire d'ajout
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
      setError('Erreur réseau. Vérifiez votre connexion et réessayez.');
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError('Impossible de modifier le véhicule. Réessayez.');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cap = parseInt(form.capacity, 10);
    if (!form.registration.trim()) { setFormError('Immatriculation requise.'); return; }
    if (!form.displayName.trim()) { setFormError("Nom d'affichage requis."); return; }
    if (!cap || cap < 1) { setFormError('Capacité invalide.'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/proxy/v1/coop/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registration: form.registration.trim(),
          displayName: form.displayName.trim(),
          model: form.model.trim() || null,
          capacity: cap,
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
      setFormError(err instanceof Error ? err.message : 'Erreur lors de la création.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-brand-dark">Véhicules</h1>
        <Button variant="primary" size="sm" onClick={() => { setShowForm((p) => !p); setFormError(null); }}>
          {showForm ? 'Annuler' : '+ Nouveau véhicule'}
        </Button>
      </div>

      {savedId && (
        <div role="status" className="bg-green-50 border border-green-300 text-green-700 rounded-xl px-4 py-3 text-sm">
          Véhicule créé avec succès.
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Formulaire de création */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white border border-gray-200 rounded-xl p-5 space-y-4"
        >
          <h2 className="font-semibold text-brand-dark">Nouveau véhicule</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Immatriculation"
              value={form.registration}
              onChange={(e) => setForm((p) => ({ ...p, registration: e.target.value }))}
              placeholder="MG-1234-T"
              required
            />
            <Input
              label="Nom d'affichage"
              value={form.displayName}
              onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
              placeholder="Minibus Antananarivo"
              required
            />
            <Input
              label="Modèle (optionnel)"
              value={form.model}
              onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
              placeholder="Toyota Hiace"
            />
            <Input
              label="Capacité (places)"
              type="number"
              min={1}
              max={100}
              value={form.capacity}
              onChange={(e) => setForm((p) => ({ ...p, capacity: e.target.value }))}
              placeholder="15"
              required
            />
          </div>

          {formError && (
            <p role="alert" className="text-red-600 text-sm">{formError}</p>
          )}

          <Button type="submit" variant="action" isLoading={saving}>
            Enregistrer le véhicule
          </Button>
        </form>
      )}

      {/* Liste */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center animate-pulse">
          <p className="text-sm text-gray-400">Chargement...</p>
        </div>
      ) : vehicles.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">Aucun véhicule enregistré.</p>
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
                <p className="text-xs text-gray-400 mt-0.5">{v.capacity} places</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant={v.isActive ? 'success' : 'neutral'}>
                  {v.isActive ? 'Actif' : 'Inactif'}
                </Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleToggleActive(v)}
                >
                  {v.isActive ? 'Désactiver' : 'Réactiver'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
