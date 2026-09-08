import { test, expect } from '@playwright/test';

test.describe('Changement de langue', () => {
  test('bascule FR vers MG depuis la page accueil', async ({ page }) => {
    await page.goto('/fr');
    await expect(page.getByRole('heading', { name: /réservez votre trajet/i })).toBeVisible();

    await page.getByRole('link', { name: /malagasy/i }).click();
    await expect(page).toHaveURL(/\/mg(\/|$)/);
    await expect(page.getByRole('heading', { name: /ambara ny diananao/i })).toBeVisible({ timeout: 5_000 });
  });

  test('bascule MG vers FR depuis la page accueil', async ({ page }) => {
    await page.goto('/mg');
    await expect(page.getByRole('heading', { name: /ambara ny diananao/i })).toBeVisible();

    await page.getByRole('link', { name: /français/i }).click();
    await expect(page).toHaveURL(/\/fr(\/|$)/);
    await expect(page.getByRole('heading', { name: /réservez votre trajet/i })).toBeVisible({ timeout: 5_000 });
  });

  test('bascule de langue preserve le chemin cooperatives', async ({ page }) => {
    await page.goto('/fr/cooperatives');
    await page.getByRole('link', { name: /malagasy/i }).click();
    await expect(page).toHaveURL(/\/mg\/cooperatives/);
  });

  test('changement de langue ne redirige pas vers login', async ({ page }) => {
    await page.goto('/fr');
    await page.getByRole('link', { name: /malagasy/i }).click();
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page).toHaveURL(/\/mg/);
  });
});
