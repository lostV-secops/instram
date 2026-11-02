/**
 * Route Handler proxy générique — /api/proxy/v1/**
 *
 * Permet aux Client Components d'appeler l'API backend de manière
 * authentifiée sans exposer le token httpOnly côté client.
 *
 * Le Route Handler lit le cookie httpOnly `instram_access` et ajoute
 * automatiquement l'en-tête Authorization: Bearer <token>.
 *
 * Exemple : fetch('/api/proxy/v1/trips/uuid/seats/hold', { method: 'POST', ... })
 * → forward vers http://backend:4000/v1/trips/uuid/seats/hold
 */

import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_ACCESS, COOKIE_REFRESH, ACCESS_TOKEN_MAX_AGE, REFRESH_TOKEN_MAX_AGE, sessionCookieOptions } from '@/lib/auth';

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000';

async function tryRefreshToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
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

interface RouteParams {
  params: { path: string[] };
}

async function proxyRequest(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { path } = params;

  // Sécurité : le path doit commencer par "v1"
  if (!path || path[0] !== 'v1') {
    return NextResponse.json({ code: 'FORBIDDEN', message: 'Chemin invalide' }, {
      status: 403,
    });
  }

  const backendPath = path.join('/');
  const search = request.nextUrl.search;
  const backendUrl = `${BACKEND_URL}/${backendPath}${search}`;

  // Récupérer le token d'accès depuis le cookie httpOnly
  const accessToken = request.cookies.get(COOKIE_ACCESS)?.value;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': request.headers.get('Accept-Language') ?? 'fr',
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  // Transmettre le corps pour les méthodes avec body
  let body: string | undefined;
  const method = request.method;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    try {
      body = await request.text();
    } catch {
      body = undefined;
    }
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(backendUrl, {
      method,
      headers,
      body,
      // Cache désactivé pour les appels proxy
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { code: 'NETWORK_ERROR', message: 'Impossible de contacter le serveur' },
      { status: 503 },
    );
  }

  // Si 401 : tenter un refresh silencieux et rejouer la requête une fois
  let refreshedTokens: { accessToken: string; refreshToken: string } | null = null;
  if (backendResponse.status === 401) {
    const rawRefresh = request.cookies.get(COOKIE_REFRESH)?.value;
    if (rawRefresh) {
      refreshedTokens = await tryRefreshToken(rawRefresh);
      if (refreshedTokens) {
        const retryHeaders = { ...headers, Authorization: `Bearer ${refreshedTokens.accessToken}` };
        try {
          backendResponse = await fetch(backendUrl, {
            method,
            headers: retryHeaders,
            body,
            cache: 'no-store',
          });
        } catch {
          return NextResponse.json(
            { code: 'NETWORK_ERROR', message: 'Impossible de contacter le serveur' },
            { status: 503 },
          );
        }
      }
    }
  }

  // Les statuts sans corps (204, 304) ne doivent pas transmettre de body ni de Content-Type.
  const NO_BODY_STATUSES = [204, 304];
  if (NO_BODY_STATUSES.includes(backendResponse.status)) {
    const noBodyRes = new NextResponse(null, {
      status: backendResponse.status,
      headers: { 'Cache-Control': 'no-store' },
    });
    if (refreshedTokens) {
      noBodyRes.cookies.set(COOKIE_ACCESS, refreshedTokens.accessToken, { ...sessionCookieOptions, maxAge: ACCESS_TOKEN_MAX_AGE });
      noBodyRes.cookies.set(COOKIE_REFRESH, refreshedTokens.refreshToken, { ...sessionCookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE });
    }
    return noBodyRes;
  }

  // Transmettre la réponse du backend telle quelle (statut + corps)
  // On utilise arrayBuffer() pour gérer à la fois le texte (JSON) et le binaire (PDF, CSV…).
  const responseBuffer = await backendResponse.arrayBuffer();
  const contentType = backendResponse.headers.get('content-type') ?? 'application/json';

  const responseHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  };
  const disposition = backendResponse.headers.get('content-disposition');
  if (disposition) responseHeaders['Content-Disposition'] = disposition;

  const finalResponse = new NextResponse(responseBuffer, {
    status: backendResponse.status,
    headers: responseHeaders,
  });
  if (refreshedTokens) {
    finalResponse.cookies.set(COOKIE_ACCESS, refreshedTokens.accessToken, { ...sessionCookieOptions, maxAge: ACCESS_TOKEN_MAX_AGE });
    finalResponse.cookies.set(COOKIE_REFRESH, refreshedTokens.refreshToken, { ...sessionCookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE });
  }
  return finalResponse;
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
