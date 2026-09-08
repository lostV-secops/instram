/**
 * Playwright global setup — seed E2E + login utilisateur de test.
 *
 * 1. Lance `npm run seed:e2e` dans le répertoire backend (idempotent).
 * 2. Crée l'utilisateur de test via l'API (409 ignoré si déjà existant).
 * 3. Se connecte via le formulaire et sauvegarde la session dans e2e/.auth/user.json.
 */
import { chromium, FullConfig } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';

const BASE = 'http://localhost:3000';

export const TEST_USER = {
  firstName: 'TestE2E',
  lastName: 'Playwright',
  phone: '+261340000001',
  password: 'TestE2E2024!',
  preferredLang: 'FR',
};

export default async function globalSetup(_config: FullConfig) {
  // 0. Seed la base de données avec les données de test (trips, coopérative, etc.)
  const backendDir = path.resolve(__dirname, '../../backend');
  console.log('[E2E setup] Lancement du seed E2E base de données...');
  execSync('npm run seed:e2e', {
    cwd: backendDir,
    stdio: 'inherit',
    timeout: 60_000,
  });
  console.log('[E2E setup] Seed E2E terminé.');

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();

  // 1. Créer l'utilisateur de test (ignorer 409 si déjà existant)
  const regRes = await page.request.post('/api/auth/register', {
    data: {
      firstName: TEST_USER.firstName,
      lastName: TEST_USER.lastName,
      phone: TEST_USER.phone,
      password: TEST_USER.password,
      preferredLang: TEST_USER.preferredLang,
    },
  });
  if (!regRes.ok() && regRes.status() !== 409) {
    const body = await regRes.text();
    throw new Error(`Impossible de créer l'utilisateur de test (${regRes.status()}): ${body}`);
  }

  // 2. Se connecter via le formulaire pour obtenir les cookies httpOnly
  await page.goto('/fr/auth/login');
  await page.getByLabel(/e-mail|email/i).first().fill(TEST_USER.phone);
  await page.getByLabel(/mot de passe|teny miafina/i).first().fill(TEST_USER.password);
  // Cibler le bouton submit du formulaire (pas le bouton Déconnexion de la navbar)
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 15_000 });

  // 3. Sauvegarder la session (cookies httpOnly inclus)
  await context.storageState({ path: 'e2e/.auth/user.json' });
  await browser.close();

  console.log('[E2E setup] Utilisateur de test connecté — session sauvegardée.');
}
