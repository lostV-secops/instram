/**
 * Page de détail d'une réservation — /fr/bookings/{bookingId}
 * Auth requise (enforced par middleware).
 *
 * Server Component : charge le détail + billet QR.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { apiGet } from '@/lib/api';
import { Badge, bookingStatusVariant, paymentStatusVariant } from '@/components/ui/Badge';
import { AppError } from '@/lib/api';
import type { BookingDetail, Lang } from '@/lib/types';
import { QrCodeCanvas } from '@/components/ui/QrCodeCanvas';
import { RatingForm } from '@/components/booking/RatingForm';
import { ResendSMSButton } from './ResendSMSButton';

interface PageProps {
  params: { lang: string; bookingId: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);
  return { title: t.bookingDetail.title };
}

function formatMGA(amount: number): string {
  return amount.toLocaleString('fr-MG');
}

function formatDateTime(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString('fr-MG', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoDate;
  }
}

export default async function BookingDetailPage({ params }: PageProps) {
  const { lang, bookingId } = params;
  if (!isValidLang(lang)) return null;

  const t = getTranslations(lang);

  let booking: BookingDetail;
  try {
    booking = await apiGet<BookingDetail>(`/bookings/${bookingId}`, {
      acceptLang: lang,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    return (
      <div className="text-center py-16">
        <p className="text-red-600 mb-4">{t.common.errorNetwork}</p>
        <Link href={`/${lang}/bookings`} className="text-brand underline">
          {t.common.back}
        </Link>
      </div>
    );
  }

  const { trip } = booking;

  return (
    <div className="max-w-xl mx-auto space-y-5">
      {/* Navigation */}
      <Link
        href={`/${lang}/bookings`}
        className="text-brand text-sm hover:underline inline-flex items-center gap-1"
      >
        ← {t.bookingList.title}
      </Link>

      {/* En-tête réservation */}
      <section aria-labelledby="booking-heading">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 id="booking-heading" className="text-lg font-bold text-gray-900">
              {t.bookingDetail.title}
            </h1>
            <p
              className="font-mono text-xl font-bold text-brand-dark mt-1 tracking-wider"
              aria-label={`${t.bookingDetail.reference} ${booking.reference}`}
            >
              {booking.reference}
            </p>
          </div>
          <Badge variant={bookingStatusVariant(booking.status)} className="mt-1">
            {t.bookingDetail.status[booking.status]}
          </Badge>
        </div>
      </section>

      {/* Trajet */}
      <section
        className="bg-white rounded-xl border border-gray-200 p-4 space-y-2"
        aria-labelledby="booking-trip"
      >
        <h2
          id="booking-trip"
          className="text-sm font-semibold text-brand-dark uppercase tracking-wide"
        >
          {t.bookingDetail.trip}
        </h2>
        <dl className="text-sm space-y-1">
          <div className="flex justify-between">
            <dt className="text-gray-500">{t.tripDetail.cooperative}</dt>
            <dd className="font-medium text-brand">
              {trip.cooperative.displayName}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">{t.home.from}</dt>
            <dd className="text-gray-800">{trip.route.originCity.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">{t.home.to}</dt>
            <dd className="text-gray-800">{trip.route.destinationCity.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">{t.tripDetail.departure}</dt>
            <dd className="text-gray-800">{formatDateTime(trip.departureAt)}</dd>
          </div>
        </dl>
      </section>

      {/* Passagers */}
      <section
        className="bg-white rounded-xl border border-gray-200 p-4"
        aria-labelledby="booking-passengers"
      >
        <h2
          id="booking-passengers"
          className="text-sm font-semibold text-brand-dark uppercase tracking-wide mb-3"
        >
          {t.bookingDetail.passengers}
        </h2>
        <ul className="space-y-2" role="list">
          {booking.passengers.map((p, i) => (
            <li
              key={i}
              className="flex items-center justify-between text-sm"
            >
              <div>
                <span className="font-medium">
                  {p.firstName} {p.lastName}
                </span>
                <span className="text-gray-500 ml-2">— {t.booking.seat} {p.seatCode}</span>
              </div>
              <Badge
                variant={
                  p.boardingStatus === 'BOARDED'
                    ? 'success'
                    : p.boardingStatus === 'ABSENT'
                    ? 'error'
                    : 'neutral'
                }
              >
                {t.bookingDetail.boardingStatus[p.boardingStatus]}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      {/* Résumé financier */}
      <section
        className="bg-white rounded-xl border border-gray-200 p-4 space-y-1"
        aria-labelledby="booking-finance"
      >
        <h2
          id="booking-finance"
          className="text-sm font-semibold text-brand-dark uppercase tracking-wide mb-2"
        >
          {t.booking.total}
        </h2>
        <div className="text-sm space-y-1">
          <div className="flex justify-between text-gray-600">
            <span>{t.booking.subtotal}</span>
            <span className="tabular-nums">
              {formatMGA(booking.seatSubtotalMga)} {t.common.ariary}
            </span>
          </div>
          {booking.platformFeeMga > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>{t.booking.platformFee}</span>
              <span className="tabular-nums">
                {formatMGA(booking.platformFeeMga)} {t.common.ariary}
              </span>
            </div>
          )}
          <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200">
            <span>{t.booking.total}</span>
            <span className="tabular-nums">
              {formatMGA(booking.totalAmountMga)} {t.common.ariary}
            </span>
          </div>
        </div>

        {/* Statuts de paiement */}
        {booking.payments.length > 0 && (
          <div className="pt-3 space-y-1">
            {booking.payments.map((payment) => (
              <div
                key={payment.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-gray-500">{payment.provider}</span>
                <Badge variant={paymentStatusVariant(payment.status)}>
                  {payment.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Billet QR — affiché uniquement si réservation confirmée */}
      {booking.ticket && booking.status === 'CONFIRMED' && (
        <section
          className="bg-white rounded-xl border border-brand p-4 text-center"
          aria-labelledby="booking-ticket"
        >
          <h2
            id="booking-ticket"
            className="text-sm font-semibold text-brand-dark uppercase tracking-wide mb-3"
          >
            {t.bookingDetail.ticket}
          </h2>

          {booking.ticket.qrPayload && (
            <div className="flex justify-center mb-3">
              <QrCodeCanvas
                payload={booking.ticket.qrPayload}
                size={200}
                alt={`QR code billet ${booking.reference}`}
                downloadFilename={`qr-${booking.reference}`}
                downloadLabel={t.bookingDetail.downloadPng}
              />
            </div>
          )}

          <p className="font-mono text-2xl font-bold text-brand-dark tracking-widest">
            {booking.reference}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {t.bookingDetail.showQR}
          </p>

          {/* Télécharger le billet PDF */}
          <a
            href={`/api/proxy/v1/bookings/${bookingId}/ticket.pdf`}
            download={`billet-${booking.reference}.pdf`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            ↓ {t.bookingDetail.downloadPdf}
          </a>

          {/* Renvoi SMS */}
          <ResendSMSButton
            bookingId={bookingId}
            labels={{
              send: t.bookingDetail.resendSMS,
              success: t.bookingDetail.resendSMSSuccess,
              error: t.common.errorNetwork,
            }}
          />
        </section>
      )}

      {/* Message si en attente de paiement */}
      {booking.status === 'PENDING_PAYMENT' && (
        <div
          className="bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-xl p-4 text-sm text-center"
          role="status"
        >
          {t.booking.paymentPending}
        </div>
      )}

      {/* Notation — visible uniquement si voyage terminé */}
      {booking.canRate && (
        <section
          className="bg-white rounded-xl border border-gray-200 p-4"
          aria-labelledby="booking-rating"
        >
          <h2
            id="booking-rating"
            className="text-sm font-semibold text-brand-dark uppercase tracking-wide mb-3 text-center"
          >
            {t.bookingDetail.rateTitle}
          </h2>
          <RatingForm
            bookingId={booking.id}
            alreadyRated={booking.hasRated}
            labels={{
              rateTitle: t.bookingDetail.rateTitle,
              rateSubtitle: t.bookingDetail.rateSubtitle,
              rateSubmit: t.bookingDetail.rateSubmit,
              rateSubmitting: t.bookingDetail.rateSubmitting,
              rateSuccess: t.bookingDetail.rateSuccess,
              rateAlreadyDone: t.bookingDetail.rateAlreadyDone,
              rateCommentPlaceholder: t.bookingDetail.rateCommentPlaceholder,
            }}
          />
        </section>
      )}
    </div>
  );
}
