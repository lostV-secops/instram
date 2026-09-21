/**
 * Playwright global setup — seed E2E + sessions de test.
 *
 * 1. Lance `npm run seed:e2e` dans le répertoire backend (idempotent).
 * 2. Se connecte avec chaque compte et sauvegarde la session.
 *
 * Sessions générées :
 *  - e2e/.auth/user.json           — voyageur E2E
 *  - e2e/.auth/coop-admin.json     — back-office COOP_ADMIN
 *  - e2e/.auth/driver.json         — conducteur COOP_DRIVER
 *  - e2e/.auth/admin.json          — administrateur InsTRAM (ADMIN_OPS)
 *  - e2e/.auth/coop-assistant.json — assistant coopérative (COOP_ASSISTANT)
 *  - e2e/.auth/user-to-delete.json — compte destiné à être supprimé (tests VH-08)
 */
import { chromium, FullConfig } from '@playwright/test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const BASE = 'http://localhost:3000';
const AUTH_DIR = path.join(__dirname, '.auth');

const ACCOUNTS = [
  { phone: '+261340000001', password: 'TestUser2024!',      file: 'user.json' },
  { phone: '+261340000002', password: 'CoopAdmin2024!',     file: 'coop-admin.json' },
  { phone: '+261340000003', password: 'DriverE2E2024!',     file: 'driver.json' },
  { phone: '+261340000004', password: 'AdminInsTRAM2024!',  file: 'admin.json' },
  { phone: '+261340000005', password: 'AssistantE2E2024!',  file: 'coop-assistant.json' },
  { phone: '+261340000006', password: 'DeleteMe2024!!',     file: 'user-to-delete.json' },
] as const;

// Rétro-compatibilité : exports nommés utilisés dans certains tests
export const TEST_USER       = { phone: ACCOUNTS[0].phone, password: ACCOUNTS[0].password };
export const COOP_ADMIN_USER = { phone: ACCOUNTS[1].phone, password: ACCOUNTS[1].password };

export default async function globalSetup(_config: FullConfig) {
  // 0. Seed la base de données
  const backendDir = path.resolve(__dirname, '../../backend');
  console.log('[E2E setup] Lancement du seed E2E...');
  execSync('npm run seed:e2e', { cwd: backendDir, stdio: 'inherit', timeout: 60_000 });
  console.log('[E2E setup] Seed E2E terminé.');

  // Créer le répertoire .auth si nécessaire
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();

  for (const account of ACCOUNTS) {
    const context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();

    await page.goto('/fr/auth/login');
    await page.getByLabel(/e-mail|email/i).first().fill(account.phone);
    await page.getByLabel(/mot de passe|teny miafina/i).first().fill(account.password);
    await page.locator('form button[type="submit"]').click();

    try {
      await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 15_000 });
    } catch {
      console.warn(`[E2E setup] ⚠ Connexion échouée pour ${account.phone} — session vide sauvegardée`);
    }

    const sessionPath = path.join(AUTH_DIR, account.file);
    await context.storageState({ path: sessionPath });
    await context.close();
    console.log(`[E2E setup] ✓ Session ${account.file}`);
  }

  await browser.close();
  console.log('[E2E setup] Toutes les sessions sauvegardées.');
}
