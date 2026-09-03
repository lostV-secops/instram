/**
 * Fiche publique d'une coopérative — /fr/cooperatives/[slug]
 *
 * Server Component avec ISR (revalidate 60s).
 * Fetch : GET /v1/directory/cooperatives/{slug}
 *   (source de vérité : docs/contrat-api.yaml — tag Directory, schema DirectoryEntryDetail)
 *
 * Contenu affiché :
 *  - En-tête : nom, logo, téléphone
 *  - Lignes desservies
 *  - Avis voyageurs : note moyenne (RatingSummary)
 *  - Politique d'annulation (si disponible)
 *  - Bouton "Rechercher un trajet" → variant primary (bleu) — navigation, JAMAIS vert
 *
 * Note : L'endpoint GET /v1/ratings/cooperative/:id n'existe PAS dans le
 * contrat API v1. Les avis individuels ne sont donc pas chargés.
 * Seul l'agrégat (ratingAverage, ratingCount) est affiché.
 *
 * États : chargement (ISR + Suspense), erreur réseau, 404.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { apiGet, AppError } from '@/lib/api';
import type { DirectoryEntryDetail } from '@/lib/types';
import { RatingSummary } from '@/components/cooperatives/RatingSummary';
import { ReviewList } from '@/components/cooperatives/ReviewList';
import { StarRating } from '@/components/cooperatives/StarRating';

// ISR : cache 60s — la liste d'avis peut être légèrement périmée
export const revalidate = 60;

interface PageProps {
  params: {
    lang: string;
    slug: string;
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);

  try {
    const coop = await apiGet<DirectoryEntryDetail>(
      `/directory/cooperatives/${encodeURIComponent(params.slug)}`,
      { acceptLang: params.lang, next: { revalidate: 60 } },
    );
    return {
      title: coop.displayName,
      description: coop.description ?? t.cooperatives.subtitle,
      openGraph: {
        title: coop.displayName,
        description: coop.description ?? undefined,
      },
    };
  } catch {
    return { title: t.cooperatives.notFound };
  }
}

export default async function CooperativeDetailPage({ params }: PageProps) {
  const { lang, slug } = params;
  if (!isValidLang(lang)) return null;

  const t = getTranslations(lang);
  const tc = t.cooperatives;

  // ─── Fetch fiche coopérative ──────────────────────────────────────────────
  let coop: DirectoryEntryDetail | null = null;
  let fetchError: string | null = null;
  let isNotFound = false;

  try {
    coop = await apiGet<DirectoryEntryDetail>(
      `/directory/cooperatives/${encodeURIComponent(slug)}`,
      {
        acceptLang: lang,
        next: { revalidate: 60 },
      },
    );
  } catch (err) {
    if (err instanceof AppError && err.status === 404) {
      isNotFound = true;
    } else if (err instanceof AppError) {
      fetchError = t.common.errorServer;
    } else {
      fetchError = tc.errorLoadDetail;
    }
  }

  // 404 → Next.js notFound
  if (isNotFound) {
    notFound();
  }

  // ─── État d'erreur réseau ─────────────────────────────────────────────────
  if (fetchError || !coop) {
    return (
      <div className="space-y-4">
        <Link
          href={`/${lang}/cooperatives`}
          className="inline-flex items-center gap-1 text-sm text-brand hover:text-brand-dark"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {tc.backToDirectory}
        </Link>

        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl px-4 py-6 text-center"
        >
          <p className="text-red-700 text-sm font-medium mb-3">
            {fetchError ?? tc.errorLoadDetail}
          </p>
          <Link
            href={`/${lang}/cooperatives/${encodeURIComponent(slug)}`}
            className="inline-block text-sm bg-brand text-white rounded-lg px-5 py-2.5 hover:bg-brand-dark transition-colors"
          >
            {t.common.retry}
          </Link>
        </div>
      </div>
    );
  }

  // ─── Politique d'annulation localisée ─────────────────────────────────────
  const policyTitle = lang === 'mg' ? coop.policy?.titleMg : coop.policy?.titleFr;
  const policyBody = lang === 'mg' ? coop.policy?.bodyMg : coop.policy?.bodyFr;

  return (
    <div className="space-y-6 pb-8">
      {/* Fil d'Ariane */}
      <nav aria-label="Fil d'Ariane">
        <Link
          href={`/${lang}/cooperatives`}
          className="inline-flex items-center gap-1 text-sm text-brand hover:text-brand-dark"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {tc.backToDirectory}
        </Link>
      </nav>

      {/* ─── En-tête coopérative ──────────────────────────────────────────── */}
      <header className="bg-brand-dark rounded-xl px-5 py-6 text-white">
        <div className="flex items-start gap-4">
          {/* Logo */}
          {coop.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coop.logoUrl}
              alt=""
              aria-hidden="true"
              className="w-16 h-16 rounded-xl object-cover flex-shrink-0 border-2 border-white/20"
              loading="eager"
              width={64}
              height={64}
            />
          ) : (
            <div
              className="w-16 h-16 rounded-xl bg-brand flex items-center justify-center flex-shrink-0"
              aria-hidden="true"
            >
              <span className="text-white font-bold text-2xl">
                {coop.displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold leading-tight">{coop.displayName}</h1>

            {/* Note résumée dans l'en-tête */}
            {coop.ratingCount > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <StarRating
                  score={coop.ratingAverage}
                  size="sm"
                  label={`${tc.ratings.average} : ${coop.ratingAverage.toFixed(1)} sur 5`}
                />
                <span className="text-white/80 text-xs">
                  {coop.ratingAverage.toFixed(1).replace('.', ',')}
                  {' '}
                  <span className="text-white/60">
                    ({tc.ratingCount.replace('{count}', String(coop.ratingCount))})
                  </span>
                </span>
              </div>
            )}

            {/* Contact */}
            {coop.contactPhone && (
              <a
                href={`tel:${coop.contactPhone}`}
                className="flex items-center gap-1.5 mt-2 text-white/90 hover:text-white text-sm transition-colors"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {coop.contactPhone}
              </a>
            )}
          </div>
        </div>

        {/* Description */}
        {coop.description && (
          <p className="mt-4 text-white/80 text-sm leading-relaxed">
            {coop.description}
          </p>
        )}

        {/* Régions desservies */}
        {coop.regionsServed.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {coop.regionsServed.map((region) => (
              <span
                key={region}
                className="inline-block bg-white/15 text-white text-xs px-2.5 py-0.5 rounded-full"
              >
                {region}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* ─── Lignes desservies ────────────────────────────────────────────── */}
      {coop.routes.length > 0 && (
        <section aria-labelledby="routes-heading">
          <h2
            id="routes-heading"
            className="text-lg font-semibold text-gray-900 mb-3"
          >
            {tc.routes}
          </h2>
          <ul className="space-y-2" role="list">
            {coop.routes.map((route, idx) => (
              <li
                key={idx}
                className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3"
              >
                {/* Icône route */}
                <svg
                  className="w-4 h-4 text-brand-light flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                  />
                </svg>
                <div className="min-w-0 flex-1">
                  {route.displayName ? (
                    <span className="text-sm font-medium text-gray-900">
                      {route.displayName}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-700">
                      {route.originCity.name}
                      <span className="mx-1.5 text-gray-400">→</span>
                      {route.destinationCity.name}
                    </span>
                  )}
                  {route.displayName && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {route.originCity.name}
                      <span className="mx-1 text-gray-400">→</span>
                      {route.destinationCity.name}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── Contact email ────────────────────────────────────────────────── */}
      {coop.contactEmail && (
        <section aria-labelledby="contact-heading">
          <h2
            id="contact-heading"
            className="text-base font-semibold text-gray-900 mb-2"
          >
            {tc.contact}
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-2">
            {coop.contactPhone && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <svg className="w-4 h-4 text-brand flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <a href={`tel:${coop.contactPhone}`} className="hover:text-brand transition-colors">
                  {coop.contactPhone}
                </a>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <svg className="w-4 h-4 text-brand flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <a href={`mailto:${coop.contactEmail}`} className="hover:text-brand transition-colors">
                {coop.contactEmail}
              </a>
            </div>
          </div>
        </section>
      )}

      {/* ─── Avis voyageurs ───────────────────────────────────────────────── */}
      <section aria-labelledby="ratings-section-heading">
        {/* RatingSummary gère son propre heading "Avis voyageurs" */}
        <RatingSummary
          ratingAverage={coop.ratingAverage}
          ratingCount={coop.ratingCount}
          t={t}
        />

        {/* ReviewList — avis individuels (aucun endpoint public dans le contrat v1) */}
        {coop.ratingCount > 0 && (
          <div className="mt-4">
            <ReviewList
              initialReviews={[]}
              nextCursor={null}
              coopSlug={slug}
              t={t}
            />
          </div>
        )}
      </section>

      {/* ─── Politique d'annulation ───────────────────────────────────────── */}
      {coop.policy && policyBody && (
        <section aria-labelledby="policy-heading">
          <h2
            id="policy-heading"
            className="text-base font-semibold text-gray-900 mb-2"
          >
            {policyTitle ?? tc.policy}
          </h2>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
            <p className="text-sm text-yellow-900 leading-relaxed whitespace-pre-line">
              {policyBody}
            </p>
          </div>
        </section>
      )}

      {/* ─── CTA — Rechercher un trajet ───────────────────────────────────── */}
      {/* Bouton primary (bleu) — c'est une action de NAVIGATION, pas transactionnelle */}
      <div className="sticky bottom-4 pt-4">
        <Link
          href={`/${lang}/search?cooperativeSlug=${encodeURIComponent(coop.slug)}`}
          className="block w-full text-center bg-brand text-white font-semibold text-base px-6 py-3.5 rounded-xl hover:bg-brand-dark transition-colors shadow-md"
        >
          {tc.searchTrips}
        </Link>
      </div>
    </div>
  );
}
