'use client';

/**
 * Page d'inscription — /fr/auth/register
 *
 * Client Component : formulaire interactif avec validation Zod.
 * Soumet via POST /api/auth/register (Route Handler Next.js).
 */

import { useState, useId, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import type { Lang } from '@/lib/types';

const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  password: z.string().min(10),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export default function RegisterPage() {
  const t = useTranslations();
  const lang = useLang();
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [preferredLang, setPreferredLang] = useState<Lang>(lang);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const fnId = useId();
  const lnId = useId();
  const emailId = useId();
  const phoneId = useId();
  const pwdId = useId();
  const langId = useId();

  function validate(): boolean {
    const errs: Record<string, string> = {};

    if (!firstName.trim()) errs.firstName = t.auth.errorEmailRequired;
    if (!lastName.trim()) errs.lastName = t.auth.errorEmailRequired;
    if (!email.trim() && !phone.trim()) {
      errs.email = t.auth.errorEmailRequired;
    }
    if (email && !email.includes('@')) {
      errs.email = t.auth.errorEmailInvalid;
    }
    if (password.length < 10) {
      errs.password = t.auth.errorPasswordTooShort;
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate() || isLoading) return;

    setIsLoading(true);
    setGlobalError(null);

    try {
      const body: Record<string, unknown> = {
        firstName,
        lastName,
        password,
        preferredLang,
      };
      if (email) body.email = email;
      if (phone) body.phone = phone;

      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.status === 409) {
        setGlobalError(t.auth.errorAlreadyExists);
        return;
      }

      if (!response.ok) {
        setGlobalError(t.common.errorServer);
        return;
      }

      // Rediriger vers la page d'accueil après inscription
      router.push(`/${lang}`);
      router.refresh();
    } catch {
      setGlobalError(t.common.errorNetwork);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">
        {t.auth.registerTitle}
      </h1>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="bg-white rounded-xl border border-gray-200 p-5 space-y-4"
        aria-label={t.auth.registerTitle}
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

        {/* Nom et Prénom */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            id={fnId}
            label={t.auth.firstName}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            error={errors.firstName}
            required
            autoComplete="given-name"
          />
          <Input
            id={lnId}
            label={t.auth.lastName}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            error={errors.lastName}
            required
            autoComplete="family-name"
          />
        </div>

        <Input
          id={emailId}
          label={t.auth.email}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          autoComplete="email"
          inputMode="email"
          hint={
            lang === 'fr'
              ? 'Ou renseignez votre téléphone ci-dessous'
              : 'Na asio ny finday eto ambany'
          }
        />

        <Input
          id={phoneId}
          label={t.auth.phone}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          inputMode="tel"
          placeholder="+261 34 XX XX XXX"
        />

        <Input
          id={pwdId}
          label={t.auth.newPassword}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
          autoComplete="new-password"
          minLength={10}
        />

        {/* Préférence de langue */}
        <div className="flex flex-col gap-1">
          <label htmlFor={langId} className="text-sm font-medium text-gray-800">
            {t.auth.preferredLang}
          </label>
          <select
            id={langId}
            value={preferredLang}
            onChange={(e) => setPreferredLang(e.target.value as Lang)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand bg-white"
          >
            <option value="fr">Français</option>
            <option value="mg">Malagasy</option>
          </select>
        </div>

        {/* Bouton inscription — bleu brand (pas vert) */}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          isLoading={isLoading}
        >
          {isLoading ? t.auth.registering : t.auth.registerButton}
        </Button>

        <div className="text-center text-sm text-gray-600">
          {t.auth.hasAccount}{' '}
          <Link
            href={`/${lang}/auth/login`}
            className="text-brand font-medium hover:underline"
          >
            {t.auth.loginButton}
          </Link>
        </div>
      </form>
    </div>
  );
}
