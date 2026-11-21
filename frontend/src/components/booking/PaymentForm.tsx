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

import { useState, useEffect, useRef, useId, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useTranslations } from '@/components/TranslationsProvider';
import { useWebSocket } from '@/lib/ws';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import PhoneInput from '@/components/ui/PhoneInput';
import type {
  Booking,
  Me,
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
  tripId: string;
  holdSeats: SeatHoldResponse['seats'];
  lang: string;
  /** Ticket JWT court pour la souscription WS (null si non utilisé ici) */
  wsToken: string | null;
  /** userId pour le canal booking:{userId} */
  userId: string | null;
  /** Profil du compte connecté — pré-remplit le premier siège */
  ownerProfile?: Me | null;
  /** Mode sandbox GoalPay — confirmation automatique au retour sur l'onglet */
  isSandbox?: boolean;
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
  provider: z.enum(['MVOLA', 'ORANGE_MONEY', 'GOALPAY']),
  payerPhone: z.string().optional(),
});

type PaymentStep = 'form' | 'instructions' | 'goalpay_pending' | 'confirmed' | 'failed';

export function PaymentForm({
  holdId,
  tripId,
  holdSeats,
  lang,
  wsToken,
  userId,
  ownerProfile,
  isSandbox,
}: PaymentFormProps) {
  const t = useTranslations();
  const router = useRouter();

  // ─── État formulaire ────────────────────────────────────────────────────────
  const [passengers, setPassengers] = useState<PassengerFormData[]>(
    holdSeats.map((s, i) => ({
      firstName: i === 0 ? (ownerProfile?.traveler?.firstName ?? '') : '',
      lastName:  i === 0 ? (ownerProfile?.traveler?.lastName  ?? '') : '',
      phone:     i === 0 ? (ownerProfile?.phone ?? '') : '',
      nationalIdRef: '',
      seatCode: s.code,
    })),
  );
  const [provider, setProvider] = useState<PaymentProvider>('MVOLA');
  const [payerPhone, setPayerPhone] = useState(
    ownerProfile?.traveler?.mobileMoneyPhone ?? ownerProfile?.phone ?? '',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ─── État de la requête ─────────────────────────────────────────────────────
  const [step, setStep] = useState<PaymentStep>('form');
  const [isLoading, setIsLoading] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [paymentData, setPaymentData] = useState<PaymentInitiation | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [goalpayPaymentId, setGoalpayPaymentId] = useState<string | null>(null);
  const confirmFiredRef = useRef(false);

  // ─── Libération automatique du hold à l'abandon ────────────────────────────
  // Garde les valeurs dans des refs pour éviter les stale closures du cleanup.
  const stepRef = useRef<PaymentStep>('form');
  const holdReleaseRef = useRef({ tripId, holdId });

  useEffect(() => { stepRef.current = step; }, [step]);

  useEffect(() => {
    holdReleaseRef.current = { tripId, holdId };
  }, [tripId, holdId]);

  useEffect(() => {
    return () => {
      // En dev, le HMR et la compilation lazy déclenchent un démontage parasite
      // qui libèrerait le hold avant soumission — on désactive en dev.
      if (process.env.NODE_ENV !== 'production') return;

      // Ne pas libérer si le paiement est déjà en attente ou confirmé
      const s = stepRef.current;
      if (s === 'instructions' || s === 'confirmed') return;

      const { tripId: t, holdId: h } = holdReleaseRef.current;
      fetch(`/api/proxy/v1/trips/${t}/seats/hold/${h}`, {
        method: 'DELETE',
        keepalive: true,
      }).catch(() => {});
    };
  }, []); // Exécuté uniquement au démontage

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

  // ─── GoalPay : polling statut paiement toutes les 3s ───────────────────────
  useEffect(() => {
    if (step !== 'goalpay_pending' || !goalpayPaymentId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/proxy/v1/payments/${goalpayPaymentId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { status: string; booking?: { id: string } };
        if (data.status === 'CONFIRMED') {
          clearInterval(interval);
          setStep('confirmed');
          const bid = bookingId;
          if (bid) setTimeout(() => router.push(`/${lang}/bookings/${bid}`), 1200);
        }
      } catch { /* silencieux */ }
    }, 3000);

    return () => clearInterval(interval);
  }, [step, goalpayPaymentId, bookingId, lang, router]);

  // ─── Sandbox : auto-simulate pour Mvola/Orange Money après 3s ──────────────
  useEffect(() => {
    if (step !== 'instructions' || !isSandbox || !bookingId) return;

    const timer = setTimeout(async () => {
      try {
        await fetch('/api/proxy/v1/dev/payments/simulate-success', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId }),
        });
      } catch { /* Le WS détectera */ }
    }, 3000);

    return () => clearTimeout(timer);
  }, [step, isSandbox, bookingId]);

  // ─── GoalPay sandbox : simulate-success au retour sur l'onglet ─────────────
  useEffect(() => {
    if (step !== 'goalpay_pending' || !isSandbox || !bookingId) return;

    const handleVisibility = async () => {
      if (document.hidden) return;
      if (confirmFiredRef.current) return;
      confirmFiredRef.current = true;
      try {
        await fetch('/api/payments/goalpay-callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId }),
        });
      } catch { /* le polling détectera */ }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [step, isSandbox, bookingId]);

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

    // GoalPay : pas de numéro requis (géré côté GoalPay)
    if (provider !== 'GOALPAY') {
      const localDigits = payerPhone.startsWith('+261')
        ? payerPhone.slice(4).replace(/\D/g, '')
        : payerPhone.replace(/\D/g, '');
      if (localDigits.length < 9) {
        errs.payerPhone =
          lang === 'fr'
            ? 'Numéro invalide (ex. 34 00 000 00)'
            : 'Laharana diso (ohatra : 34 00 000 00)';
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
          preferredLang: lang.toUpperCase(),
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
      if (provider === 'GOALPAY') {
        const returnUrl = `${window.location.origin}/${lang}/payment/success?bookingId=${booking.id}`;
        const gpRes = await fetch('/api/proxy/v1/payments/goalpay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.id, returnUrl }),
        });
        if (!gpRes.ok) {
          throw new Error(`GoalPay init failed: ${gpRes.status}`);
        }
        const gpData = (await gpRes.json()) as { checkoutUrl: string; paymentId: string };
        confirmFiredRef.current = false;
        setGoalpayPaymentId(gpData.paymentId);
        window.open(gpData.checkoutUrl, '_blank', 'noopener,noreferrer');
        setStep('goalpay_pending');
        return;
      }

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

    const showSimulate = process.env.NODE_ENV === 'development' || isSandbox;

    const handleDevSimulate = async () => {
      if (!bookingId) return;
      try {
        await fetch('/api/proxy/v1/dev/payments/simulate-success', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId }),
        });
      } catch { /* le WS prend le relais */ }
    };

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

        {showSimulate && (
          <button
            type="button"
            onClick={handleDevSimulate}
            className="w-full mt-2 py-2.5 rounded-lg border-2 border-dashed border-amber-400 text-amber-700 bg-amber-50 text-sm font-semibold hover:bg-amber-100 transition-colors"
          >
            🧪 [DEV] Simuler paiement reçu
          </button>
        )}
      </div>
    );
  }

  // ─── Rendu : Attente GoalPay ─────────────────────────────────────────────────
  if (step === 'goalpay_pending') {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-3 text-center">
        <div className="flex items-center justify-center gap-2 text-blue-800 font-medium">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" aria-hidden="true" />
          En attente de confirmation du paiement…
        </div>
        <p className="text-xs text-blue-600">
          Complète le paiement dans l&apos;onglet GoalPay. Cette page se met à jour automatiquement.
        </p>
        <button
          type="button"
          onClick={() => {
            if (goalpayPaymentId) {
              window.open(`https://goalpay.pro`, '_blank', 'noopener,noreferrer');
            }
          }}
          className="text-xs text-blue-700 underline hover:text-blue-900"
        >
          Réouvrir GoalPay
        </button>
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
          <div className="flex items-center justify-between flex-wrap gap-1">
            <h2
              id={`passenger-heading-${index}`}
              className="text-sm font-semibold text-brand-dark"
            >
              {t.booking.passengerSection.replace('{n}', String(index + 1))}
              <span className="text-gray-400 font-normal ml-2">
                — {t.booking.seat} {passenger.seatCode}
              </span>
            </h2>
            {index === 0 && ownerProfile?.traveler && (
              <span className="text-xs text-brand bg-brand/10 px-2 py-0.5 rounded-full">
                {lang === 'mg' ? 'Ny anao' : 'Votre compte'}
              </span>
            )}
          </div>

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

          <PhoneInput
            label={t.booking.phone}
            value={passenger.phone}
            onChange={(value) => {
              const next = [...passengers];
              next[index] = { ...next[index], phone: value };
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
          <div className="flex gap-2 flex-wrap">
            {(['MVOLA', 'ORANGE_MONEY', 'GOALPAY'] as const).map((p) => (
              <label
                key={p}
                className={[
                  'flex-1 min-w-[90px] border-2 rounded-lg p-3 cursor-pointer text-center text-sm font-medium transition-colors',
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
                  onChange={() => setProvider(p as PaymentProvider)}
                  className="sr-only"
                />
                {p === 'MVOLA' ? t.booking.mvola
                  : p === 'ORANGE_MONEY' ? t.booking.orangeMoney
                  : (
                    <span className="flex flex-col items-center gap-0.5">
                      <span>{t.booking.goalpay}</span>
                      <span className="text-[10px] font-normal opacity-70">{t.booking.goalpaySubtitle}</span>
                    </span>
                  )
                }
              </label>
            ))}
          </div>
        </fieldset>

        {provider !== 'GOALPAY' && (
          <PhoneInput
            id={payerPhoneFieldId}
            label={t.booking.payerPhone}
            value={payerPhone}
            onChange={setPayerPhone}
            error={errors.payerPhone}
            required
            autoComplete="tel"
          />
        )}

        {provider === 'GOALPAY' && (
          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            {lang === 'fr'
              ? 'Vous serez redirigé vers la page de paiement GoalPay (MVola · Orange · Airtel acceptés).'
              : 'Haverina any amin\'ny pejin\'ny fandoavana GoalPay ianao (MVola · Orange · Airtel).'}
          </p>
        )}
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
