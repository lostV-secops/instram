'use client';

/**
 * Gestion des lignes — /[lang]/coop/routes
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useCoop } from '../CoopContext';
import { getTranslations } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import type { CoopRouteDetail } from '@/lib/types';

interface EditForm {
  displayName: string;
  distanceKm: string;
  estimatedDurationMin: string;
}

export default function RoutesPage() {
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [routes, setRoutes] = useState<CoopRouteDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'inactive'>('active');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ displayName: '', distanceKm: '', estimatedDurationMin: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/v1/coop/routes', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRoutes(Array.isArray(data) ? data : []);
    } catch {
      setError(t.common.errorNetwork);
    } finally {
      setLoading(false);
    }
  }, [t.common.errorNetwork]);

  const handleToggle = async (route: CoopRouteDetail) => {
    try {
      const res = await fetch(`/api/proxy/v1/coop/routes/${route.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !route.isActive }),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError(t.common.errorNetwork);
    }
  };

  const handleEditSave = async (routeId: string) => {
    if (!editForm.displayName.trim()) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const body: Record<string, unknown> = { displayName: editForm.displayName.trim() };
      const dist = parseInt(editForm.distanceKm, 10);
      const dur = parseInt(editForm.estimatedDurationMin, 10);
      if (!isNaN(dist) && dist > 0) body.distanceKm = dist;
      if (!isNaN(dur) && dur > 0) body.estimatedDurationMin = dur;

      const res = await fetch(`/api/proxy/v1/coop/routes/${routeId}`, {
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

  const handleDelete = async (routeId: string) => {
    setDeletingId(routeId);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/proxy/v1/coop/routes/${routeId}`, { method: 'DELETE' });
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

  useEffect(() => { load(); }, [load]);

  const displayed = routes.filter((r) => filter === 'active' ? r.isActive : !r.isActive);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-brand-dark">{t.coop.routes.title}</h1>
        <Link href={`/${lang}/coop/routes/new`}>
          <Button variant="primary" size="sm">+ {t.coop.routes.newRoute}</Button>
        </Link>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setFilter('active')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === 'active' ? 'bg-brand-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          Actives ({routes.filter((r) => r.isActive).length})
        </button>
        <button
          onClick={() => setFilter('inactive')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === 'inactive' ? 'bg-brand-dark text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          Inactives ({routes.filter((r) => !r.isActive).length})
        </button>
      </div>

      {deleteError && (
        <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-3 text-sm">
          {deleteError}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 animate-pulse text-center">
          <p className="text-sm text-gray-400">{t.common.loading}</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {error}
          <button type="button" onClick={load} className="block underline mt-1">{t.common.retry}</button>
        </div>
      ) : displayed.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-500">
          {filter === 'active' ? (
            <>
              {t.coop.routes.noRoutes}{' '}
              <Link href={`/${lang}/coop/routes/new`} className="text-brand underline">{t.coop.routes.new.title}</Link>
            </>
          ) : 'Aucune ligne inactive.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.members.name}</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.routes.origin}</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.routes.destination}</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.routes.duration}</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">{t.coop.trips.status}</th>
                  <th className="py-2 px-4" />
                </tr>
              </thead>
              <tbody>
                {displayed.map((r) => (
                  <>
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">{r.displayName}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{r.originCity?.name ?? '—'}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{r.destinationCity?.name ?? '—'}</td>
                      <td className="py-3 px-4 text-sm text-gray-500 tabular-nums">
                        {r.estimatedDurationMin ? `${r.estimatedDurationMin} ${t.coop.routes.min}` : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={r.isActive ? 'success' : 'neutral'}>
                          {r.isActive ? t.coop.routes.active : t.coop.routes.inactive}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {filter === 'active' && (
                            <Link
                              href={`/${lang}/coop/trips?routeId=${r.id}`}
                              className="text-sm text-brand hover:underline whitespace-nowrap"
                            >
                              {t.coop.trips.title}
                            </Link>
                          )}
                          {filter === 'inactive' && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setEditingId(editingId === r.id ? null : r.id);
                                  setEditForm({
                                    displayName: r.displayName ?? '',
                                    distanceKm: r.distanceKm ? String(r.distanceKm) : '',
                                    estimatedDurationMin: r.estimatedDurationMin ? String(r.estimatedDurationMin) : '',
                                  });
                                  setEditError(null);
                                }}
                              >
                                {editingId === r.id ? 'Annuler' : 'Modifier'}
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                isLoading={deletingId === r.id}
                                onClick={() => handleDelete(r.id)}
                                className="text-red-600 border-red-200 hover:bg-red-50"
                              >
                                Supprimer
                              </Button>
                            </>
                          )}
                          <Button variant="secondary" size="sm" onClick={() => handleToggle(r)}>
                            {r.isActive ? t.coop.vehicles.deactivate : t.coop.vehicles.reactivate}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {editingId === r.id && (
                      <tr key={`${r.id}-edit`} className="bg-blue-50 border-b border-blue-100">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Input
                              label="Nom de la ligne"
                              value={editForm.displayName}
                              onChange={(e) => setEditForm((p) => ({ ...p, displayName: e.target.value }))}
                              required
                            />
                            <Input
                              label="Distance (km)"
                              type="number"
                              min={1}
                              value={editForm.distanceKm}
                              onChange={(e) => setEditForm((p) => ({ ...p, distanceKm: e.target.value }))}
                            />
                            <Input
                              label="Durée estimée (min)"
                              type="number"
                              min={1}
                              value={editForm.estimatedDurationMin}
                              onChange={(e) => setEditForm((p) => ({ ...p, estimatedDurationMin: e.target.value }))}
                            />
                          </div>
                          {editError && <p className="text-red-600 text-xs mt-2">{editError}</p>}
                          <div className="flex gap-2 mt-3">
                            <Button variant="action" size="sm" isLoading={editSaving} onClick={() => handleEditSave(r.id)}>
                              Enregistrer
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>
                              Annuler
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
