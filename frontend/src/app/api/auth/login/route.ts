/**
 * Route Handler : POST /api/auth/login
 *
 * Transmet les credentials au backend, puis stocke les tokens dans
 * des cookies httpOnly (accès_token, refresh_token) + un cookie
 * non-sensible avec les infos publiques de l'utilisateur (userId, email, roles).
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
    backendResponse = await fetch(`${BACKEND_URL}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'fr',
      },
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
      code: 'AUTH_ERROR',
      message: 'Authentification échouée',
    }));
    return NextResponse.json(errorBody, { status: backendResponse.status });
  }

  const authData = (await backendResponse.json()) as AuthTokens;

  const response = NextResponse.json(
    { success: true, roles: authData.user?.roles ?? [] },
    { status: 200 },
  );

  // Cookie httpOnly — accès_token (15 min)
  response.cookies.set(COOKIE_ACCESS, authData.accessToken, {
    ...sessionCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });

  // Cookie httpOnly — refresh_token (30 jours)
  response.cookies.set(COOKIE_REFRESH, authData.refreshToken, {
    ...sessionCookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });

  // Cookie lisible côté client — infos non-sensibles (pas de secret !)
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
        httpOnly: false, // Accessible côté client pour le nom/WS userId
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: REFRESH_TOKEN_MAX_AGE,
      },
    );
  }

  return response;
}
