'use client';

/**
 * Inviter un membre — /[lang]/coop/members/invite
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCoop } from '../../CoopContext';
import { getTranslations } from '@/lib/i18n';
import { Input } from '@/components/ui/Input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Button } from '@/components/ui/Button';
import type { CooperativeRole } from '@/lib/types';

interface FormErrors {
  phone?: string;
  role?: string;
}

export default function InviteMemberPage() {
  const router = useRouter();
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const ROLES: Array<{ value: CooperativeRole; label: string }> = [
    { value: 'COOP_ADMIN', label: t.coop.members.roles.COOP_ADMIN },
    { value: 'COOP_ASSISTANT', label: t.coop.members.roles.COOP_ASSISTANT },
    { value: 'COOP_DRIVER', label: t.coop.members.roles.COOP_DRIVER },
    { value: 'COOP_CONTROLLER', label: t.coop.members.roles.COOP_CONTROLLER },
  ];

  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CooperativeRole | ''>('');

  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!phone.trim() && !email.trim()) {
      e.phone = t.coop.members.invite.phone;
    }
    if (!role) e.role = t.coop.members.invite.selectRole;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSuccess(false);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = { role };
      if (phone.trim()) payload.phone = phone.trim();
      if (email.trim()) payload.email = email.trim();

      const res = await fetch('/api/proxy/v1/coop/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        setSubmitError('Ce membre est déjà présent dans votre coopérative.');
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Erreur ${res.status}`);
      }

      setSuccess(true);
      setPhone('');
      setEmail('');
      setRole('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(
        msg.toLowerCase().includes('fetch')
          ? t.common.errorNetwork
          : `Erreur : ${msg}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg space-y-4">
      <Link href={`/${lang}/coop/members`} className="text-brand text-sm hover:underline">← {t.coop.members.title}</Link>
      <h1 className="text-xl font-bold text-brand-dark">{t.coop.members.invite.title}</h1>

      {success && (
        <div
          role="status"
          className="bg-green-50 border border-green-300 text-green-700 rounded-xl px-4 py-4 text-sm flex items-start gap-3"
        >
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <div>
            <p className="font-medium">{t.coop.members.invite.success}</p>
            <p className="mt-0.5">{t.coop.members.invite.smsNote}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-gray-200 rounded-xl p-5" noValidate>
        <PhoneInput
          label={t.coop.members.invite.phone}
          value={phone}
          onChange={(value) => { setPhone(value); setErrors((p) => ({ ...p, phone: undefined })); }}
          error={errors.phone}
          hint={t.coop.members.invite.smsNote}
          disabled={isSubmitting}
        />

        <Input
          label={t.coop.members.invite.email}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isSubmitting}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="role-select" className="text-sm font-medium text-gray-800">
            {t.coop.members.invite.role} <span className="text-red-500">*</span>
          </label>
          <select
            id="role-select"
            value={role}
            onChange={(e) => { setRole(e.target.value as CooperativeRole); setErrors((p) => ({ ...p, role: undefined })); }}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
            aria-invalid={!!errors.role}
          >
            <option value="">{t.coop.members.invite.selectRole}...</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {errors.role && <p role="alert" className="text-xs text-red-600">{errors.role}</p>}
        </div>

        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
          {t.coop.members.invite.smsNote}
        </p>

        {submitError && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
            {submitError}
          </div>
        )}

        <Button type="submit" variant="action" fullWidth isLoading={isSubmitting}>
          {t.coop.members.invite.submit}
        </Button>
      </form>
    </div>
  );
}
