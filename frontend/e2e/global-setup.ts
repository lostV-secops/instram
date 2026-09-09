/**
 * Playwright global setup — seed E2E + sessions de test.
 *
 * 1. Lance `npm run seed:e2e` dans le répertoire backend (idempotent).
 *    Le seed crée les deux utilisateurs directement en DB (pré-vérifiés, sans OTP).
 * 2. Se connecte en tant que voyageur E2E et sauvegarde la session.
 * 3. Se connecte en tant que COOP_ADMIN et sauvegarde la session.
 *
 * Sessions générées :
 *  - e2e/.auth/user.json      — voyageur E2E
 *  - e2e/.auth/coop-admin.json — back-office COOP_ADMIN
 */
import { chromium, FullConfig } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';

const BASE = 'http://localhost:3000';

export const TEST_USER = {
  phone: '+261340000001',
  password: 'TestUser2024!',
};

export const COOP_ADMIN_USER = {
  phone: '+261340000002',
  password: 'CoopAdmin2024!',
};

export default async function globalSetup(_config: FullConfig) {
  // 0. Seed la base de données avec les données de test (trips, coopérative, utilisateurs)
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

  // 1. Se connecter en tant que voyageur E2E (créé par le seed, pré-vérifié)
  await page.goto('/fr/auth/login');
  await page.getByLabel(/e-mail|email/i).first().fill(TEST_USER.phone);
  await page.getByLabel(/mot de passe|teny miafina/i).first().fill(TEST_USER.password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 15_000 });

  // 2. Sauvegarder la session voyageur (cookies httpOnly inclus)
  await context.storageState({ path: 'e2e/.auth/user.json' });
  await context.clearCookies();

  // 3. Connexion COOP_ADMIN
  await page.goto('/fr/auth/login');
  await page.getByLabel(/e-mail|email/i).first().fill(COOP_ADMIN_USER.phone);
  await page.getByLabel(/mot de passe|teny miafina/i).first().fill(COOP_ADMIN_USER.password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 15_000 });

  // 4. Sauvegarder la session COOP_ADMIN
  await context.storageState({ path: 'e2e/.auth/coop-admin.json' });

  await browser.close();

  console.log('[E2E setup] Sessions sauvegardées — user.json + coop-admin.json.');
}
