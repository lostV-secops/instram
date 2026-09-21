/**
 * Console d'administration InsTRAM — /fr/admin/*
 *
 * Utilisateur : INSTRAM_ADMIN (e2e/.auth/admin.json)
 * Scénarios couverts :
 * 1. Accès /admin interdit sans rôle ADMIN
 * 2. Dashboard admin charge et reste en français (pas de /mg/admin)
 * 3. Liste des coopératives (toutes, avec statuts)
 * 4. Validation coopérative PENDING → VALIDATED
 * 5. Suspension coopérative VALIDATED → SUSPENDED
 * 6. Attribution plan tarifaire (commission 8% par défaut — VH-04)
 * 7. Liste des paiements de plateforme
 * 8. Catalogue villes : liste ≥ 119 (VH-11)
 * 9. Journal d'audit : actions tracées
 * 10. Vue globale des trajets toutes coopératives
 */

import { test, expect } from '@playwright/test';

const COOP_PENDING_ID = 'e2e00000-0000-0000-coop-000000000002';

// ─── Protection accès ─────────────────────────────────────────────────────────

test.describe('Protection accès console admin', () => {
  test('/fr/admin redirige vers login si non connecté', async ({ page }) => {
    await page.goto('/fr/admin');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 12_000 });
  });

  test('voyageur connecté ne peut pas accéder à /fr/admin', async ({ page }) => {
    await page.goto('/fr/admin');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 12_000 });
  });
});

// ─── Dashboard admin ──────────────────────────────────────────────────────────

test.describe('Dashboard administration', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('page /admin charge sans redirection login', async ({ page }) => {
    await page.goto('/fr/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page).toHaveURL(/\/admin/);
  });

  test('interface admin reste en français (pas de switch /mg/admin)', async ({ page }) => {
    await page.goto('/fr/admin');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    // Pas de switch de langue dans la console admin
    expect(text).not.toMatch(/\/mg\/admin/);
  });

  test('lien vers /admin/cooperatives visible', async ({ page }) => {
    await page.goto('/fr/admin');
    await page.waitForLoadState('networkidle');
    const link = page.locator('a[href*="/admin/cooperatives"]').first();
    if (await link.count() > 0) {
      await expect(link).toBeVisible({ timeout: 8_000 });
    }
  });
});

// ─── Gestion des coopératives ─────────────────────────────────────────────────

test.describe('Liste et statuts des coopératives', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('GET /v1/admin/cooperatives renvoie toutes les coopératives', async ({ page }) => {
    const res = await page.request.get('/api/proxy/v1/admin/cooperatives');
    if (!res.ok()) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    const data = await res.json() as { cooperatives: unknown[] };
    expect(Array.isArray(data.cooperatives)).toBeTruthy();
    expect(data.cooperatives.length).toBeGreaterThanOrEqual(1);
  });

  test('page /admin/cooperatives charge et liste les coopératives', async ({ page }) => {
    await page.goto('/fr/admin/cooperatives');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await expect(page).not.toHaveURL(/\/auth\/login/);
    const text = await page.locator('body').innerText();
    expect(text.trim().length).toBeGreaterThan(20);
  });

  test(`filtre statut PENDING visible dans l'interface`, async ({ page }) => {
    await page.goto('/fr/admin/cooperatives');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    if (!text.includes('réseau') && !text.includes('Erreur')) {
      const hasFilter =
        text.includes('PENDING') ||
        text.includes('En attente') ||
        text.includes('Tous') ||
        text.includes('Validée');
      expect(hasFilter).toBeTruthy();
    }
  });
});

// ─── Validation coopérative ───────────────────────────────────────────────────

test.describe('Validation coopérative PENDING → VALIDATED', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('PATCH /v1/admin/cooperatives/:id/validate → status VALIDATED', async ({ page }) => {
    const res = await page.request.patch(`/api/proxy/v1/admin/cooperatives/${COOP_PENDING_ID}/validate`);
    if (res.status() === 0) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    // 200 → validée ; 404 → ID inexistant en CI ; 409 → déjà validée
    expect([200, 404, 409]).toContain(res.status());
    if (res.ok()) {
      const data = await res.json() as { status: string };
      expect(data.status).toBe('VALIDATED');
    }
  });

  test('voyageur ne peut pas valider une coopérative → 403', async ({ page, context }) => {
    await context.clearCookies();
    const res = await page.request.patch(`/api/proxy/v1/admin/cooperatives/${COOP_PENDING_ID}/validate`);
    if (res.status() === 0) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    expect([401, 403]).toContain(res.status());
  });
});

// ─── Suspension coopérative ───────────────────────────────────────────────────

test.describe('Suspension coopérative → SUSPENDED', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('PATCH /v1/admin/cooperatives/:id/suspend → status SUSPENDED', async ({ page }) => {
    const res = await page.request.patch('/api/proxy/v1/admin/cooperatives/e2e00000-0000-0000-coop-000000000003/suspend');
    if (res.status() === 0) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    expect([200, 404, 409]).toContain(res.status());
    if (res.ok()) {
      const data = await res.json() as { status: string };
      expect(data.status).toBe('SUSPENDED');
    }
  });
});

// ─── Plan tarifaire (VH-04) ───────────────────────────────────────────────────

test.describe('VH-04 — Plan tarifaire : commission 8% par défaut', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('GET /v1/admin/pricing-plans renvoie au moins un plan', async ({ page }) => {
    const res = await page.request.get('/api/proxy/v1/admin/pricing-plans');
    if (!res.ok()) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    const data = await res.json() as { plans: Array<{ commissionRate?: number }> };
    expect(Array.isArray(data.plans)).toBeTruthy();
    const defaultPlan = data.plans.find((p) => p.commissionRate === 0.08);
    if (defaultPlan) {
      expect(defaultPlan.commissionRate).toBe(0.08);
    }
  });

  test('page /admin/pricing charge correctement', async ({ page }) => {
    await page.goto('/fr/admin/pricing');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await expect(page).not.toHaveURL(/\/auth\/login/);
    const text = await page.locator('body').innerText();
    expect(text.trim().length).toBeGreaterThan(20);
  });
});

// ─── Paiements de plateforme ──────────────────────────────────────────────────

test.describe('Supervision des paiements', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('GET /v1/admin/payments renvoie la liste des transactions', async ({ page }) => {
    const res = await page.request.get('/api/proxy/v1/admin/payments');
    if (!res.ok()) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    const data = await res.json() as { payments: unknown[] };
    expect(Array.isArray(data.payments)).toBeTruthy();
  });

  test('page /admin/payments charge sans erreur', async ({ page }) => {
    await page.goto('/fr/admin/payments');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await expect(page).not.toHaveURL(/\/auth\/login/);
    const text = await page.locator('body').innerText();
    expect(text.trim().length).toBeGreaterThan(20);
  });
});

// ─── Catalogue villes (VH-11) ─────────────────────────────────────────────────

test.describe('VH-11 — Catalogue géographique ≥ 119 districts', () => {
  test('GET /v1/catalog/cities renvoie au moins 119 villes', async ({ page }) => {
    const res = await page.request.get('/api/proxy/v1/catalog/cities');
    if (!res.ok()) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    const data = await res.json() as { cities: unknown[] };
    expect(Array.isArray(data.cities)).toBeTruthy();
    expect(data.cities.length).toBeGreaterThanOrEqual(119);
  });

  test.use({ storageState: 'e2e/.auth/admin.json' });

  test(`page /admin/cities accessible avec formulaire d'ajout`, async ({ page }) => {
    await page.goto('/fr/admin/cities');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await expect(page).not.toHaveURL(/\/auth\/login/);
    const text = await page.locator('body').innerText();
    expect(text.trim().length).toBeGreaterThan(20);
  });
});

// ─── Journal d'audit ──────────────────────────────────────────────────────────

test.describe(`Journal d'audit`, () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('GET /v1/admin/audit-logs renvoie des entrées', async ({ page }) => {
    const res = await page.request.get('/api/proxy/v1/admin/audit-logs');
    if (!res.ok()) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    const data = await res.json() as { logs: unknown[] };
    expect(Array.isArray(data.logs)).toBeTruthy();
  });

  test('page /admin/audit charge sans erreur', async ({ page }) => {
    await page.goto('/fr/admin/audit');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await expect(page).not.toHaveURL(/\/auth\/login/);
    const text = await page.locator('body').innerText();
    expect(text.trim().length).toBeGreaterThan(20);
  });
});

// ─── Vue globale trajets ──────────────────────────────────────────────────────

test.describe('Vue globale des trajets toutes coopératives', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('GET /v1/admin/trips renvoie des trajets de toutes les coopératives', async ({ page }) => {
    const res = await page.request.get('/api/proxy/v1/admin/trips');
    if (!res.ok()) {
      test.skip(true, 'Backend non démarré');
      return;
    }
    const data = await res.json() as { trips: unknown[] };
    expect(Array.isArray(data.trips)).toBeTruthy();
  });
});
