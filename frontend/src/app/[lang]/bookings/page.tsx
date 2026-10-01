/**
 * Page historique des réservations — /fr/bookings
 * Auth requise (enforced par middleware.ts).
 *
 * Server Component : fetch GET /v1/bookings.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, isValidLang, dateLocale } from '@/lib/i18n';
import { apiGet } from '@/lib/api';
import { Badge, bookingStatusVariant } from '@/components/ui/Badge';
import type { BookingList, Lang } from '@/lib/types';

interface PageProps {
  params: { lang: string };
  searchParams: { cursor?: string; status?: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);
  return { title: t.bookingList.title };
}

function formatMGA(amount: number): string {
  return amount.toLocaleString('fr-MG');
}

function formatDate(isoDate: string, lang: string): string {
  try {
    return new Date(isoDate).toLocaleDateString(dateLocale(lang), {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

export default async function BookingsPage({
  params,
  searchParams,
}: PageProps) {
  const { lang } = params;
  if (!isValidLang(lang)) return null;

  const t = getTranslations(lang);

  const apiParams = new URLSearchParams({ limit: '20' });
  if (searchParams.cursor) apiParams.set('cursor', searchParams.cursor);
  if (searchParams.status) apiParams.set('status', searchParams.status);

  let bookingList: BookingList = { items: [], nextCursor: null };
  let fetchError = false;

  try {
    bookingList = await apiGet<BookingList>(`/bookings?${apiParams.toString()}`, {
      acceptLang: lang,
      cache: 'no-store',
    });
  } catch {
    fetchError = true;
  }

  const { items: bookings, nextCursor } = bookingList;

  const nextParams = new URLSearchParams(searchParams as Record<string, string>);
  if (nextCursor) nextParams.set('cursor', nextCursor);

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">
        {t.bookingList.title}
      </h1>

      {/* Erreur réseau */}
      {fetchError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-300 text-red-700 rounded-lg p-4 mb-4 text-sm"
        >
          {t.common.errorNetwork}
        </div>
      )}

      {/* Aucune réservation */}
      {!fetchError && bookings.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-500 mb-6">{t.bookingList.noBookings}</p>
          <Link
            href={`/${lang}`}
            className="inline-block bg-brand text-white px-6 py-3 rounded-lg hover:bg-brand-dark transition-colors text-sm font-medium"
          >
            {t.bookingList.searchTrips}
          </Link>
        </div>
      )}

      {/* Liste des réservations */}
      {bookings.length > 0 && (
        <>
          <ul className="space-y-3" role="list">
            {bookings.map((booking) => (
              <li key={booking.id}>
                <Link
                  href={`/${lang}/bookings/${booking.id}`}
                  className="block bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
                  aria-label={`Réservation ${booking.reference}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-bold text-brand-dark">
                        {booking.reference}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatDate(booking.createdAt, lang)}
                      </p>
                    </div>
                    <Badge variant={bookingStatusVariant(booking.status)}>
                      {t.bookingDetail.status[booking.status]}
                    </Badge>
                  </div>

                  <div className="mt-3 flex justify-between items-end">
                    <span className="text-xs text-gray-500">
                      {booking.channel === 'WALK_IN'
                        ? lang === 'mg'
                          ? 'Walk-in'
                          : 'Guichet'
                        : 'En ligne'}
                    </span>
                    <span className="font-semibold text-gray-900 tabular-nums text-sm">
                      {formatMGA(booking.totalAmountMga)} {t.common.ariary}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          {nextCursor && (
            <div className="mt-6 text-center">
              <Link
                href={`/${lang}/bookings?${nextParams.toString()}`}
                className="inline-block bg-brand-light text-white px-6 py-2.5 rounded-lg hover:bg-brand transition-colors text-sm font-medium"
              >
                {t.bookingList.loadMore}
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
