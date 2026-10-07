'use client';

/**
 * Créer une nouvelle ligne — /[lang]/coop/routes/new
 */

import { useState, useEffect, useRef, useCallback } from 'react';
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

// ─── Recherche de ville avec typeahead ───────────────────────────────────────

interface CityPickerProps {
  label: string;
  value: string;
  selectedCity: City | null;
  onChange: (cityId: string, city: City | null) => void;
  error?: string;
  disabled?: boolean;
  excludeId?: string;
  lang: string;
}

function CityPicker({
  label, value, selectedCity, onChange, error, disabled, excludeId, lang,
}: CityPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<City[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (q) params.set('q', q);
      const res = await fetch(`/api/proxy/v1/catalog/cities?${params}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setResults((data.items ?? []).filter((c: City) => c.id !== excludeId));
    } finally {
      setLoading(false);
    }
  }, [excludeId]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open, search]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleOpen() {
    setOpen(true);
    search(query);
  }

  function handleSelect(city: City) {
    onChange(city.id, city);
    setQuery('');
    setOpen(false);
  }

  function handleClear() {
    onChange('', null);
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-800">
        {label} <span className="text-red-500">*</span>
      </label>

      {selectedCity ? (
        <div className="flex items-center justify-between rounded-lg border border-brand bg-brand/5 px-3 py-2.5 text-sm">
          <span className="font-medium text-brand-dark">{selectedCity.name} — {selectedCity.district}</span>
          {!disabled && (
            <button type="button" onClick={handleClear} className="text-gray-400 hover:text-red-500 ml-2 text-xs">✕</button>
          )}
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={handleOpen}
            placeholder={lang === 'fr' ? 'Rechercher une ville…' : 'Hikaroka tanàna…'}
            disabled={disabled}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
          {open && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-60 overflow-y-auto">
              {loading ? (
                <div className="px-3 py-2 text-sm text-gray-500">{lang === 'fr' ? 'Chargement…' : 'Miandry…'}</div>
              ) : results.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">
                  {lang === 'fr' ? 'Aucune ville trouvée' : 'Tsy hita tanàna'}
                </div>
              ) : (
                results.map((city) => (
                  <button
                    key={city.id}
                    type="button"
                    onMouseDown={() => handleSelect(city)}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-brand/10 border-b border-gray-100 last:border-0"
                  >
                    <span className="font-medium text-gray-900">{city.name}</span>
                    <span className="text-gray-500 ml-1">— {city.district}</span>
                    <span className="text-xs text-gray-400 ml-1">({city.region})</span>
                  </button>
                ))
              )}
              <button
                type="button"
                onMouseDown={() => { setOpen(false); setShowAddForm(true); }}
                className="block w-full text-left px-3 py-2 text-xs text-brand hover:bg-brand/5 border-t border-gray-200 font-medium"
              >
                {lang === 'fr' ? '+ Ville manquante ? Ajouter…' : '+ Tsy hita ? Hanampy…'}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

      {showAddForm && (
        <AddCityForm
          lang={lang}
          prefilledName={query}
          onAdded={(city) => { handleSelect(city); setShowAddForm(false); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}
    </div>
  );
}

// ─── Formulaire d'ajout de ville manquante ───────────────────────────────────

interface AddCityFormProps {
  lang: string;
  prefilledName?: string;
  onAdded: (city: City) => void;
  onCancel: () => void;
}

function AddCityForm({ lang, prefilledName, onAdded, onCancel }: AddCityFormProps) {
  const [nameFr, setNameFr] = useState(prefilledName ?? '');
  const [nameMg, setNameMg] = useState('');
  const [district, setDistrict] = useState('');
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameFr.trim() || !nameMg.trim() || !district.trim() || !region.trim()) {
      setErr(lang === 'fr' ? 'Tous les champs sont requis' : 'Ilaina ny saha rehetra');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/proxy/v1/catalog/cities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nameFr: nameFr.trim(), nameMg: nameMg.trim(), district: district.trim(), region: region.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Erreur ${res.status}`);
      }
      const city = await res.json() as City;
      onAdded(city);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur réseau');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-brand/30 bg-blue-50 p-4 space-y-3">
      <p className="text-xs font-semibold text-brand-dark">
        {lang === 'fr' ? 'Ajouter une ville manquante' : 'Hanampy tanàna tsy hita'}
      </p>
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Nom (français)</label>
            <input
              value={nameFr}
              onChange={(e) => setNameFr(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Anarana (malagasy)</label>
            <input
              value={nameMg}
              onChange={(e) => setNameMg(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">District</label>
            <input
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Région</label>
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              required
            />
          </div>
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="action" size="sm" isLoading={saving}>
            {lang === 'fr' ? 'Ajouter' : 'Hanampy'}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            {lang === 'fr' ? 'Annuler' : 'Hanafoana'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Page principale ─────────────────────────────────────────────────────────

export default function NewRoutePage() {
  const router = useRouter();
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [displayName, setDisplayName] = useState('');
  const [originCityId, setOriginCityId] = useState('');
  const [originCity, setOriginCity] = useState<City | null>(null);
  const [destinationCityId, setDestinationCityId] = useState('');
  const [destinationCity, setDestinationCity] = useState<City | null>(null);
  const [distanceKm, setDistanceKm] = useState('');
  const [durationHours, setDurationHours] = useState('');

  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
      if (durationHours) payload.estimatedDurationMin = Math.round(parseFloat(durationHours) * 60);

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

        <CityPicker
          label={t.coop.routes.new.originCity}
          value={originCityId}
          selectedCity={originCity}
          onChange={(id, city) => { setOriginCityId(id); setOriginCity(city); setErrors((p) => ({ ...p, originCityId: undefined })); }}
          error={errors.originCityId}
          disabled={isSubmitting}
          excludeId={destinationCityId}
          lang={lang}
        />

        <CityPicker
          label={t.coop.routes.new.destinationCity}
          value={destinationCityId}
          selectedCity={destinationCity}
          onChange={(id, city) => { setDestinationCityId(id); setDestinationCity(city); setErrors((p) => ({ ...p, destinationCityId: undefined })); }}
          error={errors.destinationCityId}
          disabled={isSubmitting}
          excludeId={originCityId}
          lang={lang}
        />

        <Input
          label={t.coop.routes.new.distanceKm}
          type="number"
          min="0"
          value={distanceKm}
          onChange={(e) => setDistanceKm(e.target.value)}
          disabled={isSubmitting}
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-800">Durée estimée (heures)</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={durationHours}
            onChange={(e) => setDurationHours(e.target.value)}
            disabled={isSubmitting}
            placeholder="Ex : 1.5 pour 1h30"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-50"
          />
          {durationHours && !isNaN(parseFloat(durationHours)) && (
            <p className="text-xs text-gray-500">
              → {(() => {
                const min = Math.round(parseFloat(durationHours) * 60);
                const h = Math.floor(min / 60);
                const m = min % 60;
                return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
              })()}
            </p>
          )}
        </div>

        {submitError && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
            {submitError}
          </div>
        )}

        <Button type="submit" variant="action" fullWidth isLoading={isSubmitting}>
          {t.coop.routes.new.submit}
        </Button>
      </form>
    </div>
  );
}
