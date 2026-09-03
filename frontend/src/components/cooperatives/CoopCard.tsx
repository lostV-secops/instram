/**
 * Carte coopérative pour l'annuaire public.
 *
 * Affiche : nom, régions desservies, note moyenne (étoiles), nombre d'avis.
 * Liens : fiche détail + page de recherche filtrée par cette coopérative.
 *
 * Charte graphique :
 *  - Bouton "Voir les trajets" → variant primary (bleu #205E98) — navigation
 *  - PAS de vert (#9CC43D) — réservé aux actions transactionnelles
 *
 * Compatible Server Component.
 */

import Link from 'next/link';
import type { DirectoryEntry } from '@/lib/types';
import type { Translations } from '@/lib/i18n';
import { StarRating } from './StarRating';

interface CoopCardProps {
  coop: DirectoryEntry;
  lang: string;
  t: Translations;
}

export function CoopCard({ coop, lang, t }: CoopCardProps) {
  const tc = t.cooperatives;
  const ratingLabel = coop.ratingCount > 0
    ? `${coop.ratingAverage.toFixed(1).replace('.', ',')} — ${tc.ratingCount.replace('{count}', String(coop.ratingCount))}`
    : tc.noRating;

  return (
    <article className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* En-tête : logo + nom */}
      <div className="flex items-start gap-3">
        {coop.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coop.logoUrl}
            alt=""
            aria-hidden="true"
            className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-gray-100"
            loading="lazy"
            width={48}
            height={48}
          />
        ) : (
          <div
            className="w-12 h-12 rounded-lg bg-brand-dark flex items-center justify-center flex-shrink-0"
            aria-hidden="true"
          >
            <span className="text-white font-bold text-lg">
              {coop.displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-gray-900 leading-tight truncate">
            {coop.displayName}
          </h2>

          {/* Note */}
          <div className="flex items-center gap-1.5 mt-1">
            {coop.ratingCount > 0 ? (
              <>
                <StarRating
                  score={coop.ratingAverage}
                  size="sm"
                  label={ratingLabel}
                />
                <span className="text-xs text-gray-500" aria-hidden="true">
                  {coop.ratingAverage.toFixed(1).replace('.', ',')}
                  {' '}
                  <span className="text-gray-400">
                    ({tc.ratingCount.replace('{count}', String(coop.ratingCount))})
                  </span>
                </span>
              </>
            ) : (
              <span className="text-xs text-gray-400">{tc.noRating}</span>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {coop.description && (
        <p className="text-sm text-gray-600 line-clamp-2">{coop.description}</p>
      )}

      {/* Régions desservies */}
      {coop.regionsServed.length > 0 && (
        <div>
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            {tc.regions}
          </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {coop.regionsServed.slice(0, 4).map((region) => (
              <span
                key={region}
                className="inline-block bg-blue-50 text-brand text-xs px-2 py-0.5 rounded-full"
              >
                {region}
              </span>
            ))}
            {coop.regionsServed.length > 4 && (
              <span className="inline-block bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">
                +{coop.regionsServed.length - 4}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        {/* Fiche détail — lien texte discret */}
        <Link
          href={`/${lang}/cooperatives/${coop.slug}`}
          className="flex-1 text-center text-sm text-brand hover:text-brand-dark border border-brand rounded-lg py-2 px-3 transition-colors"
        >
          {tc.viewProfile}
        </Link>

        {/* Voir les trajets — bouton primary (bleu) — navigation, PAS vert */}
        <Link
          href={`/${lang}/search?cooperativeSlug=${encodeURIComponent(coop.slug)}`}
          className="flex-1 text-center text-sm bg-brand text-white rounded-lg py-2 px-3 hover:bg-brand-dark transition-colors font-medium"
        >
          {tc.viewTrips}
        </Link>
      </div>
    </article>
  );
}

export default CoopCard;
