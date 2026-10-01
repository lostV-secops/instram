/**
 * Page de détail d'un trajet — /fr/trips/{tripId}
 *
 * Server Component :
 * - Charge le détail du trajet (coopérative, route, tarifs, politique).
 * - Charge la carte des sièges initiale.
 * - Obtient un ticket WS court (60s) si l'utilisateur est authentifié.
 * - Passe tout à SeatMap (Client Component).
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations, isValidLang, dateLocale } from '@/lib/i18n';
import { apiGet } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { SeatMap } from '@/components/seats/SeatMap';
import type {
  TripInstanceDetail,
  TripSeatMap,
  SeatCategory,
  Lang,
} from '@/lib/types';
import { AppError } from '@/lib/api';

interface PageProps {
  params: { lang: string; tripId: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);
  return { title: t.tripDetail.title };
}

function formatMGA(amount: number): string {
  return amount.toLocaleString('fr-MG');
}

function formatDateTime(isoDate: string, lang: string): string {
  try {
    return new Date(isoDate).toLocaleString(
      dateLocale(lang),
      {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
    );
  } catch {
    return isoDate;
  }
}

const categoryOrder: SeatCategory[] = ['VIP', 'PREMIUM', 'CLASSIC', 'STANDARD'];

export default async function TripDetailPage({ params }: PageProps) {
  const { lang, tripId } = params;

  if (!isValidLang(lang)) return null;

  const t = getTranslations(lang);

  // ─── Chargement du détail du trajet ────────────────────────────────────────
  let trip: TripInstanceDetail;
  try {
    trip = await apiGet<TripInstanceDetail>(`/trips/${tripId}`, {
      acceptLang: lang,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    // Autres erreurs → afficher un message
    return (
      <div className="text-center py-16">
        <p className="text-red-600 mb-4">{t.common.errorNetwork}</p>
        <Link href={`/${lang}`} className="text-brand underline">
          {t.common.back}
        </Link>
      </div>
    );
  }

  // ─── Chargement de la carte des sièges ─────────────────────────────────────
  let seatMapData: TripSeatMap | null = null;
  try {
    seatMapData = await apiGet<TripSeatMap>(`/trips/${tripId}/seats`, {
      cache: 'no-store',
    });
  } catch {
    // Carte des sièges indisponible — SeatMap affichera un état d'erreur
  }

  // ─── Ticket WS court (60s) — si authentifié ────────────────────────────────
  let wsToken: string | null = null;
  const accessToken = await getAccessToken();
  if (accessToken) {
    try {
      const wsData = await apiGet<{ wsUrl: string; ticket: string }>(
        '/realtime/ws-endpoint',
        { cache: 'no-store' },
      );
      wsToken = wsData.ticket;
    } catch {
      // L'utilisateur sera en lecture seule (pas de hold possible)
    }
  }

  const { cooperative, route, vehicle, departureAt, arrivalEstimatedAt, fares, policy } =
    trip;

  // Trier les tarifs par ordre de catégorie
  const sortedFares = [...fares].sort(
    (a, b) =>
      categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category),
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <Link
        href={`/${lang}`}
        className="text-brand text-sm hover:underline inline-flex items-center gap-1"
      >
        ← {t.common.back}
      </Link>

      {/* En-tête trajet */}
      <section aria-labelledby="trip-heading">
        <h1 id="trip-heading" className="text-xl font-bold text-gray-900 mb-1">
          {route.originCity.name} → {route.destinationCity.name}
        </h1>
        <p className="text-brand font-semibold">{cooperative.displayName}</p>
        {cooperative.ratingCount > 0 && (
          <p className="text-xs text-gray-500 mt-0.5">
            ★ {cooperative.ratingAverage.toFixed(1)} ({cooperative.ratingCount}{' '}
            {lang === 'mg' ? 'fanamarihana' : 'avis'})
          </p>
        )}
      </section>

      {/* Infos horaires */}
      <section
        className="bg-white rounded-xl border border-gray-200 p-4 space-y-2"
        aria-labelledby="trip-schedule"
      >
        <h2
          id="trip-schedule"
          className="text-sm font-semibold text-brand-dark uppercase tracking-wide"
        >
          {t.tripDetail.title}
        </h2>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">{t.tripDetail.departure}</dt>
            <dd className="font-medium text-gray-900 text-right">
              {formatDateTime(departureAt, lang)}
            </dd>
          </div>
          {arrivalEstimatedAt && (
            <div className="flex justify-between">
              <dt className="text-gray-500">{t.tripDetail.arrival}</dt>
              <dd className="text-gray-700 text-right">
                {formatDateTime(arrivalEstimatedAt, lang)}
              </dd>
            </div>
          )}
          {vehicle.model && (
            <div className="flex justify-between">
              <dt className="text-gray-500">{t.tripDetail.vehicle}</dt>
              <dd className="text-gray-700">{vehicle.model}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Tarifs par catégorie */}
      {sortedFares.length > 0 && (
        <section
          className="bg-white rounded-xl border border-gray-200 p-4"
          aria-labelledby="trip-fares"
        >
          <h2
            id="trip-fares"
            className="text-sm font-semibold text-brand-dark uppercase tracking-wide mb-3"
          >
            {t.tripDetail.fares}
          </h2>
          <ul className="space-y-1" role="list">
            {sortedFares.map((fare) => (
              <li
                key={fare.category}
                className="flex justify-between text-sm"
              >
                <span className="text-gray-600">
                  {t.tripDetail.category[fare.category]}
                </span>
                <span className="font-semibold text-gray-900 tabular-nums">
                  {formatMGA(fare.priceMga)} {t.tripDetail.priceMga}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Politique d'annulation */}
      {policy && (
        <section
          className="bg-brand-dark/5 border border-brand-dark/20 rounded-xl p-4"
          aria-labelledby="trip-policy"
        >
          <h2
            id="trip-policy"
            className="text-sm font-semibold text-brand-dark uppercase tracking-wide mb-2"
          >
            {t.tripDetail.policy}
          </h2>
          <p className="text-sm text-gray-700">
            {lang === 'mg' ? policy.textMg : policy.textFr}
          </p>
        </section>
      )}

      {/* Séparateur */}
      <hr className="border-gray-200" />

      {/* Carte des sièges — Client Component avec WebSocket */}
      <section aria-labelledby="seatmap-heading">
        <h2
          id="seatmap-heading"
          className="text-lg font-bold text-gray-900 mb-4"
        >
          {t.seats.title}
        </h2>

        {seatMapData ? (
          <SeatMap
            tripId={tripId}
            initialSeats={seatMapData.seats}
            wsToken={wsToken}
          />
        ) : (
          <div className="bg-red-50 border border-red-300 text-red-700 rounded-lg p-4 text-sm">
            {t.common.errorNetwork}
          </div>
        )}
      </section>
    </div>
  );
}
