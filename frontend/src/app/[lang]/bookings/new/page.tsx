/**
 * Page de création de réservation — /fr/bookings/new?holdId=...&tripId=...
 * Auth requise (enforced par middleware).
 *
 * Server Component : charge le détail du trajet + les sièges du hold.
 * Délègue la logique paiement au Client Component PaymentForm.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { apiGet } from '@/lib/api';
import { getAccessToken, COOKIE_USER_INFO, parseUserInfoCookie } from '@/lib/auth';
import { cookies } from 'next/headers';
import { BookingSummary } from '@/components/booking/BookingSummary';
import { PaymentForm } from '@/components/booking/PaymentForm';
import type { TripInstanceDetail, SeatHoldResponse, Lang } from '@/lib/types';
import { AppError } from '@/lib/api';

interface PageProps {
  params: { lang: string };
  searchParams: {
    holdId?: string;
    tripId?: string;
    expiresAt?: string;
  };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);
  return { title: t.booking.title };
}

export default async function BookingNewPage({
  params,
  searchParams,
}: PageProps) {
  const { lang } = params;
  if (!isValidLang(lang)) return null;

  const t = getTranslations(lang);
  const { holdId, tripId, expiresAt } = searchParams;

  // Paramètres manquants → retour accueil
  if (!holdId || !tripId) {
    redirect(`/${lang}`);
  }

  // Récupérer l'userId pour le canal WS booking:{userId}
  const cookieStore = cookies();
  const userInfoRaw = cookieStore.get(COOKIE_USER_INFO)?.value;
  const userInfo = parseUserInfoCookie(userInfoRaw);

  // Ticket WS pour la confirmation de paiement
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
      // Pas de WS — PaymentForm fonctionnera sans confirmation temps réel
    }
  }

  // Charger le détail du trajet
  let trip: TripInstanceDetail | null = null;
  let tripError = false;
  try {
    trip = await apiGet<TripInstanceDetail>(`/trips/${tripId}`, {
      acceptLang: lang,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof AppError && err.status === 404) {
      redirect(`/${lang}`);
    }
    tripError = true;
  }

  if (tripError || !trip) {
    return (
      <div className="text-center py-16">
        <p className="text-red-600 mb-4">{t.common.errorNetwork}</p>
        <Link href={`/${lang}/trips/${tripId}`} className="text-brand underline">
          {t.common.back}
        </Link>
      </div>
    );
  }

  // Construire un objet SeatHoldResponse minimal depuis les query params
  // (les sièges réels sont dans le hold — le backend valide à la création du booking)
  // Ici on reconstruit un résumé pour l'affichage uniquement.
  const holdProxy: SeatHoldResponse = {
    holdId,
    tripInstanceId: tripId,
    seats: trip.fares.map((fare, i) => ({
      seatDefinitionId: `placeholder-${i}`,
      code: `?`,
      priceMga: fare.priceMga,
    })),
    expiresAt: expiresAt ?? new Date(Date.now() + 120_000).toISOString(),
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Navigation */}
      <Link
        href={`/${lang}/trips/${tripId}`}
        className="text-brand text-sm hover:underline inline-flex items-center gap-1"
      >
        ← {t.common.back}
      </Link>

      <h1 className="text-xl font-bold text-gray-900">{t.booking.title}</h1>

      {/* Récapitulatif (Server Component) */}
      <BookingSummary trip={trip} hold={holdProxy} t={t} />

      {/* Formulaire de paiement (Client Component) */}
      <PaymentForm
        holdId={holdId}
        holdSeats={holdProxy.seats}
        lang={lang}
        wsToken={wsToken}
        userId={userInfo?.id ?? null}
      />
    </div>
  );
}
