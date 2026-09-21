'use client';

/**
 * Paramètres coopérative — /fr/coop/settings
 *
 * Charge GET /coop/cooperatives/current et permet de modifier
 * via PATCH /coop/cooperatives/current.
 *
 * La raison sociale et le statut sont en lecture seule (gérés par InsTRAM).
 */

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { Cooperative, CooperativeStatus, CoopPolicy } from '@/lib/types';

const STATUS_LABELS: Record<CooperativeStatus, string> = {
  PENDING_VALIDATION: 'En attente de validation',
  VALIDATED: 'Validée',
  SUSPENDED: 'Suspendue',
  REJECTED: 'Rejetée',
};

function statusVariant(status: CooperativeStatus) {
  switch (status) {
    case 'VALIDATED': return 'success' as const;
    case 'PENDING_VALIDATION': return 'warning' as const;
    case 'SUSPENDED': case 'REJECTED': return 'error' as const;
    default: return 'neutral' as const;
  }
}

export default function SettingsPage() {
  const [coop, setCoop] = useState<Cooperative | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [descriptionFr, setDescriptionFr] = useState('');
  const [logoUrl, setLogoUrl] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Policy state
  const [policy, setPolicy] = useState<CoopPolicy | null>(null);
  const [policyTitleFr, setPolicyTitleFr] = useState('');
  const [policyTitleMg, setPolicyTitleMg] = useState('');
  const [policyBodyFr, setPolicyBodyFr] = useState('');
  const [policyBodyMg, setPolicyBodyMg] = useState('');
  const [policySubmitting, setPolicySubmitting] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policySuccess, setPolicySuccess] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoadError(null);
      try {
        const res = await fetch('/api/proxy/v1/coop/cooperatives/current', { cache: 'no-store' });
        if (!res.ok) throw new Error('Impossible de charger les données.');
        const data: Cooperative = await res.json();
        setCoop(data);
        setDisplayName(data.displayName ?? '');
        setContactEmail(data.contactEmail ?? '');
        setContactPhone(data.contactPhone ?? '');
        setDescriptionFr(data.description ?? '');
        setLogoUrl(data.logoUrl ?? '');

        // Load policy (optional — 404 is acceptable)
        const pRes = await fetch('/api/proxy/v1/coop/policies/current', { cache: 'no-store' });
        if (pRes.ok) {
          const p: CoopPolicy = await pRes.json();
          setPolicy(p);
          setPolicyTitleFr(p.titleFr);
          setPolicyTitleMg(p.titleMg);
          setPolicyBodyFr(p.bodyFr);
          setPolicyBodyMg(p.bodyMg);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Erreur réseau.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSuccess(false);
    setIsSubmitting(true);

    try {
      const payload: Record<string, unknown> = {};
      if (displayName.trim()) payload.displayName = displayName.trim();
      if (contactEmail.trim()) payload.contactEmail = contactEmail.trim();
      if (contactPhone.trim()) payload.contactPhone = contactPhone.trim();
      if (descriptionFr.trim()) payload.descriptionFr = descriptionFr.trim();
      if (logoUrl.trim()) payload.logoUrl = logoUrl.trim();

      const res = await fetch('/api/proxy/v1/coop/cooperatives/current', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Erreur ${res.status}`);
      }

      const updated: Cooperative = await res.json();
      setCoop(updated);
      setSuccess(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(
        msg.toLowerCase().includes('fetch')
          ? 'Erreur réseau. Vérifiez votre connexion et réessayez.'
          : `Erreur : ${msg}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePolicySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPolicyError(null);
    setPolicySuccess(false);
    if (!policyTitleFr.trim() || !policyTitleMg.trim() || !policyBodyFr.trim() || !policyBodyMg.trim()) {
      setPolicyError('Tous les champs de la politique sont requis.');
      return;
    }
    setPolicySubmitting(true);
    try {
      const res = await fetch('/api/proxy/v1/coop/policies/current', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleFr: policyTitleFr.trim(),
          titleMg: policyTitleMg.trim(),
          bodyFr: policyBodyFr.trim(),
          bodyMg: policyBodyMg.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Erreur ${res.status}`);
      }
      const updated: CoopPolicy = await res.json();
      setPolicy(updated);
      setPolicySuccess(true);
    } catch (err) {
      setPolicyError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
    } finally {
      setPolicySubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="h-64 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-xl font-bold text-brand-dark">Paramètres</h1>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-5">
      <h1 className="text-xl font-bold text-brand-dark">Paramètres coopérative</h1>

      {/* Informations en lecture seule */}
      {coop && (
        <div className="bg-brand-dark/5 border border-brand-dark/20 rounded-xl p-4 space-y-2">
          <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Informations officielles</p>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-gray-500 text-xs">Raison sociale</dt>
              <dd className="font-medium text-gray-900">{coop.legalName}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Statut</dt>
              <dd><Badge variant={statusVariant(coop.status)}>{STATUS_LABELS[coop.status]}</Badge></dd>
            </div>
          </dl>
          <p className="text-xs text-gray-500">
            La raison sociale et le statut sont gérés par l'équipe InsTRAM.
          </p>
        </div>
      )}

      {/* Formulaire modifiable */}
      <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-gray-200 rounded-xl p-5" noValidate>
        <Input
          label="Nom d'affichage"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          hint="Nom affiché aux voyageurs dans l'annuaire et les résultats de recherche."
          disabled={isSubmitting}
        />

        <Input
          label="Email de contact"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          disabled={isSubmitting}
        />

        <Input
          label="Téléphone de contact"
          type="tel"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          placeholder="+261 XX XX XXX XXX"
          disabled={isSubmitting}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="desc-fr" className="text-sm font-medium text-gray-800">Description (français)</label>
          <textarea
            id="desc-fr"
            value={descriptionFr}
            onChange={(e) => setDescriptionFr(e.target.value)}
            rows={3}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand resize-none"
            disabled={isSubmitting}
          />
        </div>

        <Input
          label="URL du logo"
          type="url"
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          placeholder="https://..."
          disabled={isSubmitting}
        />

        {submitError && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
            {submitError}
          </div>
        )}

        {success && (
          <div role="status" className="bg-green-50 border border-green-300 text-green-700 rounded-lg px-4 py-3 text-sm">
            Paramètres enregistrés avec succès.
          </div>
        )}

        {/* Vert car action transactionnelle (enregistrer = confirmer les modifications) */}
        <Button type="submit" variant="action" fullWidth isLoading={isSubmitting}>
          Enregistrer
        </Button>
      </form>

      {/* Politique d'annulation */}
      <section>
        <h2 className="text-lg font-semibold text-brand-dark mb-3">
          Politique d'annulation
          {policy && (
            <span className="ml-2 text-xs font-normal text-gray-400">v{policy.version}</span>
          )}
        </h2>
        <form onSubmit={handlePolicySubmit} className="space-y-4 bg-white border border-gray-200 rounded-xl p-5" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-800">Titre (français)</label>
              <input
                type="text"
                value={policyTitleFr}
                onChange={(e) => setPolicyTitleFr(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
                disabled={policySubmitting}
                placeholder="Politique d'annulation"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-800">Titre (malagasy)</label>
              <input
                type="text"
                value={policyTitleMg}
                onChange={(e) => setPolicyTitleMg(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
                disabled={policySubmitting}
                placeholder="Fitsipiky fanilana"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-800">Contenu (français)</label>
            <textarea
              value={policyBodyFr}
              onChange={(e) => setPolicyBodyFr(e.target.value)}
              rows={4}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand resize-none"
              disabled={policySubmitting}
              placeholder="Décrivez les conditions d'annulation..."
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-800">Contenu (malagasy)</label>
            <textarea
              value={policyBodyMg}
              onChange={(e) => setPolicyBodyMg(e.target.value)}
              rows={4}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand resize-none"
              disabled={policySubmitting}
              placeholder="Lazao ny fepetra fanilana..."
            />
          </div>

          {policyError && (
            <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
              {policyError}
            </div>
          )}
          {policySuccess && (
            <div role="status" className="bg-green-50 border border-green-300 text-green-700 rounded-lg px-4 py-3 text-sm">
              Politique enregistrée (v{policy?.version}).
            </div>
          )}

          <Button type="submit" variant="action" fullWidth isLoading={policySubmitting}>
            Enregistrer la politique
          </Button>
        </form>
      </section>
    </div>
  );
}
