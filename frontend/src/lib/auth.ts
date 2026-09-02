/**
 * Helpers d'authentification — lecture des cookies de session.
 * Ces fonctions s'exécutent uniquement côté serveur (Server Components,
 * Route Handlers, Middleware).
 */

import type { Me } from './types';

/** Nom des cookies */
export const COOKIE_ACCESS = 'instram_access';
export const COOKIE_REFRESH = 'instram_refresh';
/** Cookie NON-httpOnly : contient les informations publiques de l'utilisateur
 *  (id, email, roles) — lisible côté client, jamais de secret. */
export const COOKIE_USER_INFO = 'instram_user';

/** Durée de vie du token d'accès en secondes (15 min) */
export const ACCESS_TOKEN_MAX_AGE = 15 * 60;
/** Durée de vie du refresh token en secondes (30 jours) */
export const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60;

/** Lecture du token d'accès depuis les cookies (Server Component) */
export async function getAccessToken(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers');
    return cookies().get(COOKIE_ACCESS)?.value ?? null;
  } catch {
    return null;
  }
}

/** Lecture du refresh token depuis les cookies (Server Component) */
export async function getRefreshToken(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers');
    return cookies().get(COOKIE_REFRESH)?.value ?? null;
  } catch {
    return null;
  }
}

/** Vérifie si l'utilisateur est authentifié (présence du cookie d'accès) */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

/** Lecture des infos utilisateur non-sensibles depuis le cookie public */
export function parseUserInfoCookie(
  cookieValue: string | undefined,
): Pick<Me, 'id' | 'email' | 'roles'> | null {
  if (!cookieValue) return null;
  try {
    return JSON.parse(decodeURIComponent(cookieValue)) as Pick<
      Me,
      'id' | 'email' | 'roles'
    >;
  } catch {
    return null;
  }
}

/** Options communes pour les cookies de session */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
