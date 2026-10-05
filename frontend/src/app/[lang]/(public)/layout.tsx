import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { getTranslations } from '@/lib/i18n';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { COOKIE_USER_INFO, parseUserInfoCookie } from '@/lib/auth';
import type { Lang } from '@/lib/types';

interface PublicLayoutProps {
  children: ReactNode;
  params: { lang: string };
}

export default function PublicLayout({ children, params }: PublicLayoutProps) {
  const { lang } = params;
  const t = getTranslations(lang);

  const cookieStore = cookies();
  const userInfoRaw = cookieStore.get(COOKIE_USER_INFO)?.value;
  const userInfo = parseUserInfoCookie(userInfoRaw);
  const isAuthenticated = userInfo !== null;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar isAuthenticated={isAuthenticated} />
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6" id="main-content">
        {children}
      </main>
      <Footer lang={lang as Lang} t={t} />
    </div>
  );
}
