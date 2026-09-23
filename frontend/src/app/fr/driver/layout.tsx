'use client';

/**
 * Layout de l'application conducteur — /fr/driver/*.
 *
 * Auth guard côté client :
 *  - GET /api/proxy/v1/me → si 401 → redirect /fr/auth/login?redirect=/fr/driver
 *  - Vérifie le rôle COOP_DRIVER (ou COOP_CONTROLLER)
 *  - Si rôle insuffisant → même redirect
 *
 * Structure mobile-first :
 *  - DriverHeader fixe en haut (h-14 = 56 px)
 *  - DriverBottomNav fixe en bas (h-16 = 64 px)
 *  - Contenu au milieu avec pt-14 + pb-16 pour ne pas être masqué
 *
 * Service Worker PWA enregistré ici (assets statiques uniquement).
 * Viewport avec maximum-scale=1 pour bloquer le zoom involontaire.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { DriverHeader } from '@/components/driver/DriverHeader';
import { DriverBottomNav } from '@/components/driver/DriverBottomNav';
import type { Me } from '@/lib/types';

interface DriverLayoutProps {
  children: ReactNode;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'ready'; driver: Pick<Me, 'id'> & { displayName: string } }
  | { status: 'error'; message: string };

const DRIVER_ROLES = ['COOP_DRIVER', 'COOP_CONTROLLER', 'COOP_ADMIN'];

export default function DriverLayout({ children }: DriverLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  // Extraire le tripId de l'URL pour passer à DriverBottomNav
  // ex: /fr/driver/trips/abc-123/scan → tripId = "abc-123"
  const tripIdMatch = pathname.match(/\/fr\/driver\/trips\/([^/]+)/);
  const tripId = tripIdMatch?.[1] ?? undefined;

  useEffect(() => {
    // Enregistrer le Service Worker PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/fr/driver/' })
        .catch(() => {
          // SW non critique — on ignore silencieusement
        });
    }

    // Vérifier l'authentification et le rôle
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/proxy/v1/auth/me', { cache: 'no-store' });

        if (response.status === 401) {
          router.replace(
            `/fr/auth/login?redirect=${encodeURIComponent('/fr/driver')}`,
          );
          return;
        }

        if (!response.ok) {
          setAuthState({
            status: 'error',
            message: 'Impossible de vérifier votre session.',
          });
          return;
        }

        const me = await response.json() as Me;
        const roles: string[] = me.roles ?? [];
        const cooperatives = me.cooperatives ?? [];

        // Vérifier si l'utilisateur a un rôle conducteur
        const hasDriverRole =
          roles.some((r) => DRIVER_ROLES.includes(r)) ||
          cooperatives.some((c) => DRIVER_ROLES.includes(c.role));

        if (!hasDriverRole) {
          router.replace(
            `/fr/auth/login?redirect=${encodeURIComponent('/fr/driver')}`,
          );
          return;
        }

        // Construire le nom d'affichage du conducteur
        const traveler = me.traveler;
        const displayName = traveler
          ? `${traveler.firstName} ${traveler.lastName}`
          : (me.email ?? me.phone ?? 'Conducteur');

        setAuthState({
          status: 'ready',
          driver: { id: me.id, displayName },
        });
      } catch {
        setAuthState({
          status: 'error',
          message: 'Erreur réseau. Vérifiez votre connexion et actualisez.',
        });
      }
    };

    checkAuth();
  }, [router]);

  // ─── Chargement ───────────────────────────────────────────────────────────────
  if (authState.status === 'loading') {
    return (
      <>
        {/* Viewport mobile — doit être dans le head mais on le met ici via CSS pour éviter les doublons */}
        <div className="min-h-screen flex items-center justify-center bg-brand-dark">
          <div className="text-center space-y-4">
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-white/80 text-sm">Vérification de la session...</p>
          </div>
        </div>
      </>
    );
  }

  // ─── Erreur ───────────────────────────────────────────────────────────────────
  if (authState.status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <svg
              className="w-6 h-6 text-red-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="text-sm text-red-700 font-medium">{authState.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-sm text-brand underline min-h-[44px] px-4"
          >
            Actualiser la page
          </button>
        </div>
      </div>
    );
  }

  // ─── Layout principal ─────────────────────────────────────────────────────────
  const { driver } = authState;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header fixe en haut */}
      <DriverHeader driverName={driver.displayName} />

      {/* Contenu principal — marges pour ne pas être masqué par header/nav */}
      <main
        id="main-content"
        className="flex-1 pt-14 pb-16 overflow-auto"
        tabIndex={-1}
      >
        {children}
      </main>

      {/* Navigation fixe en bas */}
      <DriverBottomNav tripId={tripId} />
    </div>
  );
}
