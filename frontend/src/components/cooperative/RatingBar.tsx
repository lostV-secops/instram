/**
 * Barre de distribution des notes (1★ à 5★).
 *
 * Affiche une barre de progression par niveau d'étoile.
 * Utilisé dans la section "Avis voyageurs" de la fiche coopérative.
 *
 * Props :
 *   distribution : { 1: n, 2: n, 3: n, 4: n, 5: n } — nombre d'avis par étoile
 *   total        : nombre total d'avis (pour calculer le %)
 *   t            : objet de traductions
 *
 * Note API : la distribution par étoile n'est pas fournie par
 * GET /v1/directory/cooperatives/{slug} (contrat-api.yaml v1).
 * Ce composant est prêt pour une version future de l'API.
 *
 * Charte : barres remplies en #205E98 (brand), fond en #E5E7EB.
 * Compatible Server Component.
 */

import type { Translations } from '@/lib/i18n';

export interface RatingBarProps {
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  total: number;
  t: Translations;
}

export function RatingBar({ distribution, total, t }: RatingBarProps) {
  const tc = t.cooperatives.ratings;

  return (
    <div
      className="space-y-2"
      aria-label={tc.distribution}
    >
      {([5, 4, 3, 2, 1] as const).map((star) => {
        const count = distribution[star] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const starLabel = tc[`stars${star}` as keyof typeof tc] as string;

        return (
          <div key={star} className="flex items-center gap-2">
            {/* Libellé "X étoile(s)" */}
            <span className="text-xs text-gray-500 w-16 flex-shrink-0 leading-none">
              {starLabel}
            </span>

            {/* Barre de progression */}
            <div className="flex-1 min-w-0">
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ backgroundColor: '#E5E7EB' }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${starLabel} : ${count} avis (${pct} %)`}
              >
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: '#205E98',
                  }}
                />
              </div>
            </div>

            {/* Compteur */}
            <span
              className="text-xs text-gray-500 w-6 text-right flex-shrink-0 tabular-nums"
              aria-hidden="true"
            >
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default RatingBar;
