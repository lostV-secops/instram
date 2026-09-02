'use client';

/**
 * Provider React Context pour les traductions.
 * Permet aux Client Components d'accéder aux traductions sans prop-drilling.
 *
 * Usage (Client Component) :
 *   const t = useTranslations();
 *   return <p>{t.home.title}</p>;
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { Translations } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

interface TranslationsContextValue {
  t: Translations;
  lang: Lang;
}

const TranslationsContext = createContext<TranslationsContextValue | null>(null);

interface TranslationsProviderProps {
  translations: Translations;
  lang: Lang;
  children: ReactNode;
}

export function TranslationsProvider({
  translations,
  lang,
  children,
}: TranslationsProviderProps) {
  return (
    <TranslationsContext.Provider value={{ t: translations, lang }}>
      {children}
    </TranslationsContext.Provider>
  );
}

/**
 * Hook pour accéder aux traductions dans un Client Component.
 * Lance une erreur si utilisé en dehors d'un TranslationsProvider.
 */
export function useTranslations(): Translations {
  const ctx = useContext(TranslationsContext);
  if (!ctx) {
    throw new Error(
      'useTranslations doit être utilisé dans un TranslationsProvider',
    );
  }
  return ctx.t;
}

/**
 * Hook pour accéder à la langue courante dans un Client Component.
 */
export function useLang(): Lang {
  const ctx = useContext(TranslationsContext);
  if (!ctx) {
    throw new Error('useLang doit être utilisé dans un TranslationsProvider');
  }
  return ctx.lang;
}
