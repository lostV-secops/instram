/**
 * Route Handler : POST /api/auth/logout
 * Révoque le refresh token côté backend et supprime les cookies de session.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  COOKIE_USER_INFO,
  sessionCookieOptions,
} from '@/lib/auth';

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const accessToken = request.cookies.get(COOKIE_ACCESS)?.value;
  const refreshToken = request.cookies.get(COOKIE_REFRESH)?.value;

  // Tentative de révocation côté backend (best-effort, ne bloque pas la déconnexion)
  if (accessToken) {
    try {
      await fetch(`${BACKEND_URL}/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Ignorer l'erreur réseau — on supprime quand même les cookies
    }
  }

  // Supprimer tous les cookies de session
  const cookieDeleteOptions = {
    ...sessionCookieOptions,
    maxAge: 0,
    expires: new Date(0),
  };

  // Redirection vers login dans la langue courante après déconnexion
  const locale = request.cookies.get('NEXT_LOCALE')?.value === 'mg' ? 'mg' : 'fr';
  const response = NextResponse.redirect(
    new URL(`/${locale}/auth/login`, request.url),
    { status: 303 },
  );

  response.cookies.set(COOKIE_ACCESS, '', cookieDeleteOptions);
  response.cookies.set(COOKIE_REFRESH, '', cookieDeleteOptions);
  response.cookies.set(COOKIE_USER_INFO, '', {
    ...cookieDeleteOptions,
    httpOnly: false,
  });

  return response;
}
