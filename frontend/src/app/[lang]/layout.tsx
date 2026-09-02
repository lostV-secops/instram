/**
 * Layout de l'espace voyageur — appliqué à toutes les pages /fr/* et /mg/*.
 * Fournit :
 * - TranslationsProvider (contexte i18n pour les Client Components)
 * - Navbar et Footer
 * - Metadata localisée
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { TranslationsProvider } from '@/components/TranslationsProvider';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { COOKIE_USER_INFO, parseUserInfoCookie } from '@/lib/auth';
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

  // Valider la langue — 404 si segment invalide
  if (!isValidLang(lang)) {
    notFound();
  }

  const t = getTranslations(lang);

  // Lire les infos utilisateur depuis le cookie non-sensible
  const cookieStore = cookies();
  const userInfoRaw = cookieStore.get(COOKIE_USER_INFO)?.value;
  const userInfo = parseUserInfoCookie(userInfoRaw);
  const isAuthenticated = userInfo !== null;

  return (
    <TranslationsProvider translations={t} lang={lang as Lang}>
      <div className="min-h-screen flex flex-col">
        <Navbar isAuthenticated={isAuthenticated} />
        <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6" id="main-content">
          {children}
        </main>
        <Footer lang={lang as Lang} t={t} />
      </div>
    </TranslationsProvider>
  );
}
