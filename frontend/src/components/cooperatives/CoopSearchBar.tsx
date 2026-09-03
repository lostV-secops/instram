/**
 * Barre de recherche de l'annuaire public des coopératives.
 *
 * Client Component — gère la mise à jour du paramètre `?q=` dans l'URL.
 * Utilise un formulaire HTML natif (GET) pour fonctionner même sans JavaScript
 * (important : public 3G, téléphones d'entrée de gamme).
 *
 * La page parente (Server Component) lit `searchParams.q` et passe la requête
 * à GET /v1/directory/cooperatives?q=...
 */

'use client';

import { useRouter } from 'next/navigation';
import { useRef, type FormEvent } from 'react';
import type { Translations } from '@/lib/i18n';

interface CoopSearchBarProps {
  lang: string;
  defaultValue?: string;
  t: Translations;
}

export function CoopSearchBar({ lang, defaultValue = '', t }: CoopSearchBarProps) {
  const tc = t.cooperatives;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = inputRef.current?.value.trim() ?? '';
    const url = new URL(`/${lang}/cooperatives`, window.location.origin);
    if (q) url.searchParams.set('q', q);
    router.push(url.pathname + url.search);
  }

  function handleClear() {
    if (inputRef.current) inputRef.current.value = '';
    router.push(`/${lang}/cooperatives`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      aria-label={tc.searchLabel}
      className="flex gap-2"
    >
      <div className="relative flex-1">
        {/* Icône loupe */}
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
          />
        </svg>

        <input
          ref={inputRef}
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder={tc.searchPlaceholder}
          aria-label={tc.searchLabel}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand bg-white"
          autoComplete="off"
        />

        {/* Bouton effacer (si valeur présente) */}
        {defaultValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
            aria-label={t.common.close}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Bouton de soumission — bleu primaire (navigation, pas transactionnel) */}
      <button
        type="submit"
        className="bg-brand text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-brand-dark transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 flex-shrink-0"
      >
        {tc.searchButton}
      </button>
    </form>
  );
}

export default CoopSearchBar;
