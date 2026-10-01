'use client';

import { useState } from 'react';

interface ResendSMSButtonProps {
  bookingId: string;
  labels: { send: string; success: string; error: string };
}

export function ResendSMSButton({ bookingId, labels }: ResendSMSButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleClick = async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/proxy/v1/bookings/${bookingId}/resend-ticket`, {
        method: 'POST',
      });
      setState(res.ok ? 'success' : 'error');
    } catch {
      setState('error');
    }
  };

  if (state === 'success') {
    return (
      <p className="text-sm text-green-600 mt-4" role="status">
        {labels.success}
      </p>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === 'loading'}
        className="text-sm text-brand underline hover:no-underline disabled:opacity-50"
      >
        {state === 'loading' ? '…' : labels.send}
      </button>
      {state === 'error' && (
        <p className="text-xs text-red-600 mt-1" role="alert">
          {labels.error}
        </p>
      )}
    </div>
  );
}
