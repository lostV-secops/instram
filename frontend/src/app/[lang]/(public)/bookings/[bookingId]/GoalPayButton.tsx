'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface GoalPayButtonProps {
  bookingId: string;
  lang: string;
  isSandbox?: boolean;
  labels: {
    pay: string;
    sub: string;
    loading: string;
    error: string;
  };
}

export function GoalPayButton({ bookingId, lang, isSandbox: isSandboxProp, labels }: GoalPayButtonProps) {
  const isSandbox = process.env.NEXT_PUBLIC_GOALPAY_SANDBOX === 'true' || isSandboxProp === true;
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paymentIdRef = useRef<string | null>(null);
  const confirmFiredRef = useRef(false);

  // Polling : vérifie le statut du paiement toutes les 3s
  useEffect(() => {
    if (!checkoutOpened) return;

    const interval = setInterval(async () => {
      const pid = paymentIdRef.current;
      if (!pid) return;
      try {
        const res = await fetch(`/api/proxy/v1/payments/${pid}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { status: string };
        if (data.status === 'CONFIRMED') {
          clearInterval(interval);
          router.push(`/${lang}/bookings/${bookingId}`);
          router.refresh();
        }
      } catch {
        // Silencieux — on réessaie au prochain tick
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [checkoutOpened, lang, router]);

  // Sandbox : quand l'utilisateur revient sur cet onglet → simulate-success
  useEffect(() => {
    if (!checkoutOpened || !isSandbox) return;

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
      } catch {
        // Le polling détectera l'état
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [checkoutOpened, isSandbox, bookingId]);

  async function handleClick() {
    setLoading(true);
    setError(null);
    confirmFiredRef.current = false;
    try {
      const returnUrl = `${window.location.origin}/${lang}/payment/success?bookingId=${bookingId}`;
      const res = await fetch('/api/proxy/v1/payments/goalpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, returnUrl }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as { checkoutUrl: string; paymentId: string };
      paymentIdRef.current = data.paymentId;
      window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer');
      setCheckoutOpened(true);
    } catch {
      setError(labels.error);
    } finally {
      setLoading(false);
    }
  }

  if (checkoutOpened) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 text-center">
          <div className="flex items-center justify-center gap-2 font-medium">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" aria-hidden="true" />
            En attente de confirmation du paiement…
          </div>
          <p className="text-xs text-blue-600 mt-1">
            Complète le paiement dans l&apos;onglet GoalPay. Cette page se met à jour automatiquement.
          </p>
        </div>

        <button
          onClick={() => { setCheckoutOpened(false); confirmFiredRef.current = false; }}
          className="w-full text-xs text-gray-500 underline hover:text-gray-700"
        >
          Réouvrir GoalPay
        </button>

        {error && (
          <p role="alert" className="text-center text-xs text-red-600">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-action px-4 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        aria-busy={loading}
      >
        {loading ? (
          <>
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
            {labels.loading}
          </>
        ) : (
          <>
            <span aria-hidden="true">💳</span>
            {labels.pay}
          </>
        )}
      </button>
      <p className="text-center text-xs text-gray-500">{labels.sub}</p>
      {error && (
        <p role="alert" className="text-center text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
