'use client';

import { useState } from 'react';

interface GoalPayButtonProps {
  bookingId: string;
  lang: string;
  labels: {
    pay: string;
    sub: string;
    loading: string;
    error: string;
  };
}

export function GoalPayButton({ bookingId, lang, labels }: GoalPayButtonProps) {
  const [loading, setLoading] = useState(false);
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
      window.location.href = data.checkoutUrl;
    } catch {
      setError(labels.error);
      setLoading(false);
    }
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
