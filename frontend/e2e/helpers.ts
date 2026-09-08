import { Page } from '@playwright/test';

export const BASE = 'http://localhost:3000';
export const TEST_PHONE = '+261341112233';
export const TEST_PASSWORD = 'TestPass1234';

/** Connecte un utilisateur existant via le formulaire de login */
export async function loginAs(page: Page, credential: string, password: string) {
  await page.goto('/fr/auth/login');
  await page.getByLabel(/mailaka|email|identifiant/i).fill(credential);
  await page.getByLabel(/teny miafina|mot de passe/i).first().fill(password);
  await page.getByRole('button', { name: /hiditra|connexion/i }).click();
  // Attendre la redirection après connexion
  await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 10_000 });
}

/** Déconnecte l'utilisateur courant */
export async function logout(page: Page) {
  await page.getByRole('button', { name: /déconnexion|hivoaka/i }).click();
  await page.waitForURL('**/fr**', { timeout: 5_000 });
}
