/**
 * Tests pour src/lib/api.ts — wrapper fetch côté client.
 * jsdom fournit window → IS_SERVER=false → on teste le comportement client.
 */

import { AppError, apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('AppError', () => {
  it('initialise correctement les propriétés', () => {
    const err = new AppError('NOT_FOUND', 'Ressource introuvable', 404, { id: '123' });
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Ressource introuvable');
    expect(err.status).toBe(404);
    expect(err.details).toEqual({ id: '123' });
    expect(err.name).toBe('AppError');
  });

  it('est une instance de Error', () => {
    const err = new AppError('ERR', 'msg', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('apiGet', () => {
  it('retourne les données JSON sur 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [1, 2, 3] }),
    });

    const data = await apiGet<{ items: number[] }>('/catalog/cities');
    expect(data).toEqual({ items: [1, 2, 3] });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/proxy/v1/catalog/cities',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('lance AppError sur réponse 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ code: 'UNAUTHORIZED', message: 'Token invalide' }),
    });

    const error = await apiGet('/me').catch((e: unknown) => e as AppError);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('UNAUTHORIZED');
    expect((error as AppError).status).toBe(401);
  });

  it('lance AppError sur réponse 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ code: 'NOT_FOUND', message: 'Trajet introuvable' }),
    });

    await expect(apiGet('/trips/unknown')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('lance AppError avec code API_ERROR si le corps JSON est invalide', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => { throw new Error('not json'); },
    });

    await expect(apiGet('/broken')).rejects.toMatchObject({
      code: 'PARSE_ERROR',
      status: 500,
    });
  });

  it('passe l\'en-tête Accept-Language si fourni', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await apiGet('/catalog/cities', { acceptLang: 'mg' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Accept-Language': 'mg' }),
      }),
    );
  });

  it('force cache: no-store par défaut', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await apiGet('/something');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});

describe('apiPost', () => {
  it('envoie le corps JSON et retourne la réponse', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ bookingId: 'bk-1' }),
    });

    const data = await apiPost<{ bookingId: string }>('/bookings', { tripId: 't-1', seats: ['s-1'] });
    expect(data).toEqual({ bookingId: 'bk-1' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/proxy/v1/bookings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tripId: 't-1', seats: ['s-1'] }),
        cache: 'no-store',
      }),
    );
  });

  it('lance AppError sur 422', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ code: 'SEAT_UNAVAILABLE', message: 'Siège non disponible' }),
    });

    await expect(apiPost('/seats/hold', {})).rejects.toMatchObject({
      code: 'SEAT_UNAVAILABLE',
      status: 422,
    });
  });
});

describe('apiPatch', () => {
  it('envoie une requête PATCH avec le corps', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ updated: true }) });

    await apiPatch('/notifications/preferences', { smsEnabled: false });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/proxy/v1/notifications/preferences',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

describe('apiDelete', () => {
  it('réussit sur 204 sans lancer d\'erreur', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 204 });

    await expect(apiDelete('/seats/hold/h-1')).resolves.toBeUndefined();
  });

  it('lance AppError sur 403', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ code: 'FORBIDDEN', message: 'Accès refusé' }),
    });

    await expect(apiDelete('/admin/resource')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });
});
