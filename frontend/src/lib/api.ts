/**
 * Wrapper fetch pour l'API InsTRAM.
 *
 * Stratégie :
 *  - Côté serveur (Server Components / Route Handlers) : appel direct au
 *    backend avec le token Bearer lu depuis les cookies httpOnly.
 *  - Côté client (Client Components) : appel à /api/proxy qui ajoute
 *    automatiquement le token depuis le cookie httpOnly.
 *
 * Gestion d'erreurs :
 *  - 401 → throw AppError(UNAUTHORIZED) — le composant appelant doit
 *    rediriger vers la page de login.
 *  - 4xx/5xx → throw AppError avec le code et message de l'API.
 */

const IS_SERVER = typeof window === 'undefined';

// URL backend direct — utilisé côté serveur uniquement
const BACKEND_INTERNAL_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000';

// ─── Erreur applicative ───────────────────────────────────────────────────────
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// ─── Helpers internes ─────────────────────────────────────────────────────────

function buildUrl(path: string): string {
  if (IS_SERVER) {
    // Appel direct au backend depuis le serveur Next.js
    return `${BACKEND_INTERNAL_URL}/v1${path}`;
  }
  // Client : passe par le proxy Next.js qui gère l'auth httpOnly
  return `/api/proxy/v1${path}`;
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  if (!IS_SERVER) return {};
  // Lecture du token depuis le cookie httpOnly (Server Component / Route Handler)
  try {
    const { cookies } = await import('next/headers');
    const token = cookies().get('instram_access')?.value;
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    // En dehors d'un contexte Next.js (tests, build) — pas de cookie disponible
  }
  return {};
}

async function parseErrorResponse(response: Response): Promise<AppError> {
  let errorBody: { code?: string; message?: string; details?: unknown } = {};
  try {
    errorBody = await response.json();
  } catch {
    errorBody = { code: 'PARSE_ERROR', message: response.statusText };
  }

  const code = errorBody.code || 'API_ERROR';
  const message = errorBody.message || `HTTP ${response.status}`;

  return new AppError(code, message, response.status, errorBody.details);
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * GET typé vers l'API.
 * Exemple : `await apiGet<CityList>('/catalog/cities')`
 */
export async function apiGet<T>(
  path: string,
  options?: RequestInit & { acceptLang?: string },
): Promise<T> {
  const authHeaders = await buildAuthHeaders();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders,
  };

  if (options?.acceptLang) {
    headers['Accept-Language'] = options.acceptLang;
  }

  const response = await fetch(buildUrl(path), {
    method: 'GET',
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string> | undefined),
    },
    cache: options?.cache ?? 'no-store',
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<T>;
}

/**
 * POST typé vers l'API.
 * Exemple : `await apiPost<AuthTokens>('/auth/login', { email, password })`
 */
export async function apiPost<T>(
  path: string,
  body: unknown,
  options?: RequestInit & { acceptLang?: string },
): Promise<T> {
  const authHeaders = await buildAuthHeaders();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders,
  };

  if (options?.acceptLang) {
    headers['Accept-Language'] = options.acceptLang;
  }

  const response = await fetch(buildUrl(path), {
    method: 'POST',
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<T>;
}

/**
 * PUT typé vers l'API (remplacement complet de ressource).
 * Exemple : `await apiPut<Fare[]>('/coop/trips/uuid/fares', [...])`
 */
export async function apiPut<T>(
  path: string,
  body: unknown,
  options?: RequestInit,
): Promise<T> {
  const authHeaders = await buildAuthHeaders();
  const response = await fetch(buildUrl(path), {
    method: 'PUT',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options?.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<T>;
}

/**
 * PATCH typé vers l'API.
 */
export async function apiPatch<T>(
  path: string,
  body: unknown,
  options?: RequestInit,
): Promise<T> {
  const authHeaders = await buildAuthHeaders();
  const response = await fetch(buildUrl(path), {
    method: 'PATCH',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options?.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<T>;
}

/**
 * DELETE vers l'API (204 No Content attendu).
 */
export async function apiDelete(
  path: string,
  options?: RequestInit,
): Promise<void> {
  const authHeaders = await buildAuthHeaders();
  const response = await fetch(buildUrl(path), {
    method: 'DELETE',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options?.headers as Record<string, string> | undefined),
    },
    cache: 'no-store',
  });

  if (!response.ok && response.status !== 204) {
    throw await parseErrorResponse(response);
  }
}
