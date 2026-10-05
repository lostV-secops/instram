'use client';

/**
 * Formulaire de recherche de trajets.
 * Client Component — gère la sélection de villes et la soumission.
 * La liste des villes est reçue en prop (chargée côté serveur par la page).
 * Soumission : navigation via URL params vers /[lang]/search.
 */

import { useState, useId } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import Button from '@/components/ui/Button';
import type { City } from '@/lib/types';

interface SearchFormProps {
  cities: City[];
  /** Valeurs initiales (pré-remplissage depuis l'URL) */
  defaults?: {
    originCityId?: string;
    destinationCityId?: string;
    date?: string;
    passengers?: number;
  };
}

export function SearchForm({ cities, defaults }: SearchFormProps) {
  const t = useTranslations();
  const lang = useLang();
  const router = useRouter();

  const [originCityId, setOriginCityId] = useState(defaults?.originCityId ?? '');
  const [destinationCityId, setDestinationCityId] = useState(
    defaults?.destinationCityId ?? '',
  );
  const [date, setDate] = useState(
    defaults?.date ?? new Date().toISOString().split('T')[0],
  );
  const [passengers, setPassengers] = useState(defaults?.passengers ?? 1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const originId = useId();
  const destId = useId();
  const dateId = useId();
  const passengersId = useId();

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!originCityId) errs.origin = t.home.selectCity;
    if (!destinationCityId) errs.destination = t.home.selectCity;
    if (originCityId && originCityId === destinationCityId) {
      errs.destination = lang === 'fr'
        ? 'La ville d\'arrivée doit être différente du départ'
        : 'Tsy mitovy ny tanàna fiaingana sy hidirana';
    }
    if (!date) {
      errs.date = lang === 'fr' ? 'La date est requise' : 'Ilaina ny daty';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const params = new URLSearchParams({
      originCityId,
      destinationCityId,
      date,
      passengers: String(passengers),
    });
    router.push(`/${lang}/search?${params.toString()}`);
  }

  // Trier les villes par nom pour l'affichage
  const sortedCities = [...cities].sort((a, b) =>
    a.name.localeCompare(b.name, lang),
  );

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="bg-white rounded-xl shadow-md p-5 flex flex-col gap-4"
      aria-label={t.home.searchButton}
    >
      {/* Ville de départ */}
      <div className="flex flex-col gap-1">
        <label htmlFor={originId} className="text-sm font-medium text-gray-800">
          {t.home.from}
          <span className="text-red-500 ml-1" aria-hidden="true">*</span>
        </label>
        <select
          id={originId}
          value={originCityId}
          onChange={(e) => setOriginCityId(e.target.value)}
          aria-invalid={!!errors.origin}
          aria-describedby={errors.origin ? `${originId}-error` : undefined}
          className={[
            'block w-full rounded-lg border px-3 py-2.5 text-base text-gray-900',
            'focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand',
            'bg-white',
            errors.origin ? 'border-red-500' : 'border-gray-300',
          ].join(' ')}
        >
          <option value="">{t.home.selectCity}</option>
          {sortedCities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
              {city.district && city.district !== city.name
                ? ` (${city.district})`
                : ''}
            </option>
          ))}
        </select>
        {errors.origin && (
          <p id={`${originId}-error`} role="alert" className="text-xs text-red-600">
            {errors.origin}
          </p>
        )}
      </div>

      {/* Ville d'arrivée */}
      <div className="flex flex-col gap-1">
        <label htmlFor={destId} className="text-sm font-medium text-gray-800">
          {t.home.to}
          <span className="text-red-500 ml-1" aria-hidden="true">*</span>
        </label>
        <select
          id={destId}
          value={destinationCityId}
          onChange={(e) => setDestinationCityId(e.target.value)}
          aria-invalid={!!errors.destination}
          aria-describedby={errors.destination ? `${destId}-error` : undefined}
          className={[
            'block w-full rounded-lg border px-3 py-2.5 text-base text-gray-900',
            'focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand',
            'bg-white',
            errors.destination ? 'border-red-500' : 'border-gray-300',
          ].join(' ')}
        >
          <option value="">{t.home.selectCity}</option>
          {sortedCities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
              {city.district && city.district !== city.name
                ? ` (${city.district})`
                : ''}
            </option>
          ))}
        </select>
        {errors.destination && (
          <p id={`${destId}-error`} role="alert" className="text-xs text-red-600">
            {errors.destination}
          </p>
        )}
      </div>

      {/* Date et passagers — en ligne sur écrans plus larges */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Date */}
        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor={dateId} className="text-sm font-medium text-gray-800">
            {t.home.date}
            <span className="text-red-500 ml-1" aria-hidden="true">*</span>
          </label>
          <input
            type="date"
            id={dateId}
            value={date}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={!!errors.date}
            className={[
              'block w-full rounded-lg border px-3 py-2.5 text-base text-gray-900',
              'focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand',
              errors.date ? 'border-red-500' : 'border-gray-300',
            ].join(' ')}
          />
          {errors.date && (
            <p role="alert" className="text-xs text-red-600">{errors.date}</p>
          )}
        </div>

        {/* Passagers */}
        <div className="flex flex-col gap-1 w-full sm:w-32">
          <label htmlFor={passengersId} className="text-sm font-medium text-gray-800">
            {t.home.passengers}
          </label>
          <input
            type="number"
            id={passengersId}
            value={passengers}
            min={1}
            max={6}
            onChange={(e) =>
              setPassengers(Math.max(1, Math.min(6, Number(e.target.value))))
            }
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </div>
      </div>

      {/* Bouton de recherche — bleu brand (pas vert : c'est la navigation) */}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
      >
        {t.home.searchButton}
      </Button>
    </form>
  );
}

export default SearchForm;
