'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from '@/components/TranslationsProvider';
import { DriverHeader } from '@/components/driver/DriverHeader';
import { DriverBottomNav } from '@/components/driver/DriverBottomNav';
import type { Me } from '@/lib/types';

interface DriverLayoutProps {
  children: ReactNode;
  params: { lang: string };
}

type AuthState =
  | { status: 'loading' }
  | { status: 'ready'; driver: Pick<Me, 'id'> & { displayName: string } }
  | { status: 'error'; message: string };

const DRIVER_ROLES = ['COOP_DRIVER', 'COOP_CONTROLLER', 'COOP_ADMIN'];

export default function DriverLayout({ children, params }: DriverLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations();
  const { lang } = params;
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  const tripIdMatch = pathname.match(/\/driver\/trips\/([^/]+)/);
  const tripId = tripIdMatch?.[1] ?? undefined;

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: `/${lang}/driver/` })
        .catch(() => { /* SW non critique */ });
    }

    const checkAuth = async () => {
      try {
        const response = await fetch('/api/proxy/v1/auth/me', { cache: 'no-store' });

        if (response.status === 401) {
          router.replace(`/${lang}/auth/login?redirect=${encodeURIComponent('/' + lang + '/driver')}`);
          return;
        }

        if (!response.ok) {
          setAuthState({ status: 'error', message: t.driver.auth.error });
          return;
        }

        const me = await response.json() as Me;
        const roles: string[] = me.roles ?? [];
        const cooperatives = me.cooperatives ?? [];

        const hasDriverRole =
          roles.some((r) => DRIVER_ROLES.includes(r)) ||
          cooperatives.some((c) => DRIVER_ROLES.includes(c.role));

        if (!hasDriverRole) {
          router.replace(`/${lang}/auth/login?redirect=${encodeURIComponent('/' + lang + '/driver')}`);
          return;
        }

        const traveler = me.traveler;
        const displayName = traveler
          ? `${traveler.firstName} ${traveler.lastName}`
          : (me.email ?? me.phone ?? t.driver.header.driver);

        setAuthState({ status: 'ready', driver: { id: me.id, displayName } });
      } catch {
        setAuthState({ status: 'error', message: t.driver.auth.error });
      }
    };

    checkAuth();
  }, [router, lang, t]);

  if (authState.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-dark">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-white/80 text-sm">{t.driver.auth.checking}</p>
        </div>
      </div>
    );
  }

  if (authState.status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="text-sm text-red-700 font-medium">{authState.message}</p>
          <button type="button" onClick={() => window.location.reload()} className="text-sm text-brand underline min-h-[44px] px-4">
            {t.common.retry}
          </button>
        </div>
      </div>
    );
  }

  const { driver } = authState;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <DriverHeader driverName={driver.displayName} />
      <main id="main-content" className="flex-1 pt-14 pb-16 overflow-auto" tabIndex={-1}>
        {children}
      </main>
      <DriverBottomNav tripId={tripId} />
    </div>
  );
}
