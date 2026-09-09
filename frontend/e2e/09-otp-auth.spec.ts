/**
 * Tests E2E — Auth OTP : inscription → vérification, reset mot de passe, sessions
 *
 * Stratégie :
 * - Tests UI/navigation : vrais appels backend (serveurs doivent tourner)
 * - Tests OTP : page.route() intercepte /api/auth/* pour simuler les réponses
 *   sans dépendre du code aléatoire généré (inaccessible côté test)
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Intercepte POST /api/auth/register et renvoie requiresVerification */
async function mockRegisterOtpRequired(page: Page, target: string) {
  await page.route('/api/auth/register', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ requiresVerification: true, target }),
    });
  });
}

/** Intercepte POST /api/auth/verify et renvoie des faux tokens */
async function mockVerifySuccess(page: Page) {
  await page.route('/api/auth/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
        expiresIn: 900,
        user: { id: 'test-id', email: null, roles: ['TRAVELER'] },
      }),
    });
  });
}

/** Intercepte POST /api/auth/verify et renvoie OTP invalide */
async function mockVerifyFail(page: Page) {
  await page.route('/api/auth/verify', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'OTP_INVALID', message: 'Code incorrect ou expiré' }),
    });
  });
}

// ─── Tests page /auth/verify ─────────────────────────────────────────────────

test.describe('Page vérification OTP', () => {
  test('affiche le bon titre et la cible', async ({ page }) => {
    await page.goto('/fr/auth/verify?target=%2B261340000077');
    await expect(page.locator('h1')).toContainText(/vérification/i);
    await expect(page.locator('body')).toContainText('+261340000077');
    await expect(page.getByLabel(/code de vérification/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /vérifier/i })).toBeVisible();
  });

  test('bouton Renvoyer le code est présent', async ({ page }) => {
    await page.goto('/fr/auth/verify?target=%2B261340000077');
    await expect(page.getByRole('button', { name: /renvoyer/i })).toBeVisible();
  });

  test('OTP invalide affiche un message erreur', async ({ page }) => {
    await mockVerifyFail(page);
    await page.goto('/fr/auth/verify?target=%2B261340000077');

    const codeInput = page.getByLabel(/code de vérification/i);
    await codeInput.fill('000000');
    await page.getByRole('button', { name: /vérifier/i }).click();

    const alert = page.locator('.text-red-700').first();
    await expect(alert).toBeVisible({ timeout: 8_000 });
    await expect(alert).toContainText(/incorrect|expiré/i);
    await expect(page).toHaveURL(/\/auth\/verify/);
  });

  test('code non numérique est filtré automatiquement', async ({ page }) => {
    await page.goto('/fr/auth/verify?target=%2B261340000077');
    const input = page.getByLabel(/code de vérification/i);
    await input.fill('ab1cd2');
    // Seulement les chiffres doivent rester
    await expect(input).toHaveValue('12');
  });

  test('OTP valide (mocké) redirige vers accueil', async ({ page }) => {
    await mockVerifySuccess(page);
    await page.goto('/fr/auth/verify?target=%2B261340000077');

    await page.getByLabel(/code de vérification/i).fill('123456');
    await page.getByRole('button', { name: /vérifier/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/auth/verify'), { timeout: 8_000 });
    await expect(page).not.toHaveURL(/\/auth\/verify/);
  });
});

// ─── Tests flow inscription → OTP ────────────────────────────────────────────

test.describe('Flow inscription → OTP', () => {
  test('inscription réussie redirige vers /auth/verify', async ({ page }) => {
    const phone = '+261340000011';
    await mockRegisterOtpRequired(page, phone);

    await page.goto('/fr/auth/register');
    await page.getByLabel(/prénom/i).fill('Test');
    await page.getByLabel(/nom de famille/i).fill('OTP');
    await page.locator('input[type="tel"]').fill(phone);
    await page.locator('input[type="password"]').fill('MotDePasse2024!');
    await page.getByRole('button', { name: /créer mon compte/i }).click();

    await page.waitForURL(/\/auth\/verify/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/auth\/verify/);
    await expect(page.locator('body')).toContainText(phone);
  });

  test('compte déjà existant affiche erreur 409', async ({ page }) => {
    await page.route('/api/auth/register', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'DUPLICATE_PHONE', message: 'Numéro déjà utilisé' }),
      });
    });

    await page.goto('/fr/auth/register');
    await page.getByLabel(/prénom/i).fill('Test');
    await page.getByLabel(/nom de famille/i).fill('Dupe');
    await page.locator('input[type="tel"]').fill('+261340000001');
    await page.locator('input[type="password"]').fill('MotDePasse2024!');
    await page.getByRole('button', { name: /créer mon compte/i }).click();

    const alert = page.locator('.text-red-700').first();
    await expect(alert).toBeVisible({ timeout: 6_000 });
    await expect(alert).toContainText(/existe déjà/i);
    await expect(page).toHaveURL(/\/auth\/register/);
  });
});

// ─── Tests page /auth/forgot-password ────────────────────────────────────────

test.describe('Page mot de passe oublié', () => {
  test('affiche le formulaire avec champ cible', async ({ page }) => {
    await page.goto('/fr/auth/forgot-password');
    await expect(page.locator('h1')).toContainText(/oublié|oubli/i);
    await expect(page.getByLabel(/e-mail ou téléphone/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /envoyer/i })).toBeVisible();
  });

  test('envoi réussi (mocké) affiche confirmation et redirige', async ({ page }) => {
    await page.route('/api/auth/password/reset-request', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Si ce compte existe, un code a été envoyé' }),
      });
    });

    await page.goto('/fr/auth/forgot-password');
    await page.getByLabel(/e-mail ou téléphone/i).fill('+261340000001');
    await page.getByRole('button', { name: /envoyer/i }).click();

    await expect(page.locator('.text-green-700').first()).toBeVisible({ timeout: 6_000 });
    // Après 2s la page redirige vers /auth/reset-password
    await page.waitForURL(/\/auth\/reset-password/, { timeout: 5_000 });
    await expect(page).toHaveURL(/\/auth\/reset-password/);
  });
});

// ─── Tests page /auth/reset-password ─────────────────────────────────────────

test.describe('Page reset mot de passe', () => {
  test('affiche les champs code OTP et nouveau mot de passe', async ({ page }) => {
    await page.goto('/fr/auth/reset-password?target=%2B261340000001');
    await expect(page.locator('h1')).toContainText(/nouveau mot de passe/i);
    await expect(page.getByLabel(/code de vérification/i)).toBeVisible();
    await expect(page.getByLabel(/nouveau mot de passe/i).first()).toBeVisible();
  });

  test('reset réussi (mocké) redirige vers login', async ({ page }) => {
    await page.route('/api/auth/password/reset', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Mot de passe réinitialisé' }),
      });
    });

    await page.goto('/fr/auth/reset-password?target=%2B261340000001');
    await page.getByLabel(/code de vérification/i).fill('123456');
    await page.locator('input[type="password"]').fill('NouveauMDP2024!');
    await page.getByRole('button', { name: /réinitialiser/i }).click();

    await expect(page.locator('.text-green-700').first()).toBeVisible({ timeout: 6_000 });
    await page.waitForURL(/\/auth\/login/, { timeout: 5_000 });
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('code OTP invalide affiche erreur', async ({ page }) => {
    await page.route('/api/auth/password/reset', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'OTP_INVALID', message: 'Code incorrect ou expiré' }),
      });
    });

    await page.goto('/fr/auth/reset-password?target=%2B261340000001');
    await page.getByLabel(/code de vérification/i).fill('000000');
    await page.locator('input[type="password"]').fill('NouveauMDP2024!');
    await page.getByRole('button', { name: /réinitialiser/i }).click();

    await expect(page.locator('.text-red-700').first()).toBeVisible({ timeout: 6_000 });
    await expect(page).toHaveURL(/\/auth\/reset-password/);
  });
});

// ─── Tests compte non vérifié (login) ────────────────────────────────────────

test.describe('Login compte non vérifié', () => {
  test('403 ACCOUNT_NOT_VERIFIED redirige vers /auth/verify', async ({ page }) => {
    await page.route('/api/auth/login', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'ACCOUNT_NOT_VERIFIED',
          message: 'Compte non vérifié',
          target: '+261340000055',
        }),
      });
    });

    await page.goto('/fr/auth/login');
    await page.getByLabel(/e-mail|email/i).first().fill('+261340000055');
    await page.getByLabel(/mot de passe/i).first().fill('MotDePasse2024!');
    await page.locator('form button[type="submit"]').click();

    await page.waitForURL(/\/auth\/verify/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/auth\/verify/);
    await expect(page.locator('body')).toContainText('+261340000055');
  });
});
