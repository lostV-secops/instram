import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_ACCESS } from './lib/auth';

const LOCALES = ['fr', 'mg'] as const;
type Locale = (typeof LOCALES)[number];
const DEFAULT_LOCALE: Locale = 'fr';
const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Routes qui nécessitent une session active (redirection vers login sinon) */
const PROTECTED_PATH_SEGMENTS = ['/bookings', '/coop'];

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

export function middleware(request: NextRequest): NextResponse {
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

    // Préserver les query params
    redirectUrl.search = request.nextUrl.search;

    const response = NextResponse.redirect(redirectUrl);
    // Mémoriser la préférence de langue (1 an)
    response.cookies.set(LOCALE_COOKIE, locale, {
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
      sameSite: 'lax',
    });
    return response;
  }

  // Mettre à jour le cookie de langue si nécessaire
  const currentLocale = LOCALES.find(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`),
  );
  if (currentLocale) {
    const storedLocale = request.cookies.get(LOCALE_COOKIE)?.value;
    if (storedLocale !== currentLocale) {
      const response = NextResponse.next();
      response.cookies.set(LOCALE_COOKIE, currentLocale, {
        maxAge: 60 * 60 * 24 * 365,
        path: '/',
        sameSite: 'lax',
      });
      // Vérifier les routes protégées sur la même passe
      if (requiresAuth(pathname, currentLocale)) {
        return redirectToLogin(request, pathname, currentLocale);
      }
      return response;
    }
  }

  // Vérification des routes protégées
  if (currentLocale && requiresAuth(pathname, currentLocale)) {
    const hasSession = request.cookies.has(COOKIE_ACCESS);
    if (!hasSession) {
      return redirectToLogin(request, pathname, currentLocale);
    }
  }

  return NextResponse.next();
}

function requiresAuth(pathname: string, locale: Locale): boolean {
  return PROTECTED_PATH_SEGMENTS.some((segment) =>
    pathname.startsWith(`/${locale}${segment}`),
  );
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
    /*
     * Matcher : tous les chemins sauf :
     * - api/ (Route Handlers Next.js)
     * - _next/static (fichiers statiques)
     * - _next/image (optimisation image)
     * - favicon.ico
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
