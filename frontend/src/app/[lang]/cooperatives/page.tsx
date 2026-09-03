/**
 * Annuaire public des coopératives — /fr/cooperatives et /mg/cooperatives
 *
 * Server Component — SEO important.
 * Fetch : GET /v1/directory/cooperatives?q=...&cursor=...
 *   (source de vérité : docs/contrat-api.yaml — tag Directory)
 *
 * Fonctionnalités :
 *  - Grille de cartes coopératives (CoopCard)
 *  - Barre de recherche ?q= (CoopSearchBar)
 *  - Pagination par curseur
 *  - Message si liste vide
 *  - États de chargement implicites via Server Component (streaming SSR)
 *  - État d'erreur explicite (réseau instable = cas fréquent)
 *
 * Charte graphique : bleu #205E98, bleu clair #4596D7, bleu foncé #162E49.
 * Vert #9CC43D UNIQUEMENT sur les boutons transactionnels (réserver/payer/confirmer).
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { apiGet, AppError } from '@/lib/api';
import type { DirectoryEntry } from '@/lib/types';
import { CoopCard } from '@/components/cooperatives/CoopCard';
import { CoopSearchBar } from '@/components/cooperatives/CoopSearchBar';

interface PageProps {
  params: { lang: string };
  searchParams: {
    q?: string;
    cursor?: string;
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);
  return {
    title: t.cooperatives.title,
    description: t.cooperatives.subtitle,
  };
}

export default async function CooperativesPage({ params, searchParams }: PageProps) {
  const { lang } = params;
  if (!isValidLang(lang)) return null;

  const t = getTranslations(lang);
  const tc = t.cooperatives;

  const q = searchParams.q?.trim() ?? '';
  const cursor = searchParams.cursor ?? undefined;

  // ─── Fetch liste coopératives actives ──────────────────────────────────────
  let cooperatives: DirectoryEntry[] = [];
  let nextCursor: string | null = null;
  let fetchError: string | null = null;

  try {
    // GET /v1/directory/cooperatives (public, sans auth)
    const params_url = new URLSearchParams();
    if (q) params_url.set('q', q);
    if (cursor) params_url.set('cursor', cursor);

    const qs = params_url.toString();
    const result = await apiGet<DirectoryEntry[]>(
      `/directory/cooperatives${qs ? `?${qs}` : ''}`,
      {
        acceptLang: lang,
        // Cache public 5 minutes (Cache-Control du backend : public, max-age=300)
        next: { revalidate: 300 },
      },
    );
    // La réponse est un tableau direct (schema: array of DirectoryEntry)
    if (Array.isArray(result)) {
      cooperatives = result;
    }
    // Si l'API retourne un objet paginé (items + nextCursor), adaptation :
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyResult = result as any;
    if (anyResult?.items) {
      cooperatives = anyResult.items;
      nextCursor = anyResult.nextCursor ?? null;
    }
  } catch (err) {
    if (err instanceof AppError) {
      fetchError = t.common.errorServer;
    } else {
      fetchError = tc.errorLoad;
    }
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="bg-brand-dark rounded-xl px-5 py-6 text-white">
        <h1 className="text-2xl font-bold mb-1">{tc.title}</h1>
        <p className="text-white/80 text-sm">{tc.subtitle}</p>
      </div>

      {/* Barre de recherche */}
      <div>
        <CoopSearchBar lang={lang} defaultValue={q} t={t} />
      </div>

      {/* Indicateur de filtre actif */}
      {q && !fetchError && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>
            Filtre actif :{' '}
            <span className="font-medium text-brand">&ldquo;{q}&rdquo;</span>
          </span>
          <Link
            href={`/${lang}/cooperatives`}
            className="text-gray-400 hover:text-gray-600 text-xs underline"
          >
            {t.common.close}
          </Link>
        </div>
      )}

      {/* État d'erreur réseau */}
      {fetchError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl px-4 py-4 text-center"
        >
          <p className="text-red-700 text-sm font-medium mb-2">{fetchError}</p>
          <Link
            href={`/${lang}/cooperatives${q ? `?q=${encodeURIComponent(q)}` : ''}`}
            className="inline-block text-sm text-brand hover:text-brand-dark border border-brand rounded-lg px-4 py-2 transition-colors"
          >
            {t.common.retry}
          </Link>
        </div>
      )}

      {/* Liste vide */}
      {!fetchError && cooperatives.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <svg
            className="mx-auto w-12 h-12 text-gray-300 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
          <p className="text-gray-700 font-medium">{tc.noResults}</p>
          <p className="text-gray-500 text-sm mt-1">{tc.noResultsHint}</p>
          {q && (
            <Link
              href={`/${lang}/cooperatives`}
              className="inline-block mt-4 text-sm bg-brand text-white rounded-lg px-5 py-2.5 hover:bg-brand-dark transition-colors"
            >
              {t.common.retry}
            </Link>
          )}
        </div>
      )}

      {/* Grille de coopératives */}
      {!fetchError && cooperatives.length > 0 && (
        <>
          <ul
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            role="list"
            aria-label={tc.title}
          >
            {cooperatives.map((coop) => (
              <li key={coop.slug}>
                <CoopCard coop={coop} lang={lang} t={t} />
              </li>
            ))}
          </ul>

          {/* Pagination — page suivante */}
          {nextCursor && (
            <div className="text-center pt-2">
              <Link
                href={`/${lang}/cooperatives?${q ? `q=${encodeURIComponent(q)}&` : ''}cursor=${encodeURIComponent(nextCursor)}`}
                className="inline-block text-sm text-brand hover:text-brand-dark border border-brand rounded-lg px-5 py-2.5 transition-colors"
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
