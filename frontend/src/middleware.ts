import { NextRequest, NextResponse } from 'next/server';
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
  sessionCookieOptions,
} from './lib/auth';

const LOCALES = ['fr', 'mg'] as const;
type Locale = (typeof LOCALES)[number];
const DEFAULT_LOCALE: Locale = 'fr';
const LOCALE_COOKIE = 'NEXT_LOCALE';

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000';

/** Routes qui nécessitent une session active (redirection vers login sinon) */
const PROTECTED_PATH_SEGMENTS = ['/bookings', '/coop', '/driver', '/admin', '/profile'];

function getPreferredLocale(request: NextRequest): Locale {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && LOCALES.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale;
  }

  const acceptLang = request.headers.get('accept-language') ?? '';
  for (const segment of acceptLang.split(',')) {
    const tag = segment.trim().split(';')[0].split('-')[0].toLowerCase();
    if (LOCALES.includes(tag as Locale)) return tag as Locale;
  }

  return DEFAULT_LOCALE;
}

/**
 * Rafraîchit silencieusement l'access token via le refresh token.
 * Retourne { accessToken, refreshToken } ou null si échec.
 */
async function tryRefreshToken(
  rawRefreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rawRefreshToken }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.accessToken || !data.refreshToken) return null;
    return { accessToken: data.accessToken, refreshToken: data.refreshToken };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Ne pas intercepter les routes Next.js internes, fichiers statiques et API
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.[a-z0-9]+$/i)
  ) {
    return NextResponse.next();
  }

  // Vérifier si le chemin commence déjà par un segment de langue
  const pathnameHasLocale = LOCALES.some(
    (locale) =>
      pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );

  if (!pathnameHasLocale) {
    // Redirection vers le chemin localisé
    const locale = getPreferredLocale(request);
    const localizedPath = `/${locale}${pathname === '/' ? '' : pathname}`;
    const redirectUrl = new URL(localizedPath, request.url);
    redirectUrl.search = request.nextUrl.search;

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(LOCALE_COOKIE, locale, {
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
      sameSite: 'lax',
    });
    return response;
  }

  const currentLocale = LOCALES.find(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`),
  );

  // Mise à jour du cookie de langue si nécessaire
  if (currentLocale) {
    const storedLocale = request.cookies.get(LOCALE_COOKIE)?.value;
    if (storedLocale !== currentLocale) {
      const response = NextResponse.next();
      response.cookies.set(LOCALE_COOKIE, currentLocale, {
        maxAge: 60 * 60 * 24 * 365,
        path: '/',
        sameSite: 'lax',
      });
      if (requiresAuth(pathname, currentLocale)) {
        return handleAuthCheck(request, response, pathname, currentLocale);
      }
      return response;
    }
  }

  // Vérification des routes protégées
  if (currentLocale && requiresAuth(pathname, currentLocale)) {
    const baseResponse = NextResponse.next();
    return handleAuthCheck(request, baseResponse, pathname, currentLocale);
  }

  return NextResponse.next();
}

async function handleAuthCheck(
  request: NextRequest,
  baseResponse: NextResponse,
  pathname: string,
  locale: Locale,
): Promise<NextResponse> {
  const hasAccessToken = request.cookies.has(COOKIE_ACCESS);
  const rawRefreshToken = request.cookies.get(COOKIE_REFRESH)?.value;

  if (hasAccessToken) {
    // Token d'accès présent — laisser passer
    return baseResponse;
  }

  if (!rawRefreshToken) {
    // Aucun token — redirection vers login
    return redirectToLogin(request, pathname, locale);
  }

  // Access token manquant mais refresh token présent → rafraîchissement silencieux
  const tokens = await tryRefreshToken(rawRefreshToken);
  if (!tokens) {
    return redirectToLogin(request, pathname, locale);
  }

  // Injection du nouveau cookie d'accès dans les headers de la requête forwarded
  // afin que cookies() de next/headers le voie dans les Server Components.
  const reqHeaders = new Headers(request.headers);
  const existingCookies = request.headers.get('cookie') ?? '';
  const cookieSep = existingCookies ? '; ' : '';
  reqHeaders.set('cookie', `${existingCookies}${cookieSep}${COOKIE_ACCESS}=${tokens.accessToken}`);

  const response = NextResponse.next({ request: { headers: reqHeaders } });

  // Persister les nouveaux tokens dans les cookies du navigateur
  response.cookies.set(COOKIE_ACCESS, tokens.accessToken, {
    ...sessionCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });
  response.cookies.set(COOKIE_REFRESH, tokens.refreshToken, {
    ...sessionCookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });

  return response;
}

function requiresAuth(pathname: string, locale: Locale): boolean {
  return PROTECTED_PATH_SEGMENTS.some((segment) => {
    const base = `/${locale}${segment}`;
    return pathname === base || pathname.startsWith(`${base}/`);
  });
}

function redirectToLogin(
  request: NextRequest,
  returnTo: string,
  locale: Locale,
): NextResponse {
  const loginUrl = new URL(`/${locale}/auth/login`, request.url);
  loginUrl.searchParams.set('redirect', returnTo);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
