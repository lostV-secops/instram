/**
 * Annuaire public des coopératives — /fr/cooperatives et /mg/cooperatives
 *
 * Server Component avec ISR (revalidate 60 s) — données peu volatiles.
 * Fetch : GET /v1/directory/cooperatives?q=...
 *   (source de vérité : docs/contrat-api.yaml — tag Directory)
 *
 * Fonctionnalités :
 *  - Grille de CoopCard (nom, région, note, nb avis)
 *  - Barre de recherche ?q= / ?region= (CoopSearchBar — formulaire GET natif)
 *  - Message si liste vide
 *  - État d'erreur réseau explicite (réseau instable = cas fréquent)
 *
 * Charte : bleu #205E98, bleu clair #4596D7, bleu foncé #162E49.
 * Vert #9CC43D UNIQUEMENT sur les boutons transactionnels (réserver/payer).
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { apiGet, AppError } from '@/lib/api';
import type { DirectoryEntry } from '@/lib/types';
import { CoopCard } from '@/components/cooperative/CoopCard';
import { CoopSearchBar } from '@/components/cooperatives/CoopSearchBar';

// ISR 60 s — l'annuaire change peu souvent
export const revalidate = 60;

interface PageProps {
  params: { lang: string };
  searchParams: {
    q?: string;
    region?: string;
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
  const region = searchParams.region?.trim() ?? '';
  const cursor = searchParams.cursor ?? undefined;

  // ─── Fetch liste coopératives actives ──────────────────────────────────────
  let cooperatives: DirectoryEntry[] = [];
  let nextCursor: string | null = null;
  let fetchError: string | null = null;

  try {
    // GET /v1/directory/cooperatives — public, sans auth, cache 60 s
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (region) qs.set('region', region);
    if (cursor) qs.set('cursor', cursor);

    const qsStr = qs.toString();
    const result = await apiGet<DirectoryEntry[] | { items: DirectoryEntry[]; nextCursor: string | null }>(
      `/directory/cooperatives${qsStr ? `?${qsStr}` : ''}`,
      {
        acceptLang: lang,
        next: { revalidate: 60 },
      },
    );

    if (Array.isArray(result)) {
      cooperatives = result;
    } else if (result && 'items' in result) {
      cooperatives = result.items;
      nextCursor = result.nextCursor ?? null;
    }
  } catch (err) {
    fetchError = err instanceof AppError ? t.common.errorServer : tc.errorLoad;
  }

  const hasFilter = q || region;

  return (
    <div className="space-y-6">

      {/* ─── En-tête ─────────────────────────────────────────────────────── */}
      <div className="bg-brand-dark rounded-xl px-5 py-6 text-white">
        <h1 className="text-2xl font-bold mb-1">{tc.title}</h1>
        <p className="text-white/80 text-sm">{tc.subtitle}</p>
      </div>

      {/* ─── Barre de recherche / filtre ──────────────────────────────────── */}
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          {tc.filterByCity}
        </p>
        <CoopSearchBar lang={lang} defaultValue={q} t={t} />
      </div>

      {/* Filtre actif */}
      {hasFilter && !fetchError && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>
            {t.common.search} :{' '}
            <span className="font-medium text-brand">
              &ldquo;{q || region}&rdquo;
            </span>
          </span>
          <Link
            href={`/${lang}/cooperatives`}
            className="text-gray-400 hover:text-gray-600 text-xs underline"
          >
            {t.common.close}
          </Link>
        </div>
      )}

      {/* ─── Erreur réseau ─────────────────────────────────────────────────── */}
      {fetchError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl px-4 py-5 text-center"
        >
          <p className="text-red-700 text-sm font-medium mb-3">{fetchError}</p>
          <Link
            href={`/${lang}/cooperatives${q ? `?q=${encodeURIComponent(q)}` : ''}`}
            className="inline-block text-sm text-brand border border-brand rounded-lg px-4 py-2 hover:bg-brand hover:text-white transition-colors"
          >
            {t.common.retry}
          </Link>
        </div>
      )}

      {/* ─── Liste vide ────────────────────────────────────────────────────── */}
      {!fetchError && cooperatives.length === 0 && (
        <div className="text-center py-14 bg-gray-50 rounded-xl">
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
          {hasFilter && (
            <Link
              href={`/${lang}/cooperatives`}
              className="inline-block mt-4 text-sm bg-brand text-white rounded-lg px-5 py-2.5 hover:bg-brand-dark transition-colors"
            >
              {t.common.retry}
            </Link>
          )}
        </div>
      )}

      {/* ─── Grille coopératives ───────────────────────────────────────────── */}
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

          {/* Pagination — page suivante par curseur */}
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
