'use client';

/**
 * Layout du back-office coopérative — /fr/coop/*.
 *
 * Ce layout est distinct de /[lang]/layout.tsx :
 *  - Pas de Navbar/Footer voyageur
 *  - Sidebar fixe + Header
 *  - FR uniquement (pas de bilinguisme côté back-office)
 *
 * Auth guard (côté client via useEffect) :
 *  - Si pas de cookie session → redirect vers /fr/auth/login
 *  - Si utilisateur n'a pas COOP_ADMIN ou COOP_ASSISTANT → redirect
 *
 * Les données coopérative sont chargées une fois au mount et partagées
 * via CoopProvider (contexte React).
 */

import { useState, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CoopProvider } from './CoopContext';
import { CoopSidebar } from '@/components/coop/CoopSidebar';
import { CoopHeader } from '@/components/coop/CoopHeader';
import type { Cooperative, CooperativeRole } from '@/lib/types';

interface CoopLayoutProps {
  children: ReactNode;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; cooperative: Cooperative; role: CooperativeRole; userId: string }
  | { status: 'error'; message: string };

export default function CoopLayout({ children }: CoopLayoutProps) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        // 1. Charger les infos utilisateur (GET /me)
        const meRes = await fetch('/api/proxy/v1/auth/me', { cache: 'no-store' });
        if (meRes.status === 401) {
          router.replace(
            `/fr/auth/login?redirect=${encodeURIComponent('/fr/coop')}`,
          );
          return;
        }
        if (!meRes.ok) {
          setState({ status: 'error', message: 'Impossible de vérifier votre session.' });
          return;
        }

        const me = await meRes.json();
        const roles: string[] = me.roles ?? [];
        const cooperatives: Array<{ id: string; displayName: string; role: string }> =
          me.cooperatives ?? [];

        // 2. Vérifier le rôle back-office
        const coopMembership = cooperatives.find((c) =>
          ['COOP_ADMIN', 'COOP_ASSISTANT'].includes(c.role),
        );

        if (!coopMembership && !roles.includes('COOP_ADMIN') && !roles.includes('COOP_ASSISTANT')) {
          router.replace(`/fr/auth/login?redirect=${encodeURIComponent('/fr/coop')}`);
          return;
        }

        // 3. Charger les données de la coopérative
        const coopRes = await fetch('/api/proxy/v1/coop/cooperatives/current', {
          cache: 'no-store',
        });
        if (!coopRes.ok) {
          setState({ status: 'error', message: 'Impossible de charger les données de la coopérative.' });
          return;
        }

        const cooperative: Cooperative = await coopRes.json();
        const role = (coopMembership?.role ?? 'COOP_ASSISTANT') as CooperativeRole;

        setState({ status: 'ready', cooperative, role, userId: me.id });
      } catch {
        setState({
          status: 'error',
          message: 'Erreur réseau. Vérifiez votre connexion et actualisez la page.',
        });
      }
    };

    load();
  }, [router]);

  // ─── État de chargement ────────────────────────────────────────────────────
  if (state.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Chargement du back-office...</p>
        </div>
      </div>
    );
  }

  // ─── État d'erreur ─────────────────────────────────────────────────────────
  if (state.status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="text-sm text-red-700 font-medium">{state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-sm text-brand underline"
          >
            Actualiser la page
          </button>
        </div>
      </div>
    );
  }

  // ─── Layout principal ──────────────────────────────────────────────────────
  const { cooperative, role, userId } = state;

  return (
    <CoopProvider cooperative={cooperative} role={role} userId={userId} lang="fr">
      <div className="min-h-screen flex bg-gray-50">
        {/* Sidebar */}
        <CoopSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Zone principale */}
        <div className="flex-1 flex flex-col min-w-0 min-h-screen">
          {/* Header */}
          <CoopHeader onMenuToggle={() => setSidebarOpen((prev) => !prev)} />

          {/* Contenu de la page */}
          <main
            id="main-content"
            className="flex-1 p-4 md:p-6 overflow-auto"
          >
            {children}
          </main>
        </div>
      </div>
    </CoopProvider>
  );
}
