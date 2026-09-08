import { test, expect } from '@playwright/test';

test.describe('Recherche de trajets', () => {
  test('page accueil charge avec titre et bouton recherche', async ({ page }) => {
    await page.goto('/fr');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /rechercher|hieroka/i })).toBeVisible({ timeout: 15_000 });
  });

  test('selects de ville contiennent des options', async ({ page }) => {
    await page.goto('/fr');
    await page.waitForFunction(() => {
      const selects = document.querySelectorAll('select');
      return selects[0] && selects[0].options.length > 1;
    }, { timeout: 15_000 });

    const count = await page.locator('select').first().locator('option').count();
    expect(count).toBeGreaterThan(1);
  });

  test('formulaire sans villes reste sur la page accueil', async ({ page }) => {
    await page.goto('/fr');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /rechercher|hieroka/i }).click();
    await expect(page).toHaveURL(/\/fr(\/|$)/);
  });

  test('soumission redirige vers les resultats', async ({ page }) => {
    await page.goto('/fr');
    await page.waitForFunction(() => {
      const s = document.querySelectorAll('select');
      return s[0]?.options.length > 1 && s[1]?.options.length > 1;
    }, { timeout: 15_000 });

    const selectDepart = page.locator('select').first();
    const selectArrivee = page.locator('select').nth(1);
    const optCount = await selectArrivee.locator('option').count();

    await selectDepart.selectOption({ index: 1 });
    await selectArrivee.selectOption({ index: optCount > 2 ? 2 : 1 });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page.locator('input[type="date"]').fill(tomorrow.toISOString().split('T')[0]);

    await page.getByRole('button', { name: /rechercher|hieroka/i }).click();
    await page.waitForURL('**/search**', { timeout: 15_000 });
    await expect(page).toHaveURL(/\/search/);
  });

  test('page resultats avec params manquants affiche message', async ({ page }) => {
    // Sans originCityId/destinationCityId la page montre un message et un lien retour
    await page.goto('/fr/search');
    await page.waitForLoadState('domcontentloaded');
    const link = page.locator('a[href="/fr"]').first();
    await expect(link).toBeVisible({ timeout: 10_000 });
  });

  test('page resultats avec params corrects charge', async ({ page }) => {
    // On passe des IDs factices — le backend peut renvoyer 0 résultats mais la page doit se charger
    await page.goto('/fr/search?originCityId=1&destinationCityId=2&date=2026-12-01&passengers=1');
    await page.waitForLoadState('domcontentloaded');
    // La page contient soit des résultats, soit un message "aucun résultat", mais elle charge
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});
