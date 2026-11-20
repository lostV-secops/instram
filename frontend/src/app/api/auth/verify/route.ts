/**
 * Route Handler : POST /api/auth/verify
 * Proxy vers POST /v1/auth/verify/otp (backend).
 * Sur succès, pose les cookies de session (access + refresh + user_info).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  COOKIE_USER_INFO,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
  sessionCookieOptions,
  COOKIE_SECURE,
} from '@/lib/auth';
import type { AuthTokens } from '@/lib/types';

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

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${BACKEND_URL}/v1/auth/verify/otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { code: 'NETWORK_ERROR', message: 'Impossible de contacter le serveur' },
      { status: 503 },
    );
  }

  const responseBody = await backendResponse.json().catch(() => ({
    code: 'VERIFY_ERROR',
    message: 'Vérification échouée',
  }));

  if (!backendResponse.ok) {
    return NextResponse.json(responseBody, { status: backendResponse.status });
  }

  const authData = responseBody as AuthTokens;
  const res = NextResponse.json({ success: true }, { status: 200 });

  res.cookies.set(COOKIE_ACCESS, authData.accessToken, {
    ...sessionCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });

  res.cookies.set(COOKIE_REFRESH, authData.refreshToken, {
    ...sessionCookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });

  if (authData.user) {
    const publicUserInfo = {
      id: authData.user.id,
      email: authData.user.email,
      roles: authData.user.roles,
    };
    res.cookies.set(
      COOKIE_USER_INFO,
      encodeURIComponent(JSON.stringify(publicUserInfo)),
      {
        httpOnly: false,
        secure: COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        maxAge: REFRESH_TOKEN_MAX_AGE,
      },
    );
  }

  return res;
}
