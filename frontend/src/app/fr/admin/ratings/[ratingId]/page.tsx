'use client';

/**
 * Détail d'un avis + actions de modération — /fr/admin/ratings/[ratingId]
 *
 * Endpoint (contrat-api.yaml) :
 *  - GET  /v1/admin/ratings?cursor=... → liste (pas de GET /{id} dans le contrat)
 *  - PATCH /v1/admin/ratings/{id}      → { status: "PUBLISHED" | "REJECTED" }
 *
 * NOTE : Il n'y a pas de GET /admin/ratings/{id} dans le contrat.
 * On charge la liste et on filtre par ID.
 *
 * Affiche : texte, note /5, coopérative, date.
 * Actions : Publier (variant="action") / Rejeter (variant="danger").
 * États de chargement et d'erreur explicites.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { Rating, RatingStatus } from '@/lib/types';

const statusLabels: Record<RatingStatus, string> = {
  PENDING_REVIEW: 'En attente de modération',
  PUBLISHED: 'Publié',
  REJECTED: 'Rejeté',
};

const statusVariants: Record<RatingStatus, 'warning' | 'success' | 'error'> = {
  PENDING_REVIEW: 'warning',
  PUBLISHED: 'success',
  REJECTED: 'error',
};

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

function StarRating({ score }: { score: number }) {
  return (
    <span aria-label={`Note : ${score} sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i}>{i <= score ? starFilled : starEmpty}</span>
      ))}
    </span>
  );
}

export default function AdminRatingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ratingId = params.ratingId as string;

  const [rating, setRating] = useState<Rating | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [moderating, setModerating] = useState<'approve' | 'reject' | null>(null);
  const [moderateError, setModerateError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /**
   * Charge l'avis depuis la liste (pas d'endpoint GET /{id} dans le contrat).
   */
  const loadRating = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Charger la liste sans filtre de statut pour avoir tous les avis
      const res = await fetch(`/api/proxy/v1/admin/ratings`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data: Rating[] = await res.json();
      const found = data.find((r) => r.id === ratingId) ?? null;
      if (!found) {
        setError('Avis introuvable. Il a peut-être déjà été modéré.');
        return;
      }
      setRating(found);
    } catch {
      setError("Impossible de charger cet avis. Vérifiez votre connexion.");
    } finally {
      setLoading(false);
    }
  }, [ratingId]);

  useEffect(() => {
    loadRating();
  }, [loadRating]);

  const handleModerate = async (action: 'approve' | 'reject') => {
    const newStatus: RatingStatus = action === 'approve' ? 'PUBLISHED' : 'REJECTED';
    setModerating(action);
    setModerateError(null);

    try {
      const res = await fetch(`/api/proxy/v1/admin/ratings/${ratingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Erreur lors de la modération. Vérifiez votre connexion.');
      const updated: Rating = await res.json();
      setRating(updated);
      setDone(true);
      setTimeout(() => {
        router.push('/fr/admin/ratings');
      }, 1500);
    } catch (err: unknown) {
      setModerateError(
        err instanceof Error ? err.message : 'Erreur inconnue.',
      );
    } finally {
      setModerating(null);
    }
  };

  // ─── Chargement ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-32" />
        <div className="h-48 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/fr/admin/ratings" className="text-sm text-brand hover:underline">
          ← Retour à la modération
        </Link>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{error}</p>
            <button type="button" onClick={loadRating} className="text-sm underline mt-1">
              Réessayer
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!rating) return null;

  const formattedDate = new Date(rating.createdAt).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // ─── Succès ────────────────────────────────────────────────────────────────
  if (done && rating) {
    return (
      <div className="space-y-4 max-w-lg">
        <div className="bg-green-50 border border-green-300 rounded-xl px-4 py-6 text-center space-y-2">
          <p className="font-semibold text-green-800">Avis modéré — statut : {statusLabels[rating.status]}</p>
          <p className="text-sm text-green-700">Redirection vers la liste…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      {/* Fil d'Ariane */}
      <Link href="/fr/admin/ratings" className="text-sm text-brand hover:underline">
        ← Retour à la modération
      </Link>

      {/* Titre */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-brand-dark">Détail de l'avis</h1>
        <Badge variant={statusVariants[rating.status]}>
          {statusLabels[rating.status]}
        </Badge>
      </div>

      {/* Carte avis */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        {/* En-tête */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="space-y-1">
            <StarRating score={rating.score} />
            <p className="text-xs text-gray-500">Note : {rating.score}/5</p>
          </div>
          <time className="text-xs text-gray-400">{formattedDate}</time>
        </div>

        {/* Métadonnées */}
        <dl className="divide-y divide-gray-100">
          {[
            { label: 'ID Réservation', value: rating.bookingId },
            { label: 'ID Coopérative', value: rating.cooperativeId },
          ].map(({ label, value }) => (
            <div key={label} className="py-2 flex gap-4">
              <dt className="text-xs text-gray-500 w-36 flex-shrink-0">{label}</dt>
              <dd className="text-xs text-gray-700 font-mono truncate">{value}</dd>
            </div>
          ))}
        </dl>

        {/* Commentaire */}
        <div>
          <p className="text-xs text-gray-500 mb-1">Commentaire</p>
          {rating.comment ? (
            <p className="text-sm text-gray-800 leading-relaxed bg-gray-50 rounded-lg px-3 py-3">
              {rating.comment}
            </p>
          ) : (
            <p className="text-sm text-gray-400 italic">Aucun commentaire.</p>
          )}
        </div>
      </div>

      {/* Erreur modération */}
      {moderateError && (
        <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
          {moderateError}
        </div>
      )}

      {/* Actions — uniquement si en attente */}
      {rating.status === 'PENDING_REVIEW' && (
        <div className="flex gap-3 flex-wrap">
          {/* Publier : variant="action" (vert transactionnel) */}
          <Button
            variant="action"
            isLoading={moderating === 'approve'}
            disabled={moderating !== null}
            onClick={() => handleModerate('approve')}
          >
            Publier l'avis
          </Button>
          {/* Rejeter : variant="danger" */}
          <Button
            variant="danger"
            isLoading={moderating === 'reject'}
            disabled={moderating !== null}
            onClick={() => handleModerate('reject')}
          >
            Rejeter l'avis
          </Button>
        </div>
      )}

      {rating.status !== 'PENDING_REVIEW' && (
        <div className="text-sm text-gray-500">
          Cet avis a déjà été modéré ({statusLabels[rating.status]}).
          La re-modération n'est pas possible via cette interface.
        </div>
      )}
    </div>
  );
}
