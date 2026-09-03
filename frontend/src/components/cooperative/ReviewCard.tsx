/**
 * Carte d'un avis voyageur approuvé.
 *
 * Affiche :
 *  - Note étoiles (RatingStars — bleu brand)
 *  - Texte de l'avis (si présent)
 *  - Passager anonymisé : prénom + initiale du nom (ex. "Hery R.")
 *  - Date relative calculée côté serveur (SSR/ISR)
 *
 * Règle RGPD : NE PAS afficher le nom complet du passager.
 *   Format attendu : { authorDisplayName?: "Prénom I." }
 *
 * Endpoint source : aucun endpoint public dans contrat-api.yaml v1
 * ne liste les avis d'une coopérative. Ce composant est prêt pour
 * une version future de l'API (GET /v1/directory/cooperatives/{slug}/ratings).
 *
 * Compatible Server Component — pas de hooks.
 */

import type { Translations } from '@/lib/i18n';
import { RatingStars } from './RatingStars';

export interface PublicReview {
  id: string;
  score: number;
  comment: string | null;
  createdAt: string;
  /** Nom anonymisé "Prénom I." — absent si non fourni par l'API */
  authorDisplayName?: string;
}

interface ReviewCardProps {
  review: PublicReview;
  /** Langue de la page pour la date relative (fr ou mg) */
  lang: string;
  t: Translations;
}

/**
 * Calcule une date relative côté serveur.
 * Ex. : "il y a 3 jours", "il y a 2 semaines".
 * Pour le malgache, utilise le français (Intl ne supporte pas mg).
 */
function relativeDate(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);

    // Intl.RelativeTimeFormat — toujours en français (mg non supporté)
    const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

    if (months >= 1) return rtf.format(-months, 'month');
    if (weeks >= 1) return rtf.format(-weeks, 'week');
    if (days >= 1) return rtf.format(-days, 'day');
    if (hours >= 1) return rtf.format(-hours, 'hour');
    return rtf.format(-minutes, 'minute');
  } catch {
    // Fallback : date courte si Intl indisponible
    return iso.slice(0, 10);
  }
}

/**
 * Initiale d'un nom pour l'anonymisation.
 * "Rakoto" → "R."
 */
function toInitial(word: string): string {
  if (!word) return '';
  return `${word.charAt(0).toUpperCase()}.`;
}

/**
 * Construit le nom anonymisé à partir de `authorDisplayName`.
 * Si le format est déjà "Prénom I.", l'utilise tel quel.
 * Sinon, prend le premier mot comme prénom et transforme le reste en initiale.
 */
function anonymize(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const prenom = parts[0];
  const lastWord = parts[parts.length - 1];
  // Déjà anonymisé si le dernier mot est une initiale ("R.")
  if (/^[A-Z]\.$/.test(lastWord)) return raw.trim();
  return `${prenom} ${toInitial(lastWord)}`;
}

export function ReviewCard({ review, lang, t }: ReviewCardProps) {
  const tc = t.cooperatives;
  const displayName = anonymize(review.authorDisplayName, tc.anonymous);
  const dateStr = relativeDate(review.createdAt);

  return (
    <article
      className="bg-white border border-gray-100 rounded-xl p-4 space-y-2 shadow-sm"
      aria-label={`Avis ${displayName}`}
    >
      {/* En-tête : auteur + note + date */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Avatar initial */}
          <div
            className="w-8 h-8 rounded-full bg-brand-dark flex items-center justify-center flex-shrink-0"
            aria-hidden="true"
          >
            <span className="text-white text-xs font-bold">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {displayName}
            </p>
            <RatingStars
              rating={review.score}
              size="sm"
              label={`Note : ${review.score} sur 5`}
              className="mt-0.5"
            />
          </div>
        </div>

        {/* Date relative */}
        <time
          dateTime={review.createdAt}
          className="text-xs text-gray-400 flex-shrink-0 mt-0.5"
        >
          {dateStr}
        </time>
      </div>

      {/* Corps de l'avis */}
      {review.comment && (
        <p className="text-sm text-gray-700 leading-relaxed">
          {review.comment}
        </p>
      )}
    </article>
  );
}

export default ReviewCard;
