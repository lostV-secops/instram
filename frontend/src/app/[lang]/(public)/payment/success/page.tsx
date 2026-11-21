import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { GoalPayAutoConfirm } from './GoalPayAutoConfirm';

interface PageProps {
  params: { lang: string };
  searchParams: { bookingId?: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);
  return { title: t.paymentResult.successTitle };
}

export default function PaymentSuccessPage({ params, searchParams }: PageProps) {
  const { lang } = params;
  if (!isValidLang(lang)) return null;
  const t = getTranslations(lang);
  const { bookingId } = searchParams;

  return (
    <div className="max-w-sm mx-auto text-center space-y-6 py-16 px-4">
      {bookingId && <GoalPayAutoConfirm bookingId={bookingId} />}

      <div
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-action/10"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          className="h-8 w-8 text-action"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>

      <div className="space-y-2">
        <h1 className="text-xl font-bold text-gray-900">{t.paymentResult.successTitle}</h1>
        <p className="text-sm text-gray-600">{t.paymentResult.successMessage}</p>
      </div>

      <Link
        href={`/${lang}/bookings`}
        className="inline-flex items-center justify-center rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
      >
        {t.paymentResult.backToBookings}
      </Link>
    </div>
  );
}
