import { test, expect } from '@playwright/test';

test.describe('Annuaire des cooperatives', () => {
  test('page cooperatives charge sans erreur', async ({ page }) => {
    await page.goto('/fr/cooperatives');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('text=500')).not.toBeVisible();
  });

  test('accessible sans connexion — pas de redirection vers login', async ({ page }) => {
    await page.goto('/fr/cooperatives');
    await page.waitForLoadState('networkidle');
    // La page ne redirige pas vers le login
    const url = page.url();
    expect(url).not.toMatch(/\/auth\/login/);
    expect(url).toMatch(/\/cooperatives/);
  });

  test('champ de recherche present', async ({ page }) => {
    await page.goto('/fr/cooperatives');
    const input = page.locator('input[type="search"], input[type="text"]').first();
    await expect(input).toBeVisible({ timeout: 12_000 });
  });

  test('version malagasy charge correctement', async ({ page }) => {
    await page.goto('/mg/cooperatives');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 12_000 });
    const url = page.url();
    expect(url).not.toMatch(/\/auth\/login/);
  });
});
