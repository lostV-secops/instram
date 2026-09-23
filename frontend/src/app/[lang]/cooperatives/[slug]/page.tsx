/**
 * Fiche publique d'une coopérative — /[lang]/cooperatives/[slug]
 *
 * Server Component avec ISR (revalidate 60 s).
 * Endpoint : GET /v1/directory/cooperatives/{slug}
 *   (source de vérité : docs/contrat-api.yaml — tag Directory, schema DirectoryEntryDetail)
 *
 * Sections :
 *  1. En-tête      : nom, régions desservies, téléphone si public
 *  2. Notation     : note moyenne (grand format), total avis, RatingBar distribution
 *  3. Lignes       : liste des routes avec lien "Voir les trajets"
 *  4. Avis         : ReviewCard (vide : aucun endpoint public dans contrat v1)
 *  5. CTA          : "Rechercher un trajet" — variant primary (BLEU — navigation, pas vert)
 *
 * SEO : <title> et <meta description> localisés.
 *
 * États : 404 (notFound()), erreur réseau, chargement ISR implicite.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { apiGet, AppError } from '@/lib/api';
import type { DirectoryEntryDetail } from '@/lib/types';
import { RatingStars } from '@/components/cooperative/RatingStars';
import { ReviewCard } from '@/components/cooperative/ReviewCard';
// RatingBar est prêt à l'emploi dès que l'API exposera la distribution par étoile.
// import { RatingBar } from '@/components/cooperative/RatingBar';
import type { PublicReview } from '@/components/cooperative/ReviewCard';

// ISR 60 s — la fiche coopérative et ses avis changent peu souvent
export const revalidate = 60;

interface PageProps {
  params: {
    lang: string;
    slug: string;
  };
}

// ─── Métadonnées SEO bilingues ────────────────────────────────────────────────

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
        title: `${coop.displayName} — InsTRAM`,
        description: coop.description ?? undefined,
        locale: params.lang === 'mg' ? 'mg_MG' : 'fr_MG',
      },
    };
  } catch {
    return { title: t.cooperatives.notFound };
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CooperativeDetailPage({ params }: PageProps) {
  const { lang, slug } = params;
  if (!isValidLang(lang)) return null;

  const t = getTranslations(lang);
  const tc = t.cooperatives;

  // ─── Fetch fiche coopérative ──────────────────────────────────────────────
  // Un seul endpoint disponible dans contrat-api.yaml v1 pour le public :
  //   GET /v1/directory/cooperatives/{slug}  (schema DirectoryEntryDetail)
  // Les endpoints /catalog/cooperatives/:id, /cooperatives/:id/rating-summary
  // et /ratings/cooperative/:id ne figurent pas dans le contrat — non appelés.

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
    } else {
      fetchError = err instanceof AppError ? t.common.errorServer : tc.errorLoadDetail;
    }
  }

  // 404 → Next.js notFound
  if (isNotFound) notFound();

  // ─── État d'erreur réseau ─────────────────────────────────────────────────
  if (fetchError || !coop) {
    return (
      <div className="space-y-4">
        <BackLink lang={lang} label={tc.backToDirectory} />
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

  // Avis individuels : aucun endpoint public dans contrat-api.yaml v1.
  // Affichage d'un message vide ; ce tableau sera alimenté si l'API évolue.
  const reviews: PublicReview[] = [];

  return (
    <div className="space-y-6 pb-8">

      {/* ─── Fil d'Ariane ──────────────────────────────────────────────── */}
      <nav aria-label="Fil d'Ariane">
        <BackLink lang={lang} label={tc.backToDirectory} />
      </nav>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 1 — En-tête coopérative
          ══════════════════════════════════════════════════════════════════ */}
      <header className="bg-brand-dark rounded-xl px-5 py-6 text-white">
        <div className="flex items-start gap-4">
          {/* Initiale — PAS d'image (contrainte 3G) */}
          <div
            className="w-16 h-16 rounded-xl bg-brand flex items-center justify-center flex-shrink-0"
            aria-hidden="true"
          >
            <span className="text-white font-bold text-2xl">
              {coop.displayName.charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold leading-tight">{coop.displayName}</h1>

            {/* Note résumée dans l'en-tête */}
            {coop.ratingCount > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <RatingStars
                  rating={coop.ratingAverage}
                  size="sm"
                  label={`${tc.ratings.average} : ${coop.ratingAverage.toFixed(1)} sur 5`}
                />
                <span className="text-white/80 text-xs">
                  {coop.ratingAverage.toFixed(1).replace('.', ',')}
                  {' '}
                  <span className="text-white/60">
                    ({coop.ratingCount}&nbsp;{tc.reviews})
                  </span>
                </span>
              </div>
            )}

            {/* Téléphone */}
            {coop.contactPhone && (
              <a
                href={`tel:${coop.contactPhone}`}
                className="flex items-center gap-1.5 mt-2 text-white/90 hover:text-white text-sm transition-colors"
              >
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
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
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label={tc.regions}>
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

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 2 — Résumé notation
          ══════════════════════════════════════════════════════════════════ */}
      <section aria-labelledby="ratings-heading" className="bg-white border border-gray-200 rounded-xl p-5">
        <h2
          id="ratings-heading"
          className="text-lg font-semibold text-gray-900 mb-4"
        >
          {tc.ratingTitle}
        </h2>

        {coop.ratingCount === 0 ? (
          <p className="text-sm text-gray-500 italic">{tc.noReviews}</p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            {/* Bloc note globale */}
            <div className="flex flex-col items-center bg-gray-50 rounded-xl px-6 py-4 min-w-[120px]">
              <span
                className="text-4xl font-bold text-brand-dark tabular-nums"
                aria-hidden="true"
              >
                {coop.ratingAverage.toFixed(1).replace('.', ',')}
              </span>
              <RatingStars
                rating={coop.ratingAverage}
                size="md"
                label={`${tc.ratings.average} : ${coop.ratingAverage.toFixed(1)} sur 5`}
                className="mt-1"
              />
              <span className="text-xs text-gray-500 mt-1 text-center">
                {tc.ratings.total.replace('{count}', String(coop.ratingCount))}
              </span>
            </div>

            {/* RatingBar — distribution non disponible dans l'API v1.
                Affiché uniquement si une extension future de l'API fournit
                les données par étoile. Commenté pour documenter l'intention. */}
            {/*
            <div className="flex-1 w-full">
              <RatingBar
                distribution={{ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }}
                total={coop.ratingCount}
                t={t}
              />
            </div>
            */}
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 3 — Lignes desservies
          ══════════════════════════════════════════════════════════════════ */}
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
                    <>
                      <span className="text-sm font-medium text-gray-900">
                        {route.displayName}
                      </span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {route.originCity.name}
                        <span className="mx-1 text-gray-400">→</span>
                        {route.destinationCity.name}
                      </p>
                    </>
                  ) : (
                    <span className="text-sm text-gray-700">
                      {route.originCity.name}
                      <span className="mx-1.5 text-gray-400">→</span>
                      {route.destinationCity.name}
                    </span>
                  )}
                </div>
                {/* Lien "Voir les trajets" — bleu primaire (navigation) */}
                <Link
                  href={`/${lang}`}
                  className="text-xs text-brand hover:text-brand-dark border border-brand rounded-lg px-3 py-1.5 transition-colors flex-shrink-0 font-medium"
                >
                  {tc.seeTrips}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 4 — Avis voyageurs
          ══════════════════════════════════════════════════════════════════ */}
      <section aria-labelledby="reviews-heading">
        <div className="flex items-center justify-between mb-4">
          <h2
            id="reviews-heading"
            className="text-lg font-semibold text-gray-900"
          >
            {tc.ratingTitle}
          </h2>
          {/* Lien "Voir tous les avis" — à activer si endpoint public ajouté */}
          {coop.ratingCount > 10 && (
            <span
              className="text-xs text-gray-400 italic"
              title="Endpoint non disponible dans contrat-api.yaml v1"
            >
              {tc.allReviews}
            </span>
          )}
        </div>

        {reviews.length === 0 ? (
          <div className="bg-gray-50 rounded-xl px-4 py-8 text-center">
            <p className="text-sm text-gray-500">{tc.noReviews}</p>
            {coop.ratingCount > 0 && (
              <p className="text-xs text-gray-400 mt-1">
                {/* Les {coop.ratingCount} avis agrégés sont inclus dans la note ci-dessus. */}
                {tc.ratings.total.replace('{count}', String(coop.ratingCount))}
              </p>
            )}
          </div>
        ) : (
          <ul className="space-y-3" role="list">
            {reviews.map((review) => (
              <li key={review.id}>
                <ReviewCard review={review} lang={lang} t={t} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          Contact email
          ══════════════════════════════════════════════════════════════════ */}
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
                <svg
                  className="w-4 h-4 text-brand flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
                <a href={`tel:${coop.contactPhone}`} className="hover:text-brand transition-colors">
                  {coop.contactPhone}
                </a>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <svg
                className="w-4 h-4 text-brand flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <a href={`mailto:${coop.contactEmail}`} className="hover:text-brand transition-colors">
                {coop.contactEmail}
              </a>
            </div>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Politique d'annulation
          ══════════════════════════════════════════════════════════════════ */}
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

      {/* ══════════════════════════════════════════════════════════════════
          CTA — Rechercher un trajet (BLEU primaire — navigation, PAS vert)
          ══════════════════════════════════════════════════════════════════ */}
      <div className="sticky bottom-4 pt-4">
        <Link
          href={`/${lang}`}
          className="block w-full text-center bg-brand text-white font-semibold text-base px-6 py-3.5 rounded-xl hover:bg-brand-dark transition-colors shadow-md"
        >
          {tc.searchTrip}
        </Link>
      </div>

    </div>
  );
}

// ─── Sous-composant lien retour ────────────────────────────────────────────────

function BackLink({ lang, label }: { lang: string; label: string }) {
  return (
    <Link
      href={`/${lang}/cooperatives`}
      className="inline-flex items-center gap-1 text-sm text-brand hover:text-brand-dark transition-colors"
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      {label}
    </Link>
  );
}
