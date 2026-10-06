'use client';

import { useState, useEffect, useRef } from 'react';
import { useCoop } from '../CoopContext';
import { getTranslations } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CoopProfile {
  id: string;
  legalName: string;
  displayName: string;
  status: 'PENDING_VALIDATION' | 'VALIDATED' | 'SUSPENDED' | 'REJECTED';
  contactEmail: string | null;
  contactPhone: string | null;
  logoUrl: string | null;
  descriptionFr: string | null;
  descriptionMg: string | null;
}

interface Policy {
  id: string;
  titleFr: string;
  titleMg: string;
  bodyFr: string;
  bodyMg: string;
  version: number;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function Field({
  label, children, readOnly = false,
}: { label: string; children: React.ReactNode; readOnly?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {readOnly && <span className="ml-1 text-xs text-gray-400">(lecture seule)</span>}
      </label>
      {children}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${
        props.readOnly
          ? 'border-gray-200 bg-gray-50 text-gray-500 cursor-default'
          : 'border-gray-300 bg-white'
      } ${props.className ?? ''}`}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={4}
      {...props}
      className={`border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-y ${
        props.readOnly
          ? 'border-gray-200 bg-gray-50 text-gray-500 cursor-default'
          : 'border-gray-300 bg-white'
      } ${props.className ?? ''}`}
    />
  );
}

function StatusBadge({ status, t }: { status: CoopProfile['status']; t: ReturnType<typeof getTranslations> }) {
  const map: Record<CoopProfile['status'], string> = {
    PENDING_VALIDATION: 'bg-yellow-100 text-yellow-700',
    VALIDATED:          'bg-green-100 text-green-700',
    SUSPENDED:          'bg-red-100 text-red-700',
    REJECTED:           'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status]}`}>
      {t.coop.settings.statuses[status]}
    </span>
  );
}

// ─── Section Profil ──────────────────────────────────────────────────────────

function ProfileSection({
  coop, t, onSaved,
}: {
  coop: CoopProfile;
  t: ReturnType<typeof getTranslations>;
  onSaved: (updated: CoopProfile) => void;
}) {
  const [displayName, setDisplayName] = useState(coop.displayName ?? '');
  const [contactEmail, setContactEmail] = useState(coop.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(coop.contactPhone ?? '');
  const [logoUrl, setLogoUrl] = useState(coop.logoUrl ?? '');
  const [descriptionFr, setDescriptionFr] = useState(coop.descriptionFr ?? '');
  const [descriptionMg, setDescriptionMg] = useState(coop.descriptionMg ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const dirty =
    displayName !== (coop.displayName ?? '') ||
    contactEmail !== (coop.contactEmail ?? '') ||
    contactPhone !== (coop.contactPhone ?? '') ||
    logoUrl !== (coop.logoUrl ?? '') ||
    descriptionFr !== (coop.descriptionFr ?? '') ||
    descriptionMg !== (coop.descriptionMg ?? '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const body: Record<string, string> = {};
      if (displayName !== coop.displayName) body.displayName = displayName;
      if (contactEmail !== (coop.contactEmail ?? '')) body.contactEmail = contactEmail;
      if (contactPhone !== (coop.contactPhone ?? '')) body.contactPhone = contactPhone;
      if (logoUrl !== (coop.logoUrl ?? '')) body.logoUrl = logoUrl;
      if (descriptionFr !== (coop.descriptionFr ?? '')) body.descriptionFr = descriptionFr;
      if (descriptionMg !== (coop.descriptionMg ?? '')) body.descriptionMg = descriptionMg;

      const res = await fetch('/api/proxy/v1/coop/cooperatives/current', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Erreur ${res.status}`);
      const updated: CoopProfile = await res.json();
      onSaved(updated);
      setFeedback({ ok: true, msg: t.coop.settings.success });
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Erreur réseau' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <h2 className="text-base font-semibold text-brand-dark">{t.coop.settings.officialInfoTitle}</h2>

      {/* Informations lecture seule */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
        <Field label={t.coop.settings.legalName} readOnly>
          <Input value={coop.legalName} readOnly />
        </Field>
        <Field label={t.coop.settings.status} readOnly>
          <div className="flex items-center h-9">
            <StatusBadge status={coop.status} t={t} />
          </div>
        </Field>
      </div>

      <p className="text-xs text-gray-400 italic">{t.coop.settings.infoOnly}</p>

      {/* Formulaire éditable */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t.coop.settings.displayName}>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={120}
            />
          </Field>
          <Field label={t.coop.settings.contactEmail}>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </Field>
          <Field label={t.coop.settings.contactPhone}>
            <Input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              maxLength={30}
            />
          </Field>
          <Field label={t.coop.settings.logoUrl}>
            <Input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t.coop.settings.descriptionFr}>
            <Textarea
              value={descriptionFr}
              onChange={(e) => setDescriptionFr(e.target.value)}
              maxLength={2000}
            />
          </Field>
          <Field label="Description (malagasy)">
            <Textarea
              value={descriptionMg}
              onChange={(e) => setDescriptionMg(e.target.value)}
              maxLength={2000}
            />
          </Field>
        </div>

        {feedback && (
          <div className={`rounded-lg px-3 py-2 text-sm ${feedback.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {feedback.msg}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={saving}
            disabled={!dirty || saving}
          >
            {saving ? t.coop.settings.submitting : t.coop.settings.submit}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ─── Section Politique d'annulation ─────────────────────────────────────────

function PolicySection({
  initial, t,
}: {
  initial: Policy | null;
  t: ReturnType<typeof getTranslations>;
}) {
  const [titleFr, setTitleFr] = useState(initial?.titleFr ?? '');
  const [titleMg, setTitleMg] = useState(initial?.titleMg ?? '');
  const [bodyFr, setBodyFr] = useState(initial?.bodyFr ?? '');
  const [bodyMg, setBodyMg] = useState(initial?.bodyMg ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const versionRef = useRef(initial?.version ?? 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titleFr || !titleMg || !bodyFr || !bodyMg) {
      setFeedback({ ok: false, msg: t.coop.settings.policy.allRequired });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/proxy/v1/coop/policies/current', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titleFr, titleMg, bodyFr, bodyMg }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Erreur ${res.status}`);
      const saved = await res.json();
      versionRef.current = saved.version ?? versionRef.current + 1;
      setFeedback({ ok: true, msg: t.coop.settings.policy.saved });
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Erreur réseau' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold text-brand-dark">{t.coop.settings.policy.title}</h2>
        {versionRef.current > 0 && (
          <span className="text-xs text-gray-400">v{versionRef.current}</span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t.coop.settings.policy.titleFr}>
            <Input
              value={titleFr}
              onChange={(e) => setTitleFr(e.target.value)}
              maxLength={200}
              required
            />
          </Field>
          <Field label={t.coop.settings.policy.titleMg}>
            <Input
              value={titleMg}
              onChange={(e) => setTitleMg(e.target.value)}
              maxLength={200}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t.coop.settings.policy.bodyFr}>
            <Textarea
              value={bodyFr}
              onChange={(e) => setBodyFr(e.target.value)}
              rows={6}
              maxLength={5000}
              required
            />
          </Field>
          <Field label={t.coop.settings.policy.bodyMg}>
            <Textarea
              value={bodyMg}
              onChange={(e) => setBodyMg(e.target.value)}
              rows={6}
              maxLength={5000}
              required
            />
          </Field>
        </div>

        {feedback && (
          <div className={`rounded-lg px-3 py-2 text-sm ${feedback.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {feedback.msg}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm" isLoading={saving} disabled={saving}>
            {saving ? t.coop.settings.submitting : t.coop.settings.policy.submitBtn}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ─── Page principale ─────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [coop, setCoop] = useState<CoopProfile | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [coopRes, policyRes] = await Promise.all([
          fetch('/api/proxy/v1/coop/cooperatives/current', { cache: 'no-store' }),
          fetch('/api/proxy/v1/coop/policies/current', { cache: 'no-store' }),
        ]);
        if (!coopRes.ok) throw new Error();
        setCoop(await coopRes.json());
        if (policyRes.ok) setPolicy(await policyRes.json());
      } catch {
        setError(t.common.errorNetwork);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-gray-200 rounded" />
        <div className="h-72 bg-gray-200 rounded-xl" />
        <div className="h-64 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (error || !coop) {
    return (
      <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
        {error ?? t.common.errorNetwork}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">{t.coop.settings.title}</h1>
      <ProfileSection coop={coop} t={t} onSaved={setCoop} />
      <PolicySection initial={policy} t={t} />
    </div>
  );
}
