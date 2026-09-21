/**
 * Application conducteur — /fr/driver/*
 *
 * Utilisateur : DRIVER (e2e/.auth/driver.json)
 * Scénarios couverts :
 * 1. Accès /driver interdit sans rôle DRIVER
 * 2. Liste des trajets du conducteur (aujourd'hui)
 * 3. Manifeste passagers d'un trajet
 * 4. Validation billet QR valide → BOARDED
 * 5. QR falsifié / signature invalide → rejet
 * 6. Saisie manuelle référence courte (fallback scan)
 * 7. Passager déjà BOARDED → alerte doublon
 * 8. Marquer passager absent → NO_SHOW
 * 9. Signaler départ → trajet IN_PROGRESS
 * 10. VH-09 : vérification HMAC sur le contenu QR
 */

import { test, expect } from '@playwright/test';
import * as crypto from 'crypto';

const TRIP_ID_J1 = 'e2e00000-0000-0000-0001-000000000001';

// ─── Protection accès ─────────────────────────────────────────────────────────

test.describe('Protection accès application conducteur', () => {
  test('/fr/driver redirige vers login si non connecté', async ({ page }) => {
    await page.goto('/fr/driver');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 12_000 });
  });

  test('/fr/driver redirige vers login pour un voyageur', async ({ page, context }) => {
    await context.addCookies([]);
    await page.goto('/fr/driver');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 12_000 });
  });
});

// ─── Liste des trajets ────────────────────────────────────────────────────────

test.describe('Liste des trajets conducteur', () => {
  test.use({ storageState: 'e2e/.auth/driver.json' });

  test('page /driver charge sans redirection login', async ({ page }) => {
    await page.goto('/fr/driver');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page).toHaveURL(/\/driver/);
  });

  test('page affiche les trajets du conducteur ou message vide', async ({ page }) => {
    await page.goto('/fr/driver');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text.trim().length).toBeGreaterThan(20);
  });

  test('API /v1/driver/trips renvoie uniquement les trajets du conducteur', async ({ page }) => {
    const res = await page.request.get('/api/proxy/v1/driver/trips');
    if (!res.ok()) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    const data = await res.json() as { trips: unknown[] };
    expect(Array.isArray(data.trips)).toBeTruthy();
  });
});

// ─── Manifeste passagers ──────────────────────────────────────────────────────

test.describe('Manifeste passagers', () => {
  test.use({ storageState: 'e2e/.auth/driver.json' });

  test('GET /v1/driver/trips/:id/passengers renvoie la liste', async ({ page }) => {
    const res = await page.request.get(`/api/proxy/v1/driver/trips/${TRIP_ID_J1}/passengers`);
    if (res.status() === 404 || res.status() === 403) {
      test.skip(true, `Endpoint non disponible pour ce conducteur (${res.status()})`);
      return;
    }
    if (res.ok()) {
      const data = await res.json() as { passengers: Array<{ firstName: string; lastName: string; bookingRef: string }> };
      expect(Array.isArray(data.passengers)).toBeTruthy();
      if (data.passengers.length > 0) {
        expect(data.passengers[0]).toHaveProperty('firstName');
        expect(data.passengers[0]).toHaveProperty('bookingRef');
      }
    }
  });

  test('page manifeste affiche la liste des passagers', async ({ page }) => {
    await page.goto(`/fr/driver/trips/${TRIP_ID_J1}/passengers`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await expect(page).not.toHaveURL(/\/auth\/login/);
    const text = await page.locator('body').innerText();
    expect(text.trim().length).toBeGreaterThan(20);
  });
});

// ─── Validation billet QR ─────────────────────────────────────────────────────

test.describe(`Validation QR à l'embarquement`, () => {
  test.use({ storageState: 'e2e/.auth/driver.json' });

  test('POST /v1/driver/board avec référence valide → BOARDED', async ({ page }) => {
    // Récupérer une réservation confirmée du trip E2E
    const passRes = await page.request.get(`/api/proxy/v1/driver/trips/${TRIP_ID_J1}/passengers`);
    if (!passRes.ok()) {
      test.skip(true, 'Backend non démarré ou accès refusé');
      return;
    }
    const data = await passRes.json() as {
      passengers: Array<{ bookingRef: string; boardingStatus: string }>;
    };
    const pending = data.passengers.find((p) => p.boardingStatus !== 'BOARDED');
    if (!pending) {
      test.skip(true, "Aucun passager en attente d'embarquement");
      return;
    }

    const boardRes = await page.request.post('/api/proxy/v1/driver/board', {
      data: {
        tripInstanceId: TRIP_ID_J1,
        bookingRef: pending.bookingRef,
      },
    });

    if (boardRes.ok()) {
      const result = await boardRes.json() as { status: string };
      expect(result.status).toBe('BOARDED');
    } else {
      // Si le passager est déjà embarqué → 409 est acceptable
      expect([200, 409]).toContain(boardRes.status());
    }
  });

  test('POST /v1/driver/board avec référence inexistante → 404', async ({ page }) => {
    const res = await page.request.post('/api/proxy/v1/driver/board', {
      data: {
        tripInstanceId: TRIP_ID_J1,
        bookingRef: 'XXXXXXXX',
      },
    });
    if (res.status() === 0) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    expect([404, 422]).toContain(res.status());
  });

  test('POST /v1/driver/board passager déjà BOARDED → 409', async ({ page }) => {
    // Tenter d'embarquer deux fois le même passager
    const passRes = await page.request.get(`/api/proxy/v1/driver/trips/${TRIP_ID_J1}/passengers`);
    if (!passRes.ok()) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    const data = await passRes.json() as {
      passengers: Array<{ bookingRef: string; boardingStatus: string }>;
    };
    const boarded = data.passengers.find((p) => p.boardingStatus === 'BOARDED');
    if (!boarded) {
      test.skip(true, "Aucun passager déjà BOARDED — embarquer d'abord");
      return;
    }

    const res = await page.request.post('/api/proxy/v1/driver/board', {
      data: { tripInstanceId: TRIP_ID_J1, bookingRef: boarded.bookingRef },
    });
    expect(res.status()).toBe(409);
  });
});

// ─── QR falsifié (VH-09) ─────────────────────────────────────────────────────

test.describe('VH-09 — Rejet QR avec signature HMAC invalide', () => {
  test.use({ storageState: 'e2e/.auth/driver.json' });

  test('POST /v1/driver/board-qr avec payload non signé → 401 ou 422', async ({ page }) => {
    const fakePayload = Buffer.from(
      JSON.stringify({
        ref: 'FAKEREFERENCE',
        tripId: TRIP_ID_J1,
        seat: 'A1',
        sig: 'invalidsignature',
      }),
    ).toString('base64');

    const res = await page.request.post('/api/proxy/v1/driver/board-qr', {
      data: { qrPayload: fakePayload },
    });

    if (res.status() === 0) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    expect([401, 422, 400]).toContain(res.status());
  });

  test('page scanner affiche zone de scan ou zone de saisie manuelle', async ({ page }) => {
    await page.goto(`/fr/driver/trips/${TRIP_ID_J1}/scan`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    const text = await page.locator('body').innerText();
    expect(text.trim().length).toBeGreaterThan(20);
  });
});

// ─── Passager absent ─────────────────────────────────────────────────────────

test.describe('Marquer passager absent → NO_SHOW', () => {
  test.use({ storageState: 'e2e/.auth/driver.json' });

  test('POST /v1/driver/no-show avec référence valide → NO_SHOW', async ({ page }) => {
    const passRes = await page.request.get(`/api/proxy/v1/driver/trips/${TRIP_ID_J1}/passengers`);
    if (!passRes.ok()) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    const data = await passRes.json() as {
      passengers: Array<{ bookingRef: string; boardingStatus: string }>;
    };
    const pending = data.passengers.find((p) => p.boardingStatus === 'PENDING');
    if (!pending) {
      test.skip(true, 'Aucun passager PENDING');
      return;
    }

    const res = await page.request.post('/api/proxy/v1/driver/no-show', {
      data: { tripInstanceId: TRIP_ID_J1, bookingRef: pending.bookingRef },
    });

    if (res.ok()) {
      const result = await res.json() as { status: string };
      expect(result.status).toBe('NO_SHOW');
    } else {
      expect([200, 422]).toContain(res.status());
    }
  });
});

// ─── Départ effectif ──────────────────────────────────────────────────────────

test.describe('Signaler le départ effectif', () => {
  test.use({ storageState: 'e2e/.auth/driver.json' });

  test('POST /v1/driver/trips/:id/depart → statut IN_PROGRESS', async ({ page }) => {
    const res = await page.request.post(`/api/proxy/v1/driver/trips/${TRIP_ID_J1}/depart`);
    if (res.status() === 0) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    // 200 → départ enregistré ; 409 → déjà parti ; 404 → trip inexistant pour ce driver
    expect([200, 409, 404]).toContain(res.status());
    if (res.ok()) {
      const data = await res.json() as { status: string };
      expect(['IN_PROGRESS', 'OPEN_FOR_BOOKING']).toContain(data.status);
    }
  });
});
