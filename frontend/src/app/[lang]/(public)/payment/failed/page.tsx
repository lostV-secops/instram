import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, isValidLang } from '@/lib/i18n';

interface PageProps {
  params: { lang: string };
  searchParams: { bookingId?: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);
  return { title: t.paymentResult.failedTitle };
}

export default function PaymentFailedPage({ params, searchParams }: PageProps) {
  const { lang } = params;
  if (!isValidLang(lang)) return null;
  const t = getTranslations(lang);
  const { bookingId } = searchParams;

  return (
    <div className="max-w-sm mx-auto text-center space-y-6 py-16 px-4">
      <div
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          className="h-8 w-8 text-red-500"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>

      <div className="space-y-2">
        <h1 className="text-xl font-bold text-gray-900">{t.paymentResult.failedTitle}</h1>
        <p className="text-sm text-gray-600">{t.paymentResult.failedMessage}</p>
      </div>

      <div className="flex flex-col gap-3">
        {bookingId && (
          <Link
            href={`/${lang}/bookings/${bookingId}`}
            className="inline-flex items-center justify-center rounded-xl bg-action px-6 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
          >
            {t.paymentResult.tryAgain}
          </Link>
        )}
        <Link
          href={`/${lang}/bookings`}
          className="inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
        >
          {t.paymentResult.backToBookings}
        </Link>
      </div>
    </div>
  );
}
