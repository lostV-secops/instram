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
  return { title: t.paymentResult.canceledTitle };
}

export default function PaymentCanceledPage({ params, searchParams }: PageProps) {
  const { lang } = params;
  if (!isValidLang(lang)) return null;
  const t = getTranslations(lang);
  const { bookingId } = searchParams;

  return (
    <div className="max-w-sm mx-auto text-center space-y-6 py-16 px-4">
      <div
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          className="h-8 w-8 text-yellow-500"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>

      <div className="space-y-2">
        <h1 className="text-xl font-bold text-gray-900">{t.paymentResult.canceledTitle}</h1>
        <p className="text-sm text-gray-600">{t.paymentResult.canceledMessage}</p>
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
