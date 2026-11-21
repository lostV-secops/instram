/**
 * Carte de résultat de recherche — un trajet disponible.
 * Server Component (pas d'interactivité — juste affichage + lien).
 */

import Link from 'next/link';
import type { TripSearchResult } from '@/lib/types';
import type { Lang } from '@/lib/types';
import type { Translations } from '@/lib/i18n';
import { formatTimeMG } from '@/lib/i18n';

interface TripCardProps {
  trip: TripSearchResult;
  lang: Lang;
  t: Translations;
  passengers: number;
}

function formatDuration(minutes: number, t: Translations): string {
  if (minutes < 60) return `${minutes} ${t.search.min}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}${t.search.hours} ${m}${t.search.min}` : `${h}${t.search.hours}`;
}

function formatTime(isoDate: string, lang: Lang): string {
  return formatTimeMG(isoDate, lang);
}

function formatMGA(amount: number): string {
  return amount.toLocaleString('fr-MG');
}

export function TripCard({ trip, lang, t, passengers }: TripCardProps) {
  const {
    tripInstanceId,
    cooperative,
    route,
    departureAt,
    arrivalEstimatedAt,
    fareMinMga,
    seatsAvailable,
  } = trip;

  return (
    <article
      className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-4"
      aria-label={`Trajet ${route.originCity.name} → ${route.destinationCity.name} avec ${cooperative.displayName}`}
    >
      {/* En-tête : coopérative et note */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="font-semibold text-brand text-sm">
            {cooperative.displayName}
          </p>
          {cooperative.ratingCount > 0 && (
            <p className="text-xs text-gray-500">
              ★ {cooperative.ratingAverage.toFixed(1)}{' '}
              <span className="text-gray-400">({cooperative.ratingCount})</span>
            </p>
          )}
        </div>
        <span
          className={[
            'text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0',
            seatsAvailable >= passengers * 2
              ? 'bg-green-50 text-green-700'
              : seatsAvailable >= passengers
              ? 'bg-yellow-50 text-yellow-700'
              : 'bg-red-50 text-red-700',
          ].join(' ')}
          aria-label={`${seatsAvailable} ${t.search.seatsAvailable}`}
        >
          {seatsAvailable} {t.search.seatsAvailable}
        </span>
      </div>

      {/* Horaires */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-center">
          <p className="text-xl font-bold text-gray-900 tabular-nums">
            {formatTime(departureAt, lang)}
          </p>
          <p className="text-xs text-gray-500">{t.search.departure}</p>
        </div>

        <div className="flex-1 flex flex-col items-center">
          <div className="w-full border-t-2 border-gray-200 relative">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-1 text-xs text-gray-400">
              {route.estimatedDurationMin
                ? formatDuration(route.estimatedDurationMin, t)
                : '—'}
            </span>
          </div>
        </div>

        {arrivalEstimatedAt && (
          <div className="text-center">
            <p className="text-xl font-bold text-gray-900 tabular-nums">
              {formatTime(arrivalEstimatedAt, lang)}
            </p>
            <p className="text-xs text-gray-500">{t.search.arrival}</p>
          </div>
        )}
      </div>

      {/* Prix et lien */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs text-gray-500">{t.search.priceFrom} </span>
          <span className="text-lg font-bold text-gray-900">
            {formatMGA(fareMinMga)}
          </span>
          <span className="text-sm text-gray-500"> {t.common.ariary}</span>
        </div>

        {/* Lien vers le détail — bleu, pas vert */}
        <Link
          href={`/${lang}/trips/${tripInstanceId}?passengers=${passengers}`}
          className="inline-flex items-center gap-1 bg-brand text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-dark transition-colors"
          aria-label={`${t.search.seeDetails} — ${cooperative.displayName}`}
        >
          {t.search.seeDetails}
        </Link>
      </div>
    </article>
  );
}

export default TripCard;
