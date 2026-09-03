/**
 * Carte coopérative pour l'annuaire public.
 *
 * Affiche :
 *  - Nom coopérative (bold)
 *  - Première région desservie comme "ville principale"
 *  - Note moyenne avec étoiles (RatingStars — bleu brand)
 *  - Badge nombre d'avis
 *  - Nombre de lignes si disponible
 *
 * Liens :
 *  - Fiche détail  → /[lang]/cooperatives/[slug]
 *  - Voir les trajets → /[lang]/search?cooperativeSlug=[slug]  (bleu primaire)
 *
 * Contraintes :
 *  - PAS d'image (connexion 3G lente)
 *  - Hauteur tactile minimum 72 px
 *  - Vert (#9CC43D) JAMAIS ici — navigation uniquement
 *
 * Compatible Server Component.
 */

import Link from 'next/link';
import type { DirectoryEntry } from '@/lib/types';
import type { Translations } from '@/lib/i18n';
import { RatingStars } from './RatingStars';

interface CoopCardProps {
  coop: DirectoryEntry;
  lang: string;
  t: Translations;
}

export function CoopCard({ coop, lang, t }: CoopCardProps) {
  const tc = t.cooperatives;

  // Première région comme "ville principale" affiché dans l'annuaire
  const primaryRegion = coop.regionsServed[0] ?? null;

  return (
    <article
      className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col"
      style={{ minHeight: '72px' }}
    >
      {/* Corps principal */}
      <div className="flex items-start gap-3 p-4 flex-1">
        {/* Initiale — PAS d'image (3G) */}
        <div
          className="w-12 h-12 rounded-xl bg-brand-dark flex items-center justify-center flex-shrink-0"
          aria-hidden="true"
        >
          <span className="text-white font-bold text-lg">
            {coop.displayName.charAt(0).toUpperCase()}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          {/* Nom */}
          <h2 className="text-base font-semibold text-gray-900 leading-tight truncate">
            {coop.displayName}
          </h2>

          {/* Région principale */}
          {primaryRegion && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {primaryRegion}
            </p>
          )}

          {/* Note + nombre d'avis */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {coop.ratingCount > 0 ? (
              <>
                <RatingStars
                  rating={coop.ratingAverage}
                  size="sm"
                  label={`${coop.ratingAverage.toFixed(1).replace('.', ',')} sur 5`}
                />
                <span className="text-xs text-gray-600 font-medium tabular-nums">
                  {coop.ratingAverage.toFixed(1).replace('.', ',')}
                </span>
                <span className="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                  {coop.ratingCount}&nbsp;{tc.reviews}
                </span>
              </>
            ) : (
              <span className="text-xs text-gray-400">{tc.noRating}</span>
            )}
          </div>

          {/* Régions supplémentaires */}
          {coop.regionsServed.length > 1 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {coop.regionsServed.slice(0, 3).map((r) => (
                <span
                  key={r}
                  className="inline-block bg-blue-50 text-brand text-xs px-2 py-0.5 rounded-full"
                >
                  {r}
                </span>
              ))}
              {coop.regionsServed.length > 3 && (
                <span className="inline-block bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">
                  +{coop.regionsServed.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pied de carte : actions */}
      <div className="flex border-t border-gray-100">
        {/* Fiche détail */}
        <Link
          href={`/${lang}/cooperatives/${coop.slug}`}
          className="flex-1 text-center text-sm text-brand hover:text-brand-dark py-3 px-2 transition-colors font-medium border-r border-gray-100"
        >
          {tc.viewProfile}
        </Link>

        {/* Voir les trajets — bleu primaire (navigation, PAS vert) */}
        <Link
          href={`/${lang}/search?cooperativeSlug=${encodeURIComponent(coop.slug)}`}
          className="flex-1 text-center text-sm bg-brand text-white py-3 px-2 hover:bg-brand-dark transition-colors font-medium rounded-b-xl"
        >
          {tc.seeTrips}
        </Link>
      </div>
    </article>
  );
}

export default CoopCard;
