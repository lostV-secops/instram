'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

interface FormState {
  legalName: string;
  displayName: string;
  slug: string;
  contactEmail: string;
  contactPhone: string;
  descriptionFr: string;
}

const INITIAL: FormState = {
  legalName: '',
  displayName: '',
  slug: '',
  contactEmail: '',
  contactPhone: '',
  descriptionFr: '',
};

function toSlug(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export default function NewCooperativePage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [slugManual, setSlugManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'displayName' && !slugManual) {
        next.slug = toSlug(value);
      }
      return next;
    });
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlugManual(true);
    setForm((prev) => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const body: Record<string, string> = {
      legalName: form.legalName.trim(),
      displayName: form.displayName.trim(),
    };
    if (form.slug.trim()) body.slug = form.slug.trim();
    if (form.contactEmail.trim()) body.contactEmail = form.contactEmail.trim();
    if (form.contactPhone.trim()) body.contactPhone = form.contactPhone.trim();
    if (form.descriptionFr.trim()) body.descriptionFr = form.descriptionFr.trim();

    try {
      const res = await fetch('/api/proxy/v1/admin/cooperatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        setError(data.message ?? 'Erreur lors de la création.');
        return;
      }

      const created = await res.json() as { id: string };
      router.push(`/fr/admin/cooperatives/${created.id}`);
    } catch {
      setError('Impossible de joindre le serveur. Vérifiez votre connexion.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm text-brand underline"
        >
          ← Retour
        </button>
        <h1 className="text-xl font-bold text-brand-dark">Nouvelle coopérative</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {/* Identité */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Identité</p>

          <div className="flex flex-col gap-1">
            <label htmlFor="legalName" className="text-sm font-medium text-gray-700">
              Nom légal <span className="text-red-500">*</span>
            </label>
            <input
              id="legalName"
              type="text"
              required
              value={form.legalName}
              onChange={set('legalName')}
              placeholder="ex. Coopérative de Transport Ivato"
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="displayName" className="text-sm font-medium text-gray-700">
              Nom affiché <span className="text-red-500">*</span>
            </label>
            <input
              id="displayName"
              type="text"
              required
              value={form.displayName}
              onChange={set('displayName')}
              placeholder="ex. Coop Ivato"
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="slug" className="text-sm font-medium text-gray-700">
              Slug (URL)
            </label>
            <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden focus-within:ring-2 focus-within:ring-brand">
              <span className="px-3 py-2.5 bg-gray-50 text-sm text-gray-400 border-r border-gray-300 whitespace-nowrap select-none">
                /cooperatives/
              </span>
              <input
                id="slug"
                type="text"
                value={form.slug}
                onChange={handleSlugChange}
                placeholder="coop-ivato"
                className="flex-1 px-3 py-2.5 text-sm focus:outline-none font-mono"
              />
            </div>
            <p className="text-xs text-gray-400">Généré automatiquement. Uniquement lettres minuscules, chiffres et tirets.</p>
          </div>
        </div>

        {/* Contact */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="contactEmail" className="text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="contactEmail"
                type="email"
                value={form.contactEmail}
                onChange={set('contactEmail')}
                placeholder="contact@coop.mg"
                className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="contactPhone" className="text-sm font-medium text-gray-700">
                Téléphone
              </label>
              <input
                id="contactPhone"
                type="tel"
                value={form.contactPhone}
                onChange={set('contactPhone')}
                placeholder="+261..."
                className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand font-mono"
              />
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</p>

          <div className="flex flex-col gap-1">
            <label htmlFor="descriptionFr" className="text-sm font-medium text-gray-700">
              Description (FR)
            </label>
            <textarea
              id="descriptionFr"
              rows={4}
              value={form.descriptionFr}
              onChange={set('descriptionFr')}
              placeholder="Présentation de la coopérative..."
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-none"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 flex items-center gap-3 bg-gray-50 rounded-b-xl">
          {error && (
            <p className="flex-1 text-sm text-red-600">{error}</p>
          )}
          <div className="ml-auto flex gap-3">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => router.back()}
              disabled={saving}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={saving}
            >
              Créer la coopérative
            </Button>
          </div>
        </div>
      </form>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        La coopérative sera créée avec le statut <strong>En attente de validation</strong>. Vous pourrez la valider depuis sa fiche.
      </div>
    </div>
  );
}
