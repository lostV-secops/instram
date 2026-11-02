/**
 * Page de résultats de recherche — /fr/search?originCityId=...
 *
 * Server Component : fetch GET /v1/search/trips avec les params d'URL.
 * Pagination via ?cursor= dans l'URL.
 * Message "Aucun trajet disponible" si liste vide.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { apiGet } from '@/lib/api';
import { TripCard } from '@/components/search/TripCard';
import type { TripSearchResponse, CityList, Lang } from '@/lib/types';

interface PageProps {
  params: { lang: string };
  searchParams: {
    originCityId?: string;
    destinationCityId?: string;
    date?: string;
    passengers?: string;
    cursor?: string;
    limit?: string;
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);
  return { title: t.search.title };
}

export default async function SearchPage({ params, searchParams }: PageProps) {
  const { lang } = params;
  if (!isValidLang(lang)) return null;

  const t = getTranslations(lang);
  const {
    originCityId,
    destinationCityId,
    date,
    passengers = '1',
    cursor,
  } = searchParams;

  // Paramètres obligatoires : origin + destination
  if (!originCityId || !destinationCityId) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500 mb-4">{t.search.noResults}</p>
        <Link
          href={`/${lang}`}
          className="inline-block bg-brand text-white px-5 py-2.5 rounded-lg hover:bg-brand-dark transition-colors text-sm"
        >
          {t.common.back}
        </Link>
      </div>
    );
  }

  // Construction de la query string pour l'API (date optionnelle)
  const apiParams = new URLSearchParams({
    originCityId,
    destinationCityId,
    passengers,
    limit: '20',
  });
  if (date) apiParams.set('date', date);
  if (cursor) apiParams.set('cursor', cursor);

  let searchResult: TripSearchResponse = { items: [], nextCursor: null };
  let fetchError = false;

  try {
    searchResult = await apiGet<TripSearchResponse>(
      `/search/trips?${apiParams.toString()}`,
      {
        acceptLang: lang,
        // Cache Redis 60s côté backend — on ISR sur 60s aussi
        next: { revalidate: 60 },
      },
    );
  } catch {
    fetchError = true;
  }

  // Récupérer les noms des villes pour le titre
  let originName = originCityId;
  let destName = destinationCityId;
  try {
    const cities = await apiGet<CityList>(
      `/catalog/cities?limit=200`,
      { acceptLang: lang, next: { revalidate: 3600 } },
    );
    const origin = cities.items.find((c) => c.id === originCityId);
    const dest = cities.items.find((c) => c.id === destinationCityId);
    if (origin) originName = origin.name;
    if (dest) destName = dest.name;
  } catch {
    // Noms de villes non disponibles — on affiche les IDs
  }

  const { items: trips, nextCursor } = searchResult;

  // Liens de pagination
  const prevParams = cursor
    ? new URLSearchParams(searchParams as Record<string, string>)
    : null;
  if (prevParams) prevParams.delete('cursor');

  const nextParams = new URLSearchParams(searchParams as Record<string, string>);
  if (nextCursor) {
    nextParams.set('cursor', nextCursor);
  }

  return (
    <div>
      {/* En-tête résultats */}
      <div className="mb-5">
        <Link
          href={`/${lang}`}
          className="text-brand text-sm hover:underline inline-flex items-center gap-1 mb-3"
        >
          ← {t.common.back}
        </Link>
        <h1 className="text-xl font-bold text-gray-900">
          {originName} → {destName}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {date ? `${date} · ` : ''}{passengers}{' '}
          {t.home.passengers}
        </p>
      </div>

      {/* Erreur réseau */}
      {fetchError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-300 text-red-700 rounded-lg p-4 mb-4 text-sm"
        >
          {t.common.errorNetwork}
        </div>
      )}

      {/* Loading state — géré par Suspense en production */}
      {!fetchError && trips.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-500 font-medium mb-2">{t.search.noResults}</p>
          <p className="text-gray-400 text-sm mb-6">{t.search.noResultsHint}</p>
          <Link
            href={`/${lang}`}
            className="inline-block bg-brand text-white px-5 py-2.5 rounded-lg hover:bg-brand-dark transition-colors text-sm"
          >
            {t.common.back}
          </Link>
        </div>
      )}

      {/* Liste de trajets */}
      {trips.length > 0 && (
        <>
          <p className="text-sm text-gray-500 mb-4">
            {t.search.resultsCount.replace('{count}', String(trips.length))}
            {nextCursor ? ' +' : ''}
          </p>

          <ul className="space-y-3" role="list">
            {trips.map((trip) => (
              <li key={trip.tripInstanceId}>
                <TripCard trip={trip} lang={lang as Lang} t={t} passengers={Number(passengers)} />
              </li>
            ))}
          </ul>

          {/* Pagination */}
          {nextCursor && (
            <div className="mt-6 text-center">
              <Link
                href={`/${lang}/search?${nextParams.toString()}`}
                className="inline-block bg-brand-light text-white px-6 py-2.5 rounded-lg hover:bg-brand transition-colors text-sm font-medium"
              >
                {t.search.loadMore}
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
