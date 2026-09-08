/**
 * Parcours authentifiés — utilisent la session sauvegardée par global-setup.ts
 *
 * Parcours couverts :
 * - Accès à la page profil (information correctes)
 * - Accès à la liste des réservations
 * - Changement de langue depuis le profil (bug corrigé : ne doit pas afficher login)
 * - Déconnexion
 * - Navbar affiche "Mon profil" et "Mes réservations" quand connecté
 * - Menu hamburger mobile affiche les liens authentifiés
 */
import { test, expect } from '@playwright/test';
import { TEST_USER } from './global-setup';

// Réutilise la session sauvegardée — pas de re-login à chaque test
test.use({ storageState: 'e2e/.auth/user.json' });

test.describe('Page profil', () => {
  test('accessible quand connecte', async ({ page }) => {
    await page.goto('/fr/profile');
    await page.waitForLoadState('domcontentloaded');
    // Pas de redirection vers login
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page).toHaveURL(/\/profile/);
  });

  test('affiche le nom du bon utilisateur', async ({ page }) => {
    await page.goto('/fr/profile');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toContainText(TEST_USER.firstName, { timeout: 10_000 });
  });

  test('affiche le numero de telephone', async ({ page }) => {
    await page.goto('/fr/profile');
    await page.waitForLoadState('domcontentloaded');
    // Le numéro de téléphone est affiché quelque part
    await expect(page.locator('body')).toContainText(TEST_USER.phone.replace('+261', ''), { timeout: 10_000 });
  });

  test('bouton Voir mes reservations visible', async ({ page }) => {
    await page.goto('/fr/profile');
    await page.waitForLoadState('domcontentloaded');
    const btn = page.getByRole('link', { name: /réservations|fandraharahako/i }).first();
    await expect(btn).toBeVisible({ timeout: 10_000 });
  });

  test('bouton Deconnexion visible', async ({ page }) => {
    await page.goto('/fr/profile');
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.getByRole('button', { name: /déconnexion|hivoaka/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Changement de langue connecte', () => {
  test('basculer FR vers MG depuis le profil ne redirige pas vers login', async ({ page }) => {
    await page.goto('/fr/profile');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/fr\/profile/);

    await page.getByRole('link', { name: /malagasy/i }).click();
    // Doit rester sur le profil — pas de redirection vers login
    await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/mg\/profile/);
  });

  test('basculer MG vers FR depuis le profil reste authentifie', async ({ page }) => {
    await page.goto('/mg/profile');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).not.toHaveURL(/\/auth\/login/);

    await page.getByRole('link', { name: /français/i }).click();
    await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/fr\/profile/);
  });

  test('changement de langue depuis la page accueil reste authentifie', async ({ page }) => {
    await page.goto('/fr');
    await page.getByRole('link', { name: /malagasy/i }).click();
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page).toHaveURL(/\/mg(\/|$)/);
  });
});

test.describe('Liste des reservations', () => {
  test('accessible quand connecte', async ({ page }) => {
    await page.goto('/fr/bookings');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page).toHaveURL(/\/bookings/);
  });

  test('affiche un titre ou message pas de reservations', async ({ page }) => {
    await page.goto('/fr/bookings');
    await page.waitForLoadState('domcontentloaded');
    // Soit des réservations, soit un message "aucune réservation"
    await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Navbar authentifiee', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('liens Mon profil et Mes reservations visibles sur desktop', async ({ page }) => {
    await page.goto('/fr');
    await expect(page.locator('nav ul a[href*="/profile"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('nav ul a[href*="/bookings"]')).toBeVisible({ timeout: 8_000 });
  });

  test('lien connexion absent quand connecte', async ({ page }) => {
    await page.goto('/fr');
    // Le lien "Se connecter" ne doit pas être dans la nav principale
    const loginLink = page.locator('nav ul a[href*="/auth/login"]');
    await expect(loginLink).toHaveCount(0);
  });
});

test.describe('Navbar mobile authentifiee', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('menu hamburger affiche liens profil et reservations', async ({ page }) => {
    await page.goto('/fr');
    await page.getByRole('button', { name: /ouvrir le menu/i }).click();

    const menu = page.locator('#mobile-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('a[href*="/profile"]')).toBeVisible();
    await expect(menu.locator('a[href*="/bookings"]')).toBeVisible();
  });

  test('menu hamburger affiche bouton deconnexion', async ({ page }) => {
    await page.goto('/fr');
    await page.getByRole('button', { name: /ouvrir le menu/i }).click();
    await expect(
      page.locator('#mobile-menu').getByRole('button', { name: /déconnexion|hivoaka/i })
    ).toBeVisible();
  });
});

test.describe('Deconnexion', () => {
  // Ce test modifie la session — l'isoler avec un contexte frais
  test('deconnexion redirige vers la page accueil non authentifiee', async ({ page }) => {
    await page.goto('/fr/profile');
    await page.waitForLoadState('domcontentloaded');

    // Cliquer sur Déconnexion
    await page.getByRole('button', { name: /déconnexion|hivoaka/i }).first().click();
    // Redirection vers l'accueil ou la page login
    await expect(page).toHaveURL(/\/fr(\/|$)/, { timeout: 10_000 });

    // Après déconnexion, aller sur /profile doit rediriger vers login
    await page.goto('/fr/profile');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 8_000 });
  });
});
