import { test, expect } from '@playwright/test';

test.describe('Routes protegees', () => {
  test('profil redirige vers login si non connecte', async ({ page }) => {
    await page.goto('/fr/profile');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 12_000 });
  });

  test('bookings redirige vers login si non connecte', async ({ page }) => {
    await page.goto('/fr/bookings');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 12_000 });
  });

  test('parametre redirect est preserve apres redirection', async ({ page }) => {
    await page.goto('/fr/profile');
    await expect(page).toHaveURL(/redirect=/, { timeout: 12_000 });
  });
});

test.describe('Navbar desktop', () => {
  // Force un viewport desktop — ces liens sont masqués sur mobile par `hidden sm:flex`
  test.use({ viewport: { width: 1280, height: 720 } });

  test('logo InsTRAM visible', async ({ page }) => {
    await page.goto('/fr');
    await expect(page.getByRole('link', { name: 'InsTRAM' })).toBeVisible();
  });

  test('lien cooperatives visible dans la navbar', async ({ page }) => {
    await page.goto('/fr');
    // Cibler le lien dans la nav desktop uniquement
    const coopLink = page.locator('nav ul a[href*="/cooperatives"]').first();
    await expect(coopLink).toBeVisible();
  });

  test('logo renvoie a la page accueil', async ({ page }) => {
    await page.goto('/fr/cooperatives');
    await page.getByRole('link', { name: 'InsTRAM' }).click();
    await expect(page).toHaveURL(/\/fr(\/|$)/);
  });

  test('lien vers connexion visible si non connecte', async ({ page }) => {
    await page.goto('/fr');
    const loginLink = page.locator('nav a[href*="/auth/login"]').first();
    await expect(loginLink).toBeVisible();
  });
});

test.describe('Menu hamburger mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('bouton hamburger visible sur mobile', async ({ page }) => {
    await page.goto('/fr');
    await expect(page.getByRole('button', { name: /ouvrir le menu/i })).toBeVisible();
  });

  test('menu hamburger ouvre les liens de navigation', async ({ page }) => {
    await page.goto('/fr');
    await page.getByRole('button', { name: /ouvrir le menu/i }).click();

    const mobileMenu = page.locator('#mobile-menu');
    await expect(mobileMenu).toBeVisible();
    await expect(mobileMenu.locator('a').first()).toBeVisible();
    // Doit contenir au moins Accueil et Coopératives
    await expect(mobileMenu.locator('a[href$="/fr"]')).toBeVisible();
    await expect(mobileMenu.locator('a[href*="/cooperatives"]')).toBeVisible();
  });

  test('lien du menu mobile ferme le menu', async ({ page }) => {
    await page.goto('/fr');
    await page.getByRole('button', { name: /ouvrir le menu/i }).click();
    await expect(page.locator('#mobile-menu')).toBeVisible();
    // Cliquer sur le lien Accueil
    await page.locator('#mobile-menu a[href$="/fr"]').click();
    await expect(page.locator('#mobile-menu')).not.toBeVisible({ timeout: 5_000 });
  });

  test('re-cliquer hamburger ferme le menu', async ({ page }) => {
    await page.goto('/fr');
    await page.getByRole('button', { name: /ouvrir le menu/i }).click();
    await expect(page.locator('#mobile-menu')).toBeVisible();
    await page.getByRole('button', { name: /fermer le menu/i }).click();
    await expect(page.locator('#mobile-menu')).not.toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Footer', () => {
  test('footer avec copyright InsTRAM visible', async ({ page }) => {
    await page.goto('/fr');
    // Le footer est la dernière section de la page
    await expect(page.locator('footer, [role="contentinfo"]').first()).toContainText('InsTRAM');
  });
});
