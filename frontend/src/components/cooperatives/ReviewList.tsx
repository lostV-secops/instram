/**
 * Liste paginée d'avis voyageurs.
 *
 * Contexte API :
 *   Le contrat-api.yaml v1 ne définit PAS d'endpoint public pour lister
 *   les avis d'une coopérative. Seul l'agrégat (ratingAverage, ratingCount)
 *   est disponible via GET /v1/directory/cooperatives/{slug}.
 *
 *   Ce composant est prêt à recevoir des avis si un endpoint public est ajouté.
 *   En attendant, il affiche le message "Aucun avis disponible".
 *
 * Anonymisation :
 *   Si des avis sont passés avec authorDisplayName, ils s'affichent.
 *   Format recommandé : "Prénom N." (première lettre du nom de famille).
 *
 * 'use client' requis pour le bouton "Charger plus" (état de chargement local).
 */

'use client';

import { useState } from 'react';
import type { Translations } from '@/lib/i18n';
import { StarRating } from './StarRating';

export interface PublicReview {
  id: string;
  score: number;
  comment: string | null;
  createdAt: string;
  /** Nom anonymisé ex. "Hery R." — absent si non fourni par l'API */
  authorDisplayName?: string;
}

interface ReviewListProps {
  /** Avis initiaux chargés côté serveur */
  initialReviews: PublicReview[];
  /** Curseur de pagination pour charger la page suivante */
  nextCursor?: string | null;
  /** Slug de la coopérative (pour la pagination) */
  coopSlug: string;
  t: Translations;
}

function formatDate(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang === 'mg' ? 'fr-MG' : 'fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function ReviewList({
  initialReviews,
  nextCursor: initialCursor,
  coopSlug,
  t,
}: ReviewListProps) {
  const tc = t.cooperatives.ratings;
  const lang = t.nav.switchLang === 'Français' ? 'mg' : 'fr';

  const [reviews, setReviews] = useState<PublicReview[]>(initialReviews);
  const [cursor, setCursor] = useState<string | null>(initialCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pas d'endpoint public pour charger plus d'avis — fonctionnalité désactivée
  // jusqu'à l'ajout d'un endpoint GET /v1/directory/cooperatives/{slug}/ratings
  // dans le contrat API.
  const canLoadMore = false; // cursor !== null

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      // TODO : appeler GET /v1/directory/cooperatives/{slug}/ratings?cursor={cursor}
      // quand cet endpoint sera ajouté au contrat API.
      throw new Error('Endpoint not available');
    } catch {
      setError(t.common.errorNetwork);
    } finally {
      setLoading(false);
    }
  }

  if (reviews.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic py-4">{tc.noRatings}</p>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3" role="list">
        {reviews.map((review) => (
          <li
            key={review.id}
            className="bg-gray-50 rounded-lg p-4 border border-gray-100"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                {/* Avatar initiale */}
                <div
                  className="w-8 h-8 rounded-full bg-brand-dark flex items-center justify-center flex-shrink-0"
                  aria-hidden="true"
                >
                  <span className="text-white text-xs font-bold">
                    {review.authorDisplayName
                      ? review.authorDisplayName.charAt(0).toUpperCase()
                      : 'V'}
                  </span>
                </div>
                <div>
                  {review.authorDisplayName && (
                    <p className="text-sm font-medium text-gray-900">
                      {review.authorDisplayName}
                    </p>
                  )}
                  <StarRating
                    score={review.score}
                    size="sm"
                    label={`Note : ${review.score} sur 5`}
                  />
                </div>
              </div>
              <time
                dateTime={review.createdAt}
                className="text-xs text-gray-400 flex-shrink-0"
              >
                {formatDate(review.createdAt, lang)}
              </time>
            </div>

            {review.comment && (
              <p className="text-sm text-gray-700 leading-relaxed">
                {review.comment}
              </p>
            )}
          </li>
        ))}
      </ul>

      {/* Erreur réseau */}
      {error && (
        <p role="alert" className="text-sm text-red-600 text-center py-2">
          {error}
        </p>
      )}

      {/* Bouton "Charger plus" */}
      {canLoadMore && (
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="text-sm text-brand hover:text-brand-dark border border-brand rounded-lg px-5 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-busy={loading}
          >
            {loading ? t.common.loading : t.bookingList.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}

export default ReviewList;
