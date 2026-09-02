'use client';

/**
 * Formulaire de paiement Mobile Money.
 *
 * Flux :
 * 1. Saisie des infos passagers (firstName, lastName, seatCode).
 * 2. Sélection du moyen de paiement (MVola / Orange Money).
 * 3. Saisie du numéro de téléphone payeur.
 * 4. Soumission → POST /api/proxy/v1/bookings → POST /api/proxy/v1/payments.
 * 5. Affichage des instructions de paiement (USSD) + état de chargement.
 * 6. En attente de confirmation (via WS sur booking:{userId}).
 *
 * États obligatoires :
 * - Chargement : spinner, inputs désactivés.
 * - Erreur réseau : message explicite (connexion 3G instable = cas fréquent).
 * - Instructions USSD : affichage en grand pour composition téléphonique.
 *
 * LE BOUTON "Confirmer le paiement" EST VERT (#9CC43D) — variante 'action'.
 */

import { useState, useEffect, useId, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useTranslations } from '@/components/TranslationsProvider';
import { useWebSocket } from '@/lib/ws';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import type {
  Booking,
  PaymentInitiation,
  SeatHoldResponse,
  WsEvent,
  PaymentProvider,
} from '@/lib/types';

interface PassengerFormData {
  firstName: string;
  lastName: string;
  phone: string;
  nationalIdRef: string;
  seatCode: string;
}

interface PaymentFormProps {
  holdId: string;
  holdSeats: SeatHoldResponse['seats'];
  lang: string;
  /** Ticket JWT court pour la souscription WS (null si non utilisé ici) */
  wsToken: string | null;
  /** userId pour le canal booking:{userId} */
  userId: string | null;
}

// ─── Validation Zod ───────────────────────────────────────────────────────────
const passengerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  nationalIdRef: z.string().optional(),
  seatCode: z.string().min(1),
});

const paymentSchema = z.object({
  provider: z.enum(['MVOLA', 'ORANGE_MONEY']),
  payerPhone: z.string().min(10),
});

type PaymentStep = 'form' | 'instructions' | 'confirmed' | 'failed';

export function PaymentForm({
  holdId,
  holdSeats,
  lang,
  wsToken,
  userId,
}: PaymentFormProps) {
  const t = useTranslations();
  const router = useRouter();

  // ─── État formulaire ────────────────────────────────────────────────────────
  const [passengers, setPassengers] = useState<PassengerFormData[]>(
    holdSeats.map((s) => ({
      firstName: '',
      lastName: '',
      phone: '',
      nationalIdRef: '',
      seatCode: s.code,
    })),
  );
  const [provider, setProvider] = useState<PaymentProvider>('MVOLA');
  const [payerPhone, setPayerPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ─── État de la requête ─────────────────────────────────────────────────────
  const [step, setStep] = useState<PaymentStep>('form');
  const [isLoading, setIsLoading] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [paymentData, setPaymentData] = useState<PaymentInitiation | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);

  // ─── WebSocket — écouter confirmation paiement ──────────────────────────────
  const wsChannel = userId ? `booking:${userId}` : '';
  const { lastEvent } = useWebSocket(wsChannel, wsToken);

  // Traiter les événements WS de confirmation de paiement
  useEffect(() => {
    if (!lastEvent || !bookingId) return;
    const ev = lastEvent as WsEvent & {
      payload: { bookingId?: string };
    };
    if (ev.payload?.bookingId !== bookingId) return;

    if (ev.event === 'PAYMENT_CONFIRMED') {
      setStep('confirmed');
      setTimeout(() => {
        router.push(`/${lang}/bookings/${bookingId}`);
      }, 1500);
    } else if (ev.event === 'PAYMENT_FAILED') {
      setStep('failed');
      setNetworkError(t.booking.errorPayment);
    }
  }, [lastEvent, bookingId, lang, router, t.booking.errorPayment]);

  const providerFieldId = useId();
  const payerPhoneFieldId = useId();

  // ─── Validation ─────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};

    passengers.forEach((p, i) => {
      const result = passengerSchema.safeParse(p);
      if (!result.success) {
        result.error.issues.forEach((issue) => {
          errs[`p${i}_${issue.path[0]}`] = issue.message;
        });
        if (!p.firstName) errs[`p${i}_firstName`] = t.auth.errorEmailRequired;
        if (!p.lastName) errs[`p${i}_lastName`] = t.auth.errorEmailRequired;
      }
    });

    const paymentResult = paymentSchema.safeParse({ provider, payerPhone });
    if (!paymentResult.success) {
      if (!payerPhone || payerPhone.length < 10) {
        errs.payerPhone =
          lang === 'fr'
            ? 'Numéro de téléphone requis (min. 10 chiffres)'
            : 'Laharana finday ilaina (10 tarehimandry farafahakeliny)';
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ─── Soumission ──────────────────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate() || isLoading) return;

    setIsLoading(true);
    setNetworkError(null);

    try {
      // Étape 1 : Créer la réservation (Booking PENDING_PAYMENT)
      const bookingRes = await fetch('/api/proxy/v1/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdId,
          passengers: passengers.map((p) => ({
            firstName: p.firstName,
            lastName: p.lastName,
            phone: p.phone || undefined,
            nationalIdRef: p.nationalIdRef || undefined,
            seatCode: p.seatCode,
          })),
          contactPhone: payerPhone,
          preferredLang: lang,
        }),
      });

      if (!bookingRes.ok) {
        if (bookingRes.status === 409) {
          setNetworkError(t.booking.errorHoldExpired);
          return;
        }
        throw new Error(`Booking failed: ${bookingRes.status}`);
      }

      const booking = (await bookingRes.json()) as Booking;
      setBookingId(booking.id);

      // Étape 2 : Initier le paiement
      const paymentRes = await fetch('/api/proxy/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          provider,
          payerPhone,
        }),
      });

      if (!paymentRes.ok) {
        if (paymentRes.status === 409) {
          setNetworkError(t.booking.paymentExpired);
        } else {
          throw new Error(`Payment init failed: ${paymentRes.status}`);
        }
        return;
      }

      const payInit = (await paymentRes.json()) as PaymentInitiation;
      setPaymentData(payInit);
      setStep('instructions');
    } catch (err) {
      if (
        err instanceof TypeError &&
        err.message.toLowerCase().includes('fetch')
      ) {
        setNetworkError(t.booking.errorNetwork);
      } else {
        setNetworkError(t.common.errorServer);
      }
    } finally {
      setIsLoading(false);
    }
  }

  // ─── Rendu : Étape instructions ─────────────────────────────────────────────
  if (step === 'instructions' && paymentData) {
    const instruction =
      lang === 'mg'
        ? paymentData.instructions.messageMg
        : paymentData.instructions.messageFr;

    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <h2 className="text-lg font-semibold text-gray-900">
          {t.booking.paymentInstructions}
        </h2>

        <p className="text-sm text-gray-600">{instruction}</p>

        {paymentData.instructions.ussdCode && (
          <div className="bg-brand-dark text-white rounded-xl p-4 text-center">
            <p className="text-xs text-white/70 mb-1">
              {t.booking.ussdCode}
            </p>
            <p
              className="text-3xl font-bold tracking-widest tabular-nums"
              aria-label={t.booking.ussdInstructions}
            >
              {paymentData.instructions.ussdCode}
            </p>
            <p className="text-xs text-white/70 mt-1">
              {t.booking.ussdInstructions}
            </p>
          </div>
        )}

        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 text-sm text-gray-600"
        >
          <svg
            className="animate-spin h-5 w-5 text-brand shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          {t.booking.paymentPending}
        </div>
      </div>
    );
  }

  // ─── Rendu : Confirmation ────────────────────────────────────────────────────
  if (step === 'confirmed') {
    return (
      <div
        role="status"
        className="bg-green-50 border border-green-400 text-green-800 rounded-xl p-5 text-center"
      >
        <p className="text-xl font-bold">{t.booking.paymentSuccess}</p>
        <p className="text-sm mt-1">{t.booking.bookingConfirmed}</p>
      </div>
    );
  }

  // ─── Rendu : Formulaire principal ────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {/* Erreur réseau — affiché en haut du formulaire */}
      {networkError && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-red-50 border border-red-400 text-red-700 rounded-lg px-4 py-3 text-sm"
        >
          {networkError}
        </div>
      )}

      {/* Passagers */}
      {passengers.map((passenger, index) => (
        <section
          key={holdSeats[index]?.seatDefinitionId ?? index}
          className="bg-white rounded-xl border border-gray-200 p-4 space-y-3"
          aria-labelledby={`passenger-heading-${index}`}
        >
          <h2
            id={`passenger-heading-${index}`}
            className="text-sm font-semibold text-brand-dark"
          >
            {t.booking.passengerSection.replace('{n}', String(index + 1))}
            <span className="text-gray-400 font-normal ml-2">
              — {t.booking.seat} {passenger.seatCode}
            </span>
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t.booking.firstName}
              value={passenger.firstName}
              onChange={(e) => {
                const next = [...passengers];
                next[index] = { ...next[index], firstName: e.target.value };
                setPassengers(next);
              }}
              error={errors[`p${index}_firstName`]}
              required
              autoComplete="given-name"
            />
            <Input
              label={t.booking.lastName}
              value={passenger.lastName}
              onChange={(e) => {
                const next = [...passengers];
                next[index] = { ...next[index], lastName: e.target.value };
                setPassengers(next);
              }}
              error={errors[`p${index}_lastName`]}
              required
              autoComplete="family-name"
            />
          </div>

          <Input
            label={t.booking.phone}
            type="tel"
            value={passenger.phone}
            onChange={(e) => {
              const next = [...passengers];
              next[index] = { ...next[index], phone: e.target.value };
              setPassengers(next);
            }}
            autoComplete="tel"
          />

          <Input
            label={t.booking.nationalId}
            value={passenger.nationalIdRef}
            onChange={(e) => {
              const next = [...passengers];
              next[index] = { ...next[index], nationalIdRef: e.target.value };
              setPassengers(next);
            }}
          />
        </section>
      ))}

      {/* Paiement */}
      <section
        className="bg-white rounded-xl border border-gray-200 p-4 space-y-4"
        aria-labelledby="payment-heading"
      >
        <h2
          id="payment-heading"
          className="text-sm font-semibold text-brand-dark"
        >
          {t.booking.paymentMethod}
        </h2>

        {/* Sélecteur de provider */}
        <fieldset>
          <legend className="sr-only">{t.booking.paymentMethod}</legend>
          <div className="flex gap-3">
            {(['MVOLA', 'ORANGE_MONEY'] as const).map((p) => (
              <label
                key={p}
                className={[
                  'flex-1 border-2 rounded-lg p-3 cursor-pointer text-center text-sm font-medium transition-colors',
                  provider === p
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-gray-200 text-gray-600 hover:border-brand/40',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="provider"
                  value={p}
                  checked={provider === p}
                  onChange={() => setProvider(p)}
                  className="sr-only"
                />
                {p === 'MVOLA' ? t.booking.mvola : t.booking.orangeMoney}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Numéro payeur */}
        <Input
          id={payerPhoneFieldId}
          label={t.booking.payerPhone}
          type="tel"
          value={payerPhone}
          placeholder={t.booking.payerPhonePlaceholder}
          onChange={(e) => setPayerPhone(e.target.value)}
          error={errors.payerPhone}
          required
          autoComplete="tel"
          inputMode="tel"
        />
      </section>

      {/* Bouton confirmer — VERT TRANSACTIONNEL */}
      <Button
        type="submit"
        variant="action"
        size="lg"
        fullWidth
        isLoading={isLoading}
        disabled={isLoading}
      >
        {isLoading ? t.booking.paying : t.booking.payButton}
      </Button>
    </form>
  );
}

export default PaymentForm;
