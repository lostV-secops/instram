'use client';

/**
 * Page de vérification OTP — /fr/auth/verify?target=...
 *
 * Affichée après l'inscription. L'utilisateur saisit le code à 6 chiffres
 * reçu par SMS (ou e-mail). Sur succès, les cookies de session sont posés
 * et l'utilisateur est redirigé vers l'accueil.
 */

import { useState, useId, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export default function VerifyPage() {
  const t = useTranslations();
  const lang = useLang();
  const router = useRouter();
  const searchParams = useSearchParams();
  const target = searchParams.get('target') ?? '';

  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState(false);
  const codeId = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.match(/^\d{6}$/) || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, code, purpose: 'REGISTRATION_VERIFY' }),
      });

      if (res.status === 429) {
        setError(t.auth.otpLocked);
        return;
      }

      if (!res.ok) {
        setError(t.auth.otpInvalid);
        return;
      }

      router.push(`/${lang}`);
      router.refresh();
    } catch {
      setError(t.common.errorNetwork);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResend() {
    if (isResending) return;
    setIsResending(true);
    setResendSuccess(false);
    setError(null);

    try {
      const res = await fetch('/api/auth/verify/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, purpose: 'REGISTRATION_VERIFY' }),
      });

      if (res.status === 429) {
        setError(t.auth.otpLocked);
        return;
      }

      if (res.ok) {
        setResendSuccess(true);
      }
    } catch {
      setError(t.common.errorNetwork);
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">
        {t.auth.verifyTitle}
      </h1>
      <p className="text-sm text-gray-600 text-center mb-6">
        {t.auth.otpSentTo}{' '}
        <span className="font-medium text-gray-900">{target}</span>
      </p>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="bg-white rounded-xl border border-gray-200 p-5 space-y-4"
        aria-label={t.auth.verifyTitle}
      >
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <span className="mt-0.5">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {resendSuccess && !error && (
          <div
            role="status"
            className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700"
          >
            {t.auth.otpResent}
          </div>
        )}

        <Input
          id={codeId}
          label={t.auth.otpCode}
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
          autoComplete="one-time-code"
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          isLoading={isLoading}
        >
          {isLoading ? t.auth.otpVerifying : t.auth.otpVerifyButton}
        </Button>

        <div className="text-center">
          <button
            type="button"
            onClick={handleResend}
            disabled={isResending}
            className="text-sm text-brand hover:underline disabled:opacity-50"
          >
            {isResending ? t.auth.otpResending : t.auth.otpResend}
          </button>
        </div>

        <div className="text-center text-sm text-gray-600">
          <Link href={`/${lang}/auth/login`} className="text-brand font-medium hover:underline">
            {t.auth.loginButton}
          </Link>
        </div>
      </form>
    </div>
  );
}
