/**
 * Route Handler : POST /api/auth/register
 * Crée un compte voyageur et stocke les tokens dans des cookies.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  COOKIE_USER_INFO,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
  sessionCookieOptions,
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
    return NextResponse.json(
      { code: 'INVALID_BODY', message: 'JSON invalide' },
      { status: 400 },
    );
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${BACKEND_URL}/v1/auth/register`, {
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

  if (!backendResponse.ok) {
    const errorBody = await backendResponse.json().catch(() => ({
      code: 'REGISTER_ERROR',
      message: 'Inscription échouée',
    }));
    return NextResponse.json(errorBody, { status: backendResponse.status });
  }

  const authData = (await backendResponse.json()) as AuthTokens;

  const response = NextResponse.json({ success: true }, { status: 201 });

  response.cookies.set(COOKIE_ACCESS, authData.accessToken, {
    ...sessionCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });

  response.cookies.set(COOKIE_REFRESH, authData.refreshToken, {
    ...sessionCookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });

  if (authData.user) {
    const publicUserInfo = {
      id: authData.user.id,
      email: authData.user.email,
      roles: authData.user.roles,
    };
    response.cookies.set(
      COOKIE_USER_INFO,
      encodeURIComponent(JSON.stringify(publicUserInfo)),
      {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: REFRESH_TOKEN_MAX_AGE,
      },
    );
  }

  return response;
}
