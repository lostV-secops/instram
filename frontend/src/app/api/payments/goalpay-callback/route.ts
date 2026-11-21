/**
 * POST /api/payments/goalpay-callback
 * Appelé par la page /payment/success après redirection GoalPay.
 * En mode sandbox (GOALPAY_SANDBOX=true), simule la confirmation du paiement.
 * En production, retourne 200 silencieusement (le webhook GoalPay prend le relais).
 */

import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_ACCESS } from '@/lib/auth';

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const isSandbox = process.env.GOALPAY_SANDBOX === 'true';

  if (!isSandbox) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const body = await request.json().catch(() => ({})) as { bookingId?: string };
  const { bookingId } = body;

  if (!bookingId) {
    return NextResponse.json({ ok: false, error: 'bookingId requis' }, { status: 400 });
  }

  const accessToken = request.cookies.get(COOKIE_ACCESS)?.value;
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: 'Non authentifié' }, { status: 401 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/v1/dev/payments/simulate-success`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ bookingId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ ok: false, error: data }, { status: res.status });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'Erreur réseau' }, { status: 502 });
  }
}
