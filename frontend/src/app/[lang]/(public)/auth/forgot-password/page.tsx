'use client';

import { useState, useId, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export default function ForgotPasswordPage() {
  const t = useTranslations();
  const lang = useLang();
  const router = useRouter();

  const [target, setTarget] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetId = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/password/reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });

      if (!res.ok && res.status !== 200) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t.common.errorServer);
        return;
      }

      setSent(true);
      setTimeout(() => {
        router.push(`/${lang}/auth/reset-password?target=${encodeURIComponent(target)}`);
      }, 2000);
    } catch {
      setError(t.common.errorNetwork);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">
        {t.auth.forgotPasswordTitle}
      </h1>
      <p className="text-sm text-gray-600 text-center mb-6">
        {t.auth.forgotPasswordSub}
      </p>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="bg-white rounded-xl border border-gray-200 p-5 space-y-4"
        aria-label={t.auth.forgotPasswordTitle}
      >
        {error && (
          <div role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="mt-0.5">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {sent && (
          <div role="status" className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
            {t.auth.resetCodeSent}
          </div>
        )}

        <Input
          id={targetId}
          label={t.auth.emailOrPhone}
          type="text"
          inputMode="email"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required
          autoComplete="email"
        />

        <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isLoading}>
          {isLoading ? t.auth.sendingResetCode : t.auth.sendResetCode}
        </Button>

        <div className="text-center text-sm text-gray-600">
          <Link href={`/${lang}/auth/login`} className="text-brand font-medium hover:underline">
            {t.auth.loginButton}
          </Link>
        </div>
      </form>
    </div>
  );
}
