'use client';

/**
 * Modération des avis — /fr/admin/ratings
 *
 * Appelle GET /v1/admin/ratings?status=... (contrat-api.yaml, tag Admin).
 * Affiche les avis avec filtre par statut : PENDING_REVIEW | PUBLISHED | REJECTED
 *
 * Actions via RatingModerationCard :
 *  - Approuver → PATCH /v1/admin/ratings/:id { status: "PUBLISHED" }
 *  - Rejeter   → PATCH /v1/admin/ratings/:id { status: "REJECTED" }
 *
 * Note : le contrat utilise le schéma RatingStatus { PENDING_REVIEW, PUBLISHED, REJECTED }.
 * Le statut PENDING_REVIEW correspond à "En attente de modération".
 *
 * États de chargement et d'erreur explicites.
 */

import { useState, useEffect, useCallback } from 'react';
import { RatingModerationCard } from '@/components/admin/RatingModerationCard';
import { Button } from '@/components/ui/Button';
import type { Rating, RatingStatus } from '@/lib/types';

const STATUS_OPTIONS: { value: RatingStatus | ''; label: string }[] = [
  { value: 'PENDING_REVIEW', label: 'En attente' },
  { value: '', label: 'Tous' },
  { value: 'PUBLISHED', label: 'Publiés' },
  { value: 'REJECTED', label: 'Rejetés' },
];

export default function AdminRatingsPage() {
  const [statusFilter, setStatusFilter] = useState<RatingStatus | ''>('PENDING_REVIEW');
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildUrl = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (cursor) params.set('cursor', cursor);
      return `/api/proxy/v1/admin/ratings?${params.toString()}`;
    },
    [statusFilter],
  );

  const loadRatings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data: Rating[] = await res.json();
      // L'API retourne un tableau direct (pas d'objet paginé selon le contrat)
      setRatings(data ?? []);
      setNextCursor(null); // La pagination cursor n'est pas documentée sur ce retour
    } catch {
      setError('Impossible de charger les avis. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  useEffect(() => {
    loadRatings();
  }, [loadRatings]);

  const handleModerated = useCallback((ratingId: string, _newStatus: RatingStatus) => {
    // Retirer l'avis de la liste après modération si on filtre sur PENDING_REVIEW
    if (statusFilter === 'PENDING_REVIEW') {
      setRatings((prev) => prev.filter((r) => r.id !== ratingId));
    } else {
      // Recharger pour afficher le nouveau statut
      loadRatings();
    }
  }, [statusFilter, loadRatings]);

  return (
    <div className="space-y-5">
      {/* Titre */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-brand-dark">Modération des avis</h1>

        {/* Filtre */}
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm text-gray-600 whitespace-nowrap">
            Statut :
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RatingStatus | '')}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand bg-white"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Chargement */}
      {loading && (
        <div className="space-y-3 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-200 rounded-xl" />
          ))}
        </div>
      )}

      {/* Erreur */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{error}</p>
            <button type="button" onClick={loadRatings} className="text-sm underline mt-1">
              Réessayer
            </button>
          </div>
        </div>
      )}

      {/* Liste des avis */}
      {!loading && !error && (
        <>
          {ratings.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-sm text-gray-500">
              {statusFilter === 'PENDING_REVIEW'
                ? 'Aucun avis en attente de modération.'
                : 'Aucun avis pour ce filtre.'}
            </div>
          ) : (
            <div className="space-y-3">
              {statusFilter !== 'PENDING_REVIEW' && (
                <p className="text-xs text-gray-400">
                  {ratings.length} avis — Approuver/Rejeter disponible uniquement en vue «&nbsp;En attente&nbsp;».
                </p>
              )}
              {ratings.map((rating) => (
                <RatingModerationCard
                  key={rating.id}
                  rating={rating}
                  onModerated={handleModerated}
                />
              ))}
            </div>
          )}

          {nextCursor && (
            <div className="text-center pt-2">
              <Button
                variant="ghost"
                size="sm"
                isLoading={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  try {
                    const res = await fetch(buildUrl(nextCursor), { cache: 'no-store' });
                    if (!res.ok) throw new Error();
                    const data: Rating[] = await res.json();
                    setRatings((prev) => [...prev, ...(data ?? [])]);
                  } catch { /* silencieux */ }
                  finally { setLoadingMore(false); }
                }}
              >
                Charger plus
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
