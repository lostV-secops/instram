'use client';

/**
 * Carte d'avis à modérer — Console admin InsTRAM.
 *
 * Affiche : texte de l'avis, note /5, coopérative, date.
 * Actions : Approuver (variant="action") / Rejeter (variant="danger").
 *
 * Appelle PATCH /v1/admin/ratings/:id { status: "PUBLISHED" | "REJECTED" }
 * conformément au contrat API (schéma RatingStatus).
 * Note : le task décrit { action: "APPROVE" } mais le contrat utilise
 * { status: RatingStatus } — on suit le contrat.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { Rating, RatingStatus } from '@/lib/types';

const starFilled = (
  <svg className="w-4 h-4 inline text-yellow-400" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const starEmpty = (
  <svg className="w-4 h-4 inline text-gray-300" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

interface RatingModerationCardProps {
  rating: Rating;
  /** Nom d'affichage de la coopérative (enrichi côté parent) */
  cooperativeName?: string;
  onModerated?: (ratingId: string, newStatus: RatingStatus) => void;
}

function StarRating({ score }: { score: number }) {
  return (
    <span aria-label={`Note : ${score} sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i}>{i <= score ? starFilled : starEmpty}</span>
      ))}
    </span>
  );
}

export function RatingModerationCard({
  rating,
  cooperativeName,
  onModerated,
}: RatingModerationCardProps) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const moderate = async (action: 'approve' | 'reject') => {
    const newStatus: RatingStatus = action === 'approve' ? 'PUBLISHED' : 'REJECTED';
    setLoading(action);
    setError(null);

    try {
      const res = await fetch(`/api/proxy/v1/admin/ratings/${rating.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        throw new Error('Erreur lors de la modération. Vérifiez votre connexion.');
      }

      setDone(true);
      onModerated?.(rating.id, newStatus);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.');
    } finally {
      setLoading(null);
    }
  };

  const formattedDate = new Date(rating.createdAt).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  if (done) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-500 italic">
        Avis modéré.
      </div>
    );
  }

  return (
    <article className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      {/* En-tête : note + coopérative + date */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-0.5">
          <StarRating score={rating.score} />
          {cooperativeName && (
            <p className="text-xs text-gray-500">{cooperativeName}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <time className="text-xs text-gray-400">{formattedDate}</time>
          <div className="mt-0.5">
            {rating.status === 'PENDING_REVIEW' && <Badge variant="warning">En attente</Badge>}
            {rating.status === 'PUBLISHED' && <Badge variant="success">Publié</Badge>}
            {rating.status === 'REJECTED' && <Badge variant="error">Rejeté</Badge>}
          </div>
        </div>
      </div>

      {/* Texte de l'avis */}
      {(rating.commentFr ?? rating.comment) ? (
        <p className="text-sm text-gray-700 leading-relaxed">{rating.commentFr ?? rating.comment}</p>
      ) : (
        <p className="text-sm text-gray-400 italic">Aucun commentaire.</p>
      )}

      {/* Erreur */}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          variant="action"
          size="sm"
          isLoading={loading === 'approve'}
          disabled={loading !== null}
          onClick={() => moderate('approve')}
        >
          Approuver
        </Button>
        <Button
          variant="danger"
          size="sm"
          isLoading={loading === 'reject'}
          disabled={loading !== null}
          onClick={() => moderate('reject')}
        >
          Rejeter
        </Button>
      </div>
    </article>
  );
}

export default RatingModerationCard;
