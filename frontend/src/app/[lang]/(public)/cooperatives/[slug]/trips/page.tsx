import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { apiGet, AppError } from '@/lib/api';
import { TripCard } from '@/components/search/TripCard';
import type { TripSearchResponse, Lang } from '@/lib/types';

export const revalidate = 60;

interface PageProps {
  params: { lang: string; slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);
  return { title: t.cooperatives.seeTrips ?? 'Trajets disponibles' };
}

export default async function CooperativeTripsPage({ params }: PageProps) {
  const { lang, slug } = params;
  if (!isValidLang(lang)) return null;

  const t = getTranslations(lang);

  let result: TripSearchResponse = { items: [], nextCursor: null };
  let coopName: string | null = null;
  let fetchError = false;

  // Récupère le nom de la coop pour l'en-tête (depuis la fiche)
  try {
    const detail = await apiGet<{ displayName: string }>(
      `/directory/cooperatives/${encodeURIComponent(slug)}`,
      { acceptLang: lang, next: { revalidate: 60 } },
    );
    coopName = detail.displayName;
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
  }

  // Récupère tous les trajets à venir
  try {
    result = await apiGet<TripSearchResponse>(
      `/directory/cooperatives/${encodeURIComponent(slug)}/trips`,
      { acceptLang: lang, next: { revalidate: 60 } },
    );
  } catch {
    fetchError = true;
  }

  const { items: trips } = result;

  return (
    <div className="space-y-5 pb-8">
      {/* Fil d'Ariane */}
      <nav aria-label="Fil d'Ariane">
        <Link
          href={`/${lang}/cooperatives/${encodeURIComponent(slug)}`}
          className="inline-flex items-center gap-1 text-sm text-brand hover:text-brand-dark transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {coopName ?? slug}
        </Link>
      </nav>

      {/* En-tête */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">
          {coopName ? `Trajets — ${coopName}` : 'Trajets disponibles'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">Tous les trajets à venir</p>
      </div>

      {/* Erreur réseau */}
      {fetchError && (
        <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg p-4 text-sm">
          {t.common.errorNetwork}
        </div>
      )}

      {/* Aucun trajet */}
      {!fetchError && trips.length === 0 && (
        <div className="text-center py-16 bg-gray-50 rounded-xl">
          <p className="text-gray-600 font-medium mb-2">{t.search.noResults}</p>
          <p className="text-gray-400 text-sm mb-6">{t.search.noResultsHint}</p>
          <Link
            href={`/${lang}/cooperatives/${encodeURIComponent(slug)}`}
            className="inline-block text-sm text-brand border border-brand rounded-lg px-5 py-2.5 hover:bg-brand hover:text-white transition-colors"
          >
            {t.common.back}
          </Link>
        </div>
      )}

      {/* Liste des trajets */}
      {trips.length > 0 && (
        <>
          <p className="text-sm text-gray-500">
            {t.search.resultsCount.replace('{count}', String(trips.length))}
          </p>
          <ul className="space-y-3" role="list">
            {trips.map((trip) => (
              <li key={trip.tripInstanceId}>
                <TripCard trip={trip} lang={lang as Lang} t={t} passengers={1} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
