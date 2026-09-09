import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: 'INVALID_BODY', message: 'JSON invalide' }, { status: 400 });
  }

  try {
    const backendRes = await fetch(`${BACKEND_URL}/v1/auth/password/reset-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await backendRes.json().catch(() => ({}));
    return NextResponse.json(data, { status: backendRes.status });
  } catch {
    return NextResponse.json(
      { code: 'NETWORK_ERROR', message: 'Impossible de contacter le serveur' },
      { status: 503 },
    );
  }
}
