/**
 * Layout racine bilingue — fournit TranslationsProvider à toutes les pages
 * sous /[lang]/* (voyageur, back-office coop, driver, admin).
 * La Navbar/Footer voyageur est dans (public)/layout.tsx.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { TranslationsProvider } from '@/components/TranslationsProvider';
import type { Lang } from '@/lib/types';

interface LayoutProps {
  children: React.ReactNode;
  params: { lang: string };
}

export async function generateMetadata({
  params,
}: {
  params: { lang: string };
}): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};

  const t = getTranslations(params.lang);
  return {
    title: {
      template: `%s — InsTRAM`,
      default: t.home.title,
    },
    description: t.home.subtitle,
    openGraph: {
      locale: params.lang === 'mg' ? 'mg_MG' : 'fr_MG',
    },
  };
}

export function generateStaticParams() {
  return [{ lang: 'fr' }, { lang: 'mg' }];
}

export default function LangLayout({ children, params }: LayoutProps) {
  const { lang } = params;

  if (!isValidLang(lang)) {
    notFound();
  }

  const t = getTranslations(lang);

  return (
    <TranslationsProvider translations={t} lang={lang as Lang}>
      {children}
    </TranslationsProvider>
  );
}
