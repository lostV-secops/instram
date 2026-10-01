'use client';

/**
 * Créer une nouvelle ligne — /[lang]/coop/routes/new
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCoop } from '../../CoopContext';
import { getTranslations } from '@/lib/i18n';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { City } from '@/lib/types';

interface FormErrors {
  displayName?: string;
  originCityId?: string;
  destinationCityId?: string;
}

export default function NewRoutePage() {
  const router = useRouter();
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [cities, setCities] = useState<City[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [citiesError, setCitiesError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [originCityId, setOriginCityId] = useState('');
  const [destinationCityId, setDestinationCityId] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [estimatedDurationMin, setEstimatedDurationMin] = useState('');

  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const loadCities = async () => {
      try {
        const res = await fetch('/api/proxy/v1/catalog/cities?limit=200', { cache: 'no-store' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setCities(data.items ?? []);
      } catch {
        setCitiesError(t.coop.routes.new.loadError);
      } finally {
        setCitiesLoading(false);
      }
    };
    loadCities();
  }, [t.coop.routes.new.loadError]);

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!displayName.trim()) e.displayName = t.coop.routes.new.displayName;
    if (!originCityId) e.originCityId = t.coop.routes.new.originCity;
    if (!destinationCityId) e.destinationCityId = t.coop.routes.new.destinationCity;
    if (originCityId && destinationCityId && originCityId === destinationCityId) {
      e.destinationCityId = t.coop.routes.new.destinationCity;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        displayName: displayName.trim(),
        originCityId,
        destinationCityId,
      };
      if (distanceKm) payload.distanceKm = parseInt(distanceKm, 10);
      if (estimatedDurationMin) payload.estimatedDurationMin = parseInt(estimatedDurationMin, 10);

      const res = await fetch('/api/proxy/v1/coop/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Erreur ${res.status}`);
      }

      router.push(`/${lang}/coop/routes`);
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
      <Link href={`/${lang}/coop/routes`} className="text-brand text-sm hover:underline">← {t.coop.routes.title}</Link>
      <h1 className="text-xl font-bold text-brand-dark">{t.coop.routes.new.title}</h1>

      {citiesLoading ? (
        <div className="animate-pulse h-48 bg-gray-200 rounded-xl" />
      ) : citiesError ? (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">{citiesError}</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-gray-200 rounded-xl p-5" noValidate>
          <Input
            label={t.coop.routes.new.displayName}
            value={displayName}
            onChange={(e) => { setDisplayName(e.target.value); setErrors((p) => ({ ...p, displayName: undefined })); }}
            error={errors.displayName}
            placeholder="Ex: Tana — Toamasina"
            required
            disabled={isSubmitting}
          />

          <div className="flex flex-col gap-1">
            <label htmlFor="origin-city" className="text-sm font-medium text-gray-800">
              {t.coop.routes.new.originCity} <span className="text-red-500">*</span>
            </label>
            <select
              id="origin-city"
              value={originCityId}
              onChange={(e) => { setOriginCityId(e.target.value); setErrors((p) => ({ ...p, originCityId: undefined })); }}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
              aria-invalid={!!errors.originCityId}
            >
              <option value="">{t.coop.routes.new.selectCity}...</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {c.district}</option>
              ))}
            </select>
            {errors.originCityId && <p role="alert" className="text-xs text-red-600">{errors.originCityId}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="dest-city" className="text-sm font-medium text-gray-800">
              {t.coop.routes.new.destinationCity} <span className="text-red-500">*</span>
            </label>
            <select
              id="dest-city"
              value={destinationCityId}
              onChange={(e) => { setDestinationCityId(e.target.value); setErrors((p) => ({ ...p, destinationCityId: undefined })); }}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
              aria-invalid={!!errors.destinationCityId}
            >
              <option value="">{t.coop.routes.new.selectCity}...</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {c.district}</option>
              ))}
            </select>
            {errors.destinationCityId && <p role="alert" className="text-xs text-red-600">{errors.destinationCityId}</p>}
          </div>

          <Input
            label={t.coop.routes.new.distanceKm}
            type="number"
            min="0"
            value={distanceKm}
            onChange={(e) => setDistanceKm(e.target.value)}
            disabled={isSubmitting}
          />

          <Input
            label={t.coop.routes.new.durationMin}
            type="number"
            min="0"
            value={estimatedDurationMin}
            onChange={(e) => setEstimatedDurationMin(e.target.value)}
            disabled={isSubmitting}
          />

          {submitError && (
            <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
              {submitError}
            </div>
          )}

          <Button type="submit" variant="action" fullWidth isLoading={isSubmitting}>
            {t.coop.routes.new.submit}
          </Button>
        </form>
      )}
    </div>
  );
}
