import { test, expect } from '@playwright/test';

test.describe('Connexion', () => {
  test('formulaire login visible avec champs requis', async ({ page }) => {
    await page.goto('/fr/auth/login');
    // Titre de la page
    await expect(page.locator('h1')).toContainText(/connexion|hiditra/i);
    // Champ identifiant — label = "E-mail ou téléphone"
    await expect(page.getByLabel(/e-mail|email|mailaka/i).first()).toBeVisible();
    // Champ mot de passe
    await expect(page.getByLabel(/mot de passe|teny miafina/i).first()).toBeVisible();
    // Bouton de soumission
    await expect(page.getByRole('button', { name: /se connecter|connexion|hiditra/i })).toBeVisible();
  });

  test('credentials invalides affichent un message erreur', async ({ page }) => {
    await page.goto('/fr/auth/login');
    await page.getByLabel(/e-mail|email|mailaka/i).first().fill('invalide@test.mg');
    await page.getByLabel(/mot de passe|teny miafina/i).first().fill('mauvaismdp123');
    await page.getByRole('button', { name: /se connecter|connexion|hiditra/i }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 12_000 });
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('champs vides declenchent la validation', async ({ page }) => {
    await page.goto('/fr/auth/login');
    await page.getByRole('button', { name: /se connecter|connexion|hiditra/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('aucun texte Redirection en cours dans la page login', async ({ page }) => {
    await page.goto('/fr/auth/login');
    await expect(page.locator('body')).not.toContainText('Redirection en cours');
  });

  test('lien vers inscription fonctionnel', async ({ page }) => {
    await page.goto('/fr/auth/login');
    // Cibler le lien visible dans le contenu de la page (pas le lien navbar caché sur mobile)
    const registerLink = page.locator('main a[href*="/auth/register"], form ~ div a[href*="/auth/register"], .text-center a[href*="/auth/register"]').first();
    await expect(registerLink).toBeVisible();
    await registerLink.click();
    await expect(page).toHaveURL(/\/auth\/register/);
  });
});

test.describe('Inscription', () => {
  test('formulaire inscription visible', async ({ page }) => {
    await page.goto('/fr/auth/register');
    await expect(page.locator('h1')).toContainText(/inscription|créer|kaonty/i);
    await expect(page.getByLabel(/prénom|anarana/i)).toBeVisible();
    await expect(page.getByLabel(/nom de famille|fianakaviana/i)).toBeVisible();
    await expect(page.getByLabel(/nouveau mot de passe|teny miafina/i).first()).toBeVisible();
  });

  test('mot de passe trop court bloque la soumission', async ({ page }) => {
    await page.goto('/fr/auth/register');
    await page.getByLabel(/prénom|anarana/i).fill('Test');
    await page.getByLabel(/nom de famille|fianakaviana/i).fill('User');
    await page.getByLabel(/adresse e-mail|email|mailaka/i).first().fill('test@example.mg');
    await page.getByLabel(/nouveau mot de passe|teny miafina/i).first().fill('court');
    await page.getByRole('button', { name: /créer|mamorona/i }).click();

    await expect(page.locator('.text-red-600, .text-amber-600, [role="alert"]').first()).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/register/);
  });

  test('ni email ni telephone bloque la soumission', async ({ page }) => {
    await page.goto('/fr/auth/register');
    await page.getByLabel(/prénom|anarana/i).fill('Test');
    await page.getByLabel(/nom de famille|fianakaviana/i).fill('User');
    await page.getByLabel(/nouveau mot de passe|teny miafina/i).first().fill('MotDePasse2024!');
    await page.getByRole('button', { name: /créer|mamorona/i }).click();

    await expect(page.locator('.text-red-600, [role="alert"]').first()).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/register/);
  });

  test('lien vers connexion fonctionnel', async ({ page }) => {
    await page.goto('/fr/auth/register');
    // Cibler le lien dans le formulaire (visible sur mobile et desktop)
    const loginLink = page.locator('.text-center a[href*="/auth/login"]').first();
    await expect(loginLink).toBeVisible();
    await loginLink.click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
