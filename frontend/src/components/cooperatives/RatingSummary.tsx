/**
 * Résumé de notation d'une coopérative.
 *
 * Affiche :
 *  - Note moyenne (grand chiffre + étoiles)
 *  - Nombre total d'avis publiés
 *  - Barres de distribution 1-5 étoiles
 *
 * Données disponibles via DirectoryEntryDetail (contrat-api.yaml) :
 *  ratingAverage (float), ratingCount (integer).
 *
 * Note : la distribution par étoile n'est PAS fournie par l'API publique.
 * Les barres ne sont donc pas rendues (elles seraient trompeuses).
 * Le composant est prêt à recevoir une prop `distribution` si l'API l'expose plus tard.
 *
 * Compatible Server Component.
 */

import type { Translations } from '@/lib/i18n';
import { StarRating } from './StarRating';

interface RatingSummaryProps {
  ratingAverage: number;
  ratingCount: number;
  t: Translations;
  /**
   * Distribution optionnelle par étoile (1 à 5).
   * Format : { 1: count, 2: count, 3: count, 4: count, 5: count }
   * Non disponible dans les endpoints publics actuels du contrat API.
   */
  distribution?: Record<1 | 2 | 3 | 4 | 5, number>;
}

export function RatingSummary({
  ratingAverage,
  ratingCount,
  t,
  distribution,
}: RatingSummaryProps) {
  const tc = t.cooperatives.ratings;
  const hasRatings = ratingCount > 0;

  return (
    <section aria-labelledby="ratings-heading">
      <h2
        id="ratings-heading"
        className="text-lg font-semibold text-gray-900 mb-4"
      >
        {tc.title}
      </h2>

      {!hasRatings ? (
        <p className="text-sm text-gray-500 italic">{tc.noRatings}</p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-6 items-start">
          {/* Bloc note globale */}
          <div className="flex flex-col items-center bg-gray-50 rounded-xl px-6 py-4 min-w-[120px]">
            <span
              className="text-4xl font-bold text-brand-dark tabular-nums"
              aria-hidden="true"
            >
              {ratingAverage.toFixed(1).replace('.', ',')}
            </span>
            <StarRating
              score={ratingAverage}
              size="md"
              label={`${tc.average} : ${ratingAverage.toFixed(1).replace('.', ',')} sur 5`}
              className="mt-1"
            />
            <span className="text-xs text-gray-500 mt-1 text-center">
              {tc.total.replace('{count}', String(ratingCount))}
            </span>
          </div>

          {/* Distribution par étoile (si données disponibles) */}
          {distribution && (
            <div className="flex-1 space-y-1.5 w-full">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                {tc.distribution}
              </p>
              {([5, 4, 3, 2, 1] as const).map((star) => {
                const count = distribution[star] ?? 0;
                const pct = ratingCount > 0 ? (count / ratingCount) * 100 : 0;
                const starLabel = tc[`stars${star}` as keyof typeof tc] as string;
                return (
                  <div key={star} className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-14 flex-shrink-0">
                      {starLabel}
                    </span>
                    <div
                      className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${starLabel} : ${count} avis`}
                    >
                      <div
                        className="bg-yellow-400 h-2 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-6 text-right flex-shrink-0">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default RatingSummary;
