'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import { Button } from '@/components/ui/Button';
import type { Me } from '@/lib/types';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; me: Me }
  | { status: 'error'; message: string };

interface EditForm {
  firstName: string;
  lastName: string;
  phone: string;
}

const IconUser = () => (
  <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

const IconPencil = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

interface InfoRowProps { label: string; value: string | null | undefined; mono?: boolean; }

function InfoRow({ label, value, mono = false }: InfoRowProps) {
  if (!value) return null;
  return (
    <div className="flex flex-col py-3 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-0.5">{label}</span>
      <span className={`text-base text-gray-900 ${mono ? 'font-mono' : 'font-medium'}`}>{value}</span>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const t = useTranslations();
  const lang = useLang();
  const td = t.driver;
  const [pageState, setPageState] = useState<PageState>({ status: 'loading' });
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({ firstName: '', lastName: '', phone: '' });

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const response = await fetch('/api/proxy/v1/auth/me', { cache: 'no-store' });
        if (response.status === 401) {
          router.replace(`/${lang}/auth/login?redirect=/${lang}/driver`);
          return;
        }
        if (!response.ok) {
          setPageState({ status: 'error', message: td.profile.errorLoad });
          return;
        }
        setPageState({ status: 'ready', me: await response.json() as Me });
      } catch {
        setPageState({ status: 'error', message: t.common.errorNetwork });
      }
    };
    loadProfile();
  }, [router, lang, td, t]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignorer */ }
    router.replace(`/${lang}/auth/login`);
  };

  const startEdit = () => {
    if (pageState.status !== 'ready') return;
    const { me } = pageState;
    setEditForm({
      firstName: me.traveler?.firstName ?? '',
      lastName: me.traveler?.lastName ?? '',
      phone: me.phone ?? '',
    });
    setSaveError(null);
    setSaveSuccess(false);
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, string> = {};
      if (editForm.firstName.trim()) body.firstName = editForm.firstName.trim();
      if (editForm.lastName.trim()) body.lastName = editForm.lastName.trim();
      if (editForm.phone.trim()) body.phone = editForm.phone.trim();

      if (Object.keys(body).length === 0) {
        setIsEditing(false);
        return;
      }

      const res = await fetch('/api/proxy/v1/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        let msg = td.profile.saveError;
        try {
          const data = await res.json() as { message?: string };
          if (data.message) msg = data.message;
        } catch { /* ignorer */ }
        setSaveError(msg);
        return;
      }

      const updated = await res.json() as Me;
      setPageState({ status: 'ready', me: updated });
      setIsEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setSaveError(t.common.errorNetwork);
    } finally {
      setIsSaving(false);
    }
  };

  const ROLE_LABELS: Record<string, string> = {
    COOP_DRIVER: td.profile.roleName,
    COOP_CONTROLLER: t.driver.header.driver,
    COOP_ADMIN: t.coop.layout.coopAdmin,
    COOP_ASSISTANT: t.coop.layout.coopAssistant,
  };

  function getRoleLabel(roles: string[], cooperatives: Me['cooperatives']): string {
    const coopRole = cooperatives?.[0]?.role;
    if (coopRole && ROLE_LABELS[coopRole]) return ROLE_LABELS[coopRole];
    for (const role of roles) { if (ROLE_LABELS[role]) return ROLE_LABELS[role]; }
    return td.profile.roleName;
  }

  if (pageState.status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">{td.profile.loading}</p>
      </div>
    );
  }

  if (pageState.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 gap-4 text-center">
        <p className="text-sm text-gray-700 font-medium max-w-xs">{pageState.message}</p>
        <button type="button" onClick={() => window.location.reload()} className="text-sm text-brand underline min-h-[44px]">
          {t.common.retry}
        </button>
      </div>
    );
  }

  const { me } = pageState;
  const traveler = me.traveler;
  const fullName = traveler ? `${traveler.firstName} ${traveler.lastName}` : null;
  const roleLabel = getRoleLabel(me.roles, me.cooperatives);
  const coopName = me.cooperatives?.[0]?.displayName ?? null;
  const initials = fullName ? fullName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : 'CO';

  return (
    <div className="pb-4">
      <div className="bg-brand-dark px-4 pt-4 pb-6 flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-full bg-brand flex items-center justify-center" aria-hidden="true">
          {fullName ? <span className="text-2xl font-bold text-white">{initials}</span> : <IconUser />}
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold text-white">{fullName ?? me.email ?? me.phone ?? td.header.driver}</h1>
          <p className="text-sm text-white/70 mt-0.5">{roleLabel}</p>
        </div>
      </div>

      {saveSuccess && (
        <div className="mx-4 mt-3 bg-green-50 border border-green-300 rounded-xl px-4 py-3 text-sm text-green-700 font-medium">
          {td.profile.saveSuccess}
        </div>
      )}

      <div className="mx-4 mt-4 bg-white rounded-xl shadow-sm border border-gray-100 px-4">
        <div className="flex items-center justify-between pt-3 pb-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{td.profile.title}</p>
          {!isEditing && (
            <button
              type="button"
              onClick={startEdit}
              className="flex items-center gap-1.5 text-sm text-brand font-medium hover:underline min-h-[36px] px-1"
              aria-label={td.profile.editProfile}
            >
              <IconPencil />
              {td.profile.editProfile}
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="py-3 space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium uppercase tracking-wide" htmlFor="edit-firstName">
                {td.profile.firstName}
              </label>
              <input
                id="edit-firstName"
                type="text"
                value={editForm.firstName}
                onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                autoComplete="given-name"
                disabled={isSaving}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium uppercase tracking-wide" htmlFor="edit-lastName">
                {td.profile.lastName}
              </label>
              <input
                id="edit-lastName"
                type="text"
                value={editForm.lastName}
                onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                autoComplete="family-name"
                disabled={isSaving}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium uppercase tracking-wide" htmlFor="edit-phone">
                {td.profile.phone}
              </label>
              <input
                id="edit-phone"
                type="tel"
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 font-mono focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                placeholder="+261..."
                autoComplete="tel"
                disabled={isSaving}
              />
            </div>
            {saveError && (
              <p className="text-sm text-red-600">{saveError}</p>
            )}
            <div className="flex gap-3 pt-1">
              <Button variant="primary" size="md" fullWidth isLoading={isSaving} onClick={handleSave} className="min-h-[44px]">
                {isSaving ? td.profile.saving : t.common.save}
              </Button>
              <Button variant="ghost" size="md" fullWidth onClick={() => setIsEditing(false)} disabled={isSaving} className="min-h-[44px]">
                {t.common.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <InfoRow label={td.profile.name} value={fullName} />
            <InfoRow label={td.profile.email} value={me.email} />
            <InfoRow label={td.profile.phone} value={me.phone} mono />
            {traveler?.mobileMoneyPhone && <InfoRow label={t.profile.mobileMoneyPhone} value={traveler.mobileMoneyPhone} mono />}
            <InfoRow label={td.profile.role} value={roleLabel} />
            <InfoRow label={td.profile.cooperative} value={coopName} />
          </>
        )}
      </div>

      <div className="mx-4 mt-3 bg-white rounded-xl border border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">{td.appName}</span>
          <span className="text-sm font-medium text-gray-700">v1</span>
        </div>
      </div>

      <div className="mx-4 mt-5">
        <Button variant="danger" size="lg" fullWidth isLoading={isLoggingOut} onClick={handleLogout} className="min-h-[52px] text-base">
          {isLoggingOut ? td.profile.loggingOut : td.profile.logout}
        </Button>
      </div>
    </div>
  );
}
