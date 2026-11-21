'use client';

import { useState } from 'react';
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

export function GoalPayButton({ bookingId, lang, isSandbox, labels }: GoalPayButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const returnUrl = `${window.location.origin}/${lang}/payment/success?bookingId=${bookingId}`;
      const res = await fetch('/api/proxy/v1/payments/goalpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, returnUrl }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as { checkoutUrl: string };
      // Ouvrir dans un nouvel onglet pour permettre le retour sur cette page
      window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer');
      setCheckoutOpened(true);
    } catch {
      setError(labels.error);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch('/api/payments/goalpay-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      router.push(`/${lang}/payment/success`);
    } catch {
      setError('Erreur lors de la confirmation. Réessaie.');
      setConfirming(false);
    }
  }

  if (checkoutOpened) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 text-center">
          <p className="font-medium">Paiement GoalPay ouvert dans un nouvel onglet</p>
          <p className="text-xs text-blue-600 mt-1">Complète le paiement dans l&apos;onglet GoalPay, puis reviens ici.</p>
        </div>

        {isSandbox && (
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-action px-4 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {confirming ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
                Confirmation en cours…
              </>
            ) : (
              <>✓ J&apos;ai payé sur GoalPay — Confirmer</>
            )}
          </button>
        )}

        <button
          onClick={() => setCheckoutOpened(false)}
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
