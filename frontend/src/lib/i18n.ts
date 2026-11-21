import type { Lang } from './types';

// Imports statiques pour permettre au bundler de les inclure dans le bundle
import frTranslations from '../translations/fr.json';
import mgTranslations from '../translations/mg.json';

export type Translations = typeof frTranslations;

const translationsMap: Record<Lang, Translations> = {
  fr: frTranslations,
  mg: mgTranslations as Translations,
};

/**
 * Retourne l'objet de traductions pour une langue donnée.
 * Compatible Server Components (pas d'import dynamique).
 */
export function getTranslations(lang: string): Translations {
  const locale = (lang === 'mg' ? 'mg' : 'fr') as Lang;
  return translationsMap[locale];
}

/**
 * Résout une clé pointée (ex. "common.loading") dans un objet de traductions.
 */
export function t(translations: Translations, key: string): string {
  const parts = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = translations;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return key;
    current = current[part];
  }
  return typeof current === 'string' ? current : key;
}

/** Vérifie si la langue est valide */
export function isValidLang(lang: string): lang is Lang {
  return lang === 'fr' || lang === 'mg';
}

export const SUPPORTED_LANGS: Lang[] = ['fr', 'mg'];
export const DEFAULT_LANG: Lang = 'fr';

/** Retourne le nom d'une ville dans la langue active. */
export function cityName(
  city: { nameFr?: string; nameMg?: string; name?: string } | null | undefined,
  lang: string,
): string {
  if (!city) return '?';
  if (lang === 'mg') return city.nameMg ?? city.nameFr ?? city.name ?? '?';
  return city.nameFr ?? city.name ?? '?';
}

/** Retourne la locale BCP-47 pour toLocaleDateString selon la langue active. */
export function dateLocale(lang: string): string {
  return lang === 'mg' ? 'mg-MG' : 'fr-FR';
}

// Fuseau horaire Madagascar (UTC+3)
const TZ_MG = 'Indian/Antananarivo';

/** Formate une heure ISO en HH:mm heure malgache. */
export function formatTimeMG(isoDate: string, lang = 'fr'): string {
  try {
    return new Date(isoDate).toLocaleTimeString(dateLocale(lang), {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ_MG,
    });
  } catch {
    return isoDate;
  }
}

/** Formate une date+heure ISO en date + HH:mm heure malgache. */
export function formatDateTimeMG(isoDate: string, lang = 'fr'): string {
  try {
    return new Date(isoDate).toLocaleString(dateLocale(lang), {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ_MG,
    });
  } catch {
    return isoDate;
  }
}

/** Formate une date ISO en date courte heure malgache. */
export function formatDateMG(isoDate: string, lang = 'fr', options?: Intl.DateTimeFormatOptions): string {
  try {
    return new Date(isoDate).toLocaleDateString(dateLocale(lang), {
      timeZone: TZ_MG,
      ...options,
    });
  } catch {
    return isoDate;
  }
}
