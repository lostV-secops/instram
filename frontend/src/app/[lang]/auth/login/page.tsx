'use client';

/**
 * Page de connexion — /fr/auth/login
 *
 * Client Component : formulaire interactif.
 * Soumet via POST /api/auth/login (Route Handler Next.js) qui stocke
 * l'access_token dans un cookie httpOnly.
 *
 * États obligatoires :
 * - Chargement : spinner, bouton désactivé
 * - Erreur réseau : message explicite
 * - Erreur credentials : message en-dessous du formulaire
 */

import { useState, useId, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

const loginSchema = z.object({
  credential: z.string().min(1),
  password: z.string().min(1),
});

export default function LoginPage() {
  const t = useTranslations();
  const lang = useLang();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') ?? `/${lang}`;

  const [credential, setCredential] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const credId = useId();
  const pwdId = useId();

  function validate(): boolean {
    const result = loginSchema.safeParse({ credential, password });
    if (!result.success) {
      const errs: Record<string, string> = {};
      if (!credential) errs.credential = t.auth.errorEmailRequired;
      if (!password)
        errs.password =
          lang === 'fr' ? 'Le mot de passe est requis' : 'Ilaina ny teny miafina';
      setErrors(errs);
      return false;
    }
    setErrors({});
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate() || isLoading) return;

    setIsLoading(true);
    setGlobalError(null);

    try {
      // Détecter si c'est un email ou un téléphone
      const isEmail = credential.includes('@');
      const body = isEmail
        ? { email: credential, password }
        : { phone: credential, password };

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.status === 401) {
        setGlobalError(t.auth.errorInvalidCredentials);
        return;
      }

      if (!response.ok) {
        if (!navigator.onLine) {
          setGlobalError(t.common.errorNetwork);
        } else {
          setGlobalError(t.common.errorServer);
        }
        return;
      }

      // Succès : afficher le message 1,5 s avant de rediriger
      setSuccess(true);
      setTimeout(() => {
        router.push(redirectTo);
        router.refresh();
      }, 1500);
    } catch {
      setGlobalError(t.common.errorNetwork);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">
        {t.auth.loginTitle}
      </h1>

      {/* Bannière succès */}
      {success && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-3 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          <span className="text-xl">✅</span>
          <span className="font-medium">{t.auth.successLogin}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        className="bg-white rounded-xl border border-gray-200 p-5 space-y-4"
        aria-label={t.auth.loginTitle}
      >
        {/* Erreur globale */}
        {globalError && (
          <div
            role="alert"
            aria-live="assertive"
            className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm"
          >
            {globalError}
          </div>
        )}

        <Input
          id={credId}
          label={t.auth.emailOrPhone}
          type="text"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          error={errors.credential}
          required
          autoComplete="username"
          inputMode="email"
          placeholder={lang === 'fr' ? 'email@exemple.mg ou +261 34...' : 'mailaka na +261 34...'}
        />

        <Input
          id={pwdId}
          label={t.auth.password}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
          autoComplete="current-password"
        />

        {/* Bouton connexion — bleu brand (pas vert) */}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          isLoading={isLoading}
          disabled={success}
        >
          {success ? '✅ ' + t.auth.successLogin : isLoading ? t.auth.loggingIn : t.auth.loginButton}
        </Button>

        <div className="text-center text-sm text-gray-600">
          {t.auth.noAccount}{' '}
          <Link
            href={`/${lang}/auth/register`}
            className="text-brand font-medium hover:underline"
          >
            {t.nav.register}
          </Link>
        </div>
      </form>
    </div>
  );
}
