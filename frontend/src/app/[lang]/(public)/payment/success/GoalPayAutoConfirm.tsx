'use client';

import { useEffect } from 'react';

interface Props {
  bookingId: string;
}

export function GoalPayAutoConfirm({ bookingId }: Props) {
  useEffect(() => {
    fetch('/api/payments/goalpay-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId }),
    }).catch(() => {
      // Silencieux — en production le webhook GoalPay prend le relais
    });
  }, [bookingId]);

  return null;
}
