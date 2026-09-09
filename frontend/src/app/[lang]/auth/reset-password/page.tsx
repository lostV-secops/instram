'use client';

import { useState, useId, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export default function ResetPasswordPage() {
  const t = useTranslations();
  const lang = useLang();
  const router = useRouter();
  const searchParams = useSearchParams();
  const target = searchParams.get('target') ?? '';

  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const codeId = useId();
  const pwdId = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.match(/^\d{6}$/) || newPassword.length < 10 || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, code, newPassword }),
      });

      if (res.status === 429) {
        setError(t.auth.otpLocked);
        return;
      }

      if (!res.ok) {
        setError(t.auth.otpInvalid);
        return;
      }

      setSuccess(true);
      setTimeout(() => router.push(`/${lang}/auth/login`), 2500);
    } catch {
      setError(t.common.errorNetwork);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">
        {t.auth.resetPasswordTitle}
      </h1>
      <p className="text-sm text-gray-600 text-center mb-6">
        {t.auth.otpSentTo}{' '}
        <span className="font-medium text-gray-900">{target}</span>
      </p>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="bg-white rounded-xl border border-gray-200 p-5 space-y-4"
        aria-label={t.auth.resetPasswordTitle}
      >
        {error && (
          <div role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="mt-0.5">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div role="status" className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
            {t.auth.resetPasswordSuccess}
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

        <Input
          id={pwdId}
          label={t.auth.newPassword}
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          autoComplete="new-password"
          minLength={10}
        />

        <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isLoading}>
          {isLoading ? t.auth.resettingPassword : t.auth.resetPasswordButton}
        </Button>

        <div className="text-center text-sm text-gray-600">
          <Link href={`/${lang}/auth/forgot-password`} className="text-brand font-medium hover:underline">
            {t.auth.otpResend}
          </Link>
        </div>
      </form>
    </div>
  );
}
