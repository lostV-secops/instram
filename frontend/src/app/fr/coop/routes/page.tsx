'use client';

/**
 * Gestion des lignes (routes) — /fr/coop/routes
 * GET /coop/routes
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { CoopRouteDetail } from '@/lib/types';

export default function RoutesPage() {
  const [routes, setRoutes] = useState<CoopRouteDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/v1/coop/routes', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRoutes(Array.isArray(data) ? data : []);
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion et réessayez.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-brand-dark">Lignes</h1>
        <Link href="/fr/coop/routes/new">
          <Button variant="primary" size="sm">+ Nouvelle ligne</Button>
        </Link>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 animate-pulse text-center">
          <p className="text-sm text-gray-400">Chargement...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {error}
          <button type="button" onClick={load} className="block underline mt-1">Réessayer</button>
        </div>
      ) : routes.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-500">
          Aucune ligne configurée.{' '}
          <Link href="/fr/coop/routes/new" className="text-brand underline">Créer la première ligne</Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Départ</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Arrivée</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Durée</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
                  <th className="py-2 px-4" />
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-sm font-medium text-gray-900">{r.displayName}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {r.originCity?.name ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {r.destinationCity?.name ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-500 tabular-nums">
                      {r.estimatedDurationMin ? `${r.estimatedDurationMin} min` : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={r.isActive ? 'success' : 'neutral'}>
                        {r.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/fr/coop/trips?routeId=${r.id}`}
                        className="text-sm text-brand hover:underline"
                      >
                        Trajets
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
