'use client';

import { useState } from 'react';

interface Props {
  bookingId: string;
  labels: {
    rateTitle: string;
    rateSubtitle: string;
    rateSubmit: string;
    rateSubmitting: string;
    rateSuccess: string;
    rateAlreadyDone: string;
    rateCommentPlaceholder: string;
  };
  alreadyRated?: boolean;
}

export function RatingForm({ bookingId, labels, alreadyRated }: Props) {
  const [score, setScore] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(alreadyRated ?? false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <p className="text-sm text-green-700 text-center py-2">{labels.rateAlreadyDone}</p>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (score === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/proxy/v1/bookings/${bookingId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment: comment.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Erreur ${res.status}`);
        return;
      }
      setDone(true);
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }

  const display = hovered || score;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-gray-500">{labels.rateSubtitle}</p>

      {/* Étoiles */}
      <div
        className="flex justify-center gap-1"
        role="group"
        aria-label={labels.rateTitle}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setScore(star)}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            aria-label={`${star} étoile${star > 1 ? 's' : ''}`}
            aria-pressed={score === star}
            className="text-3xl focus:outline-none transition-transform hover:scale-110"
          >
            <span className={star <= display ? 'text-yellow-400' : 'text-gray-300'}>★</span>
          </button>
        ))}
      </div>

      {/* Commentaire */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder={labels.rateCommentPlaceholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand"
      />

      {error && (
        <p className="text-red-700 text-sm" role="alert">{error}</p>
      )}

      <button
        type="submit"
        disabled={score === 0 || loading}
        className="w-full bg-brand text-white rounded-xl py-2 text-sm font-semibold disabled:opacity-50 hover:bg-brand-dark transition-colors"
      >
        {loading ? labels.rateSubmitting : labels.rateSubmit}
      </button>
    </form>
  );
}
