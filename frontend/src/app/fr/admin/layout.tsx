'use client';

/**
 * Layout de la console admin InsTRAM — /fr/admin/*.
 *
 * Distinct de /fr/coop/* :
 *  - Pas de contexte coopérative
 *  - Sidebar fixe brand-dark + AdminHeader
 *  - FR uniquement (§5.6 du cahier des charges)
 *
 * Auth guard (côté client via useEffect) :
 *  - Si pas de session → redirect vers /fr/auth/login
 *  - Si utilisateur n'a pas ADMIN_SUPER ou ADMIN_OPS → redirect
 *
 * Le rôle admin est partagé via AdminContext (contexte React léger).
 */

import { useState, useEffect, createContext, useContext, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import type { AdminRole } from '@/lib/types';

// ─── Contexte admin ────────────────────────────────────────────────────────────

interface AdminContextValue {
  role: AdminRole;
  userId: string;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin doit être utilisé dans AdminLayout');
  return ctx;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

interface AdminLayoutProps {
  children: ReactNode;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; role: AdminRole; userId: string }
  | { status: 'error'; message: string };

const ADMIN_ROLES: AdminRole[] = ['ADMIN_SUPER', 'ADMIN_OPS', 'ADMIN_MODERATOR'];

export default function AdminLayout({ children }: AdminLayoutProps) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/proxy/v1/auth/me', { cache: 'no-store' });

        if (res.status === 401) {
          router.replace(
            `/fr/auth/login?redirect=${encodeURIComponent('/fr/admin')}`,
          );
          return;
        }

        if (!res.ok) {
          setState({ status: 'error', message: 'Impossible de vérifier votre session.' });
          return;
        }

        const me = await res.json();
        const roles: string[] = me.roles ?? [];

        const adminRole = ADMIN_ROLES.find((r) => roles.includes(r));

        if (!adminRole) {
          router.replace(
            `/fr/auth/login?redirect=${encodeURIComponent('/fr/admin')}`,
          );
          return;
        }

        setState({ status: 'ready', role: adminRole, userId: me.id });
      } catch {
        setState({
          status: 'error',
          message: 'Erreur réseau. Vérifiez votre connexion et actualisez la page.',
        });
      }
    };

    checkAuth();
  }, [router]);

  // ─── État de chargement ────────────────────────────────────────────────────
  if (state.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Vérification de la session...</p>
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
  const { role, userId } = state;

  return (
    <AdminContext.Provider value={{ role, userId }}>
      <div className="min-h-screen flex bg-gray-50">
        {/* Sidebar */}
        <AdminSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Zone principale */}
        <div className="flex-1 flex flex-col min-w-0 min-h-screen">
          {/* Header */}
          <AdminHeader
            role={role}
            onMenuToggle={() => setSidebarOpen((prev) => !prev)}
          />

          {/* Contenu de la page */}
          <main
            id="main-content"
            className="flex-1 p-4 md:p-6 overflow-auto"
          >
            {children}
          </main>
        </div>
      </div>
    </AdminContext.Provider>
  );
}
