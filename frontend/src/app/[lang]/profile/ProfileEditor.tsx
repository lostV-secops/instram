'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { useTranslations } from '@/components/TranslationsProvider';
import type { Me, Lang } from '@/lib/types';

interface Props {
  me: Me;
  lang: string;
}

export function ProfileEditor({ me, lang }: Props) {
  const t = useTranslations();
  const tp = t.profile;
  const router = useRouter();

  // Edit form state
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(me.traveler?.firstName ?? '');
  const [lastName, setLastName] = useState(me.traveler?.lastName ?? '');
  const [mobileMoneyPhone, setMobileMoneyPhone] = useState(me.traveler?.mobileMoneyPhone ?? '');
  const [preferredLang, setPreferredLang] = useState<'FR' | 'MG'>(
    me.preferredLang === 'mg' ? 'MG' : 'FR',
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Delete dialog state
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);

    const body: Record<string, unknown> = {};
    if (firstName.trim()) body.firstName = firstName.trim();
    if (lastName.trim()) body.lastName = lastName.trim();
    body.preferredLang = preferredLang;
    if (mobileMoneyPhone.trim()) body.mobileMoneyPhone = mobileMoneyPhone.trim();
    else body.mobileMoneyPhone = '';

    try {
      const res = await fetch('/api/proxy/v1/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(data.message ?? `Erreur ${res.status}`);
      }
      setSaveSuccess(true);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch('/api/proxy/v1/auth/me', { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Erreur ${res.status}`);
      }
      router.push(`/${lang}/auth/login`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Erreur réseau.');
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {saveSuccess && !editing && (
        <div role="status" className="bg-green-50 border border-green-300 text-green-700 rounded-xl px-4 py-3 text-sm">
          {tp.saveSuccess}
        </div>
      )}

      {/* Edit form */}
      {editing ? (
        <form
          onSubmit={handleSave}
          className="bg-white border border-gray-200 rounded-xl p-5 space-y-4"
        >
          <h2 className="font-semibold text-brand-dark">{tp.editTitle}</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={tp.firstName}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={saving}
            />
            <Input
              label={tp.lastName}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={saving}
            />
          </div>

          <PhoneInput
            label={tp.mobileMoneyPhoneOptional}
            value={mobileMoneyPhone}
            onChange={setMobileMoneyPhone}
            hint={tp.mobileMoneyHint}
            disabled={saving}
          />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-800">{tp.lang}</label>
            <div className="flex gap-3">
              {(['FR', 'MG'] as const).map((l) => (
                <label key={l} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="preferredLang"
                    value={l}
                    checked={preferredLang === l}
                    onChange={() => setPreferredLang(l)}
                    disabled={saving}
                    className="accent-brand"
                  />
                  <span className="text-sm text-gray-700">{l === 'FR' ? tp.langFr : tp.langMg}</span>
                </label>
              ))}
            </div>
          </div>

          {saveError && (
            <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
              {saveError}
            </div>
          )}

          <div className="flex gap-3">
            <Button type="submit" variant="primary" isLoading={saving}>
              {t.common.save}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setEditing(false); setSaveError(null); }}
              disabled={saving}
            >
              {t.common.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => { setEditing(true); setSaveSuccess(false); }}
          className="block w-full text-center border border-gray-200 text-gray-700 font-medium rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors text-sm"
        >
          {tp.editButton}
        </button>
      )}

      {/* Delete account */}
      {!showDelete ? (
        <button
          onClick={() => setShowDelete(true)}
          className="block w-full text-center border border-red-200 text-red-600 font-medium rounded-xl px-4 py-3 hover:bg-red-50 transition-colors text-sm"
        >
          {tp.deleteButton}
        </button>
      ) : (
        <div className="bg-red-50 border border-red-300 rounded-xl p-5 space-y-3">
          <p className="text-sm font-semibold text-red-700">{tp.deleteConfirmTitle}</p>
          <p className="text-xs text-red-600">{tp.deleteWarning}</p>
          {deleteError && (
            <p className="text-xs text-red-700 font-medium">{deleteError}</p>
          )}
          <div className="flex gap-3">
            <Button
              variant="primary"
              size="sm"
              isLoading={deleting}
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 border-red-600"
            >
              {tp.confirmDelete}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setShowDelete(false); setDeleteError(null); }}
              disabled={deleting}
            >
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
