'use client';

/**
 * Gestion des tarifs — /fr/coop/fares
 *
 * Affiche la liste des trajets ouverts avec leurs tarifs configurés.
 * Permet d'accéder à l'éditeur de tarifs pour chaque trajet.
 *
 * RÈGLE RG-04 : la coopérative fixe librement ses tarifs.
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { TripInstance, TripInstanceList } from '@/lib/types';

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-MG', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function FaresPage() {
  const [trips, setTrips] = useState<TripInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // Charger les trajets des 7 prochains jours
      const from = new Date().toISOString().slice(0, 10);
      const toDate = new Date();
      toDate.setDate(toDate.getDate() + 7);
      const to = toDate.toISOString().slice(0, 10);
      const res = await fetch(
        `/api/proxy/v1/coop/trips?from=${from}&to=${to}&limit=50`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error();
      const data: TripInstanceList = await res.json();
      setTrips(data.items ?? []);
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion et réessayez.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Tarifs</h1>
        <p className="text-sm text-gray-500 mt-1">Sélectionnez un trajet pour modifier ses tarifs.</p>
      </div>

      {/* Bandeau RG-04 */}
      <div className="bg-brand/5 border border-brand/20 rounded-lg px-4 py-3 text-sm text-brand-dark">
        La coopérative fixe librement ses tarifs (RG-04). Aucune validation InsTRAM n'est appliquée.
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 animate-pulse text-center">
          <p className="text-sm text-gray-400">Chargement des trajets...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {error}
          <button type="button" onClick={load} className="block underline mt-1">Réessayer</button>
        </div>
      ) : trips.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-500">
          Aucun trajet prévu dans les 7 prochains jours.{' '}
          <Link href="/fr/coop/trips/new" className="text-brand underline">Créer un trajet</Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[400px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Ligne</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Départ</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-sm font-medium text-gray-900">{t.routeId}</td>
                    <td className="py-3 px-4 text-sm text-gray-600 tabular-nums">{formatDateTime(t.departureAt)}</td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/fr/coop/fares/${t.id}/edit`}
                        className="text-brand text-sm font-medium hover:underline"
                      >
                        Modifier les tarifs
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
