'use client';

/**
 * Page profil du conducteur.
 *
 * Fetch GET /api/proxy/v1/me — affiche les infos publiques du conducteur.
 * Bouton de déconnexion avec POST /api/auth/logout.
 * Mobile-first, pas d'image décorative.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import type { Me } from '@/lib/types';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; me: Me }
  | { status: 'error'; message: string };

const ROLE_LABELS: Record<string, string> = {
  COOP_DRIVER: 'Conducteur',
  COOP_CONTROLLER: 'Contrôleur',
  COOP_ADMIN: 'Administrateur',
  COOP_ASSISTANT: 'Assistant',
};

function getRoleLabel(roles: string[], cooperatives: Me['cooperatives']): string {
  // Chercher dans les rôles de la coopérative
  const coopRole = cooperatives?.[0]?.role;
  if (coopRole && ROLE_LABELS[coopRole]) return ROLE_LABELS[coopRole];
  // Chercher dans les rôles globaux
  for (const role of roles) {
    if (ROLE_LABELS[role]) return ROLE_LABELS[role];
  }
  return 'Conducteur';
}

function getCoopName(cooperatives: Me['cooperatives']): string | null {
  return cooperatives?.[0]?.displayName ?? null;
}

const IconUser = () => (
  <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

interface InfoRowProps {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}

function InfoRow({ label, value, mono = false }: InfoRowProps) {
  if (!value) return null;
  return (
    <div className="flex flex-col py-3 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-0.5">
        {label}
      </span>
      <span className={`text-base text-gray-900 ${mono ? 'font-mono' : 'font-medium'}`}>
        {value}
      </span>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>({ status: 'loading' });
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const response = await fetch('/api/proxy/v1/auth/me', { cache: 'no-store' });
        if (response.status === 401) {
          router.replace('/fr/auth/login?redirect=/fr/driver');
          return;
        }
        if (!response.ok) {
          setPageState({ status: 'error', message: 'Impossible de charger le profil.' });
          return;
        }
        const me = await response.json() as Me;
        setPageState({ status: 'ready', me });
      } catch {
        setPageState({
          status: 'error',
          message: 'Erreur réseau. Vérifiez votre connexion.',
        });
      }
    };
    loadProfile();
  }, [router]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch { /* ignorer */ }
    router.replace('/fr/auth/login');
  };

  // ─── Chargement ───────────────────────────────────────────────────────────
  if (pageState.status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Chargement du profil...</p>
      </div>
    );
  }

  // ─── Erreur ───────────────────────────────────────────────────────────────
  if (pageState.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 gap-4 text-center">
        <p className="text-sm text-gray-700 font-medium max-w-xs">{pageState.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-sm text-brand underline min-h-[44px]"
        >
          Actualiser
        </button>
      </div>
    );
  }

  const { me } = pageState;
  const traveler = me.traveler;
  const fullName = traveler
    ? `${traveler.firstName} ${traveler.lastName}`
    : null;
  const roleLabel = getRoleLabel(me.roles, me.cooperatives);
  const coopName = getCoopName(me.cooperatives);
  const initials = fullName
    ? fullName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'CO';

  return (
    <div className="pb-4">
      {/* En-tête profil */}
      <div className="bg-brand-dark px-4 pt-4 pb-6 flex flex-col items-center gap-3">
        {/* Avatar initiales */}
        <div
          className="w-20 h-20 rounded-full bg-brand flex items-center justify-center"
          aria-hidden="true"
        >
          {fullName ? (
            <span className="text-2xl font-bold text-white">{initials}</span>
          ) : (
            <IconUser />
          )}
        </div>

        {/* Nom */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-white">
            {fullName ?? me.email ?? me.phone ?? 'Conducteur'}
          </h1>
          <p className="text-sm text-white/70 mt-0.5">{roleLabel}</p>
        </div>
      </div>

      {/* Informations du profil */}
      <div className="mx-4 mt-4 bg-white rounded-xl shadow-sm border border-gray-100 px-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-3 pb-1">
          Informations
        </p>
        <InfoRow label="Nom complet" value={fullName} />
        <InfoRow label="Email" value={me.email} />
        <InfoRow label="Téléphone" value={me.phone} mono />
        {traveler?.mobileMoneyPhone && (
          <InfoRow label="Mobile Money" value={traveler.mobileMoneyPhone} mono />
        )}
        <InfoRow label="Rôle" value={roleLabel} />
        <InfoRow label="Coopérative" value={coopName} />
        <InfoRow label="Identifiant" value={me.id} mono />
      </div>

      {/* Version de l'application */}
      <div className="mx-4 mt-3 bg-white rounded-xl border border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Application</span>
          <span className="text-sm font-medium text-gray-700">InsTRAM Conducteur v1</span>
        </div>
      </div>

      {/* Bouton déconnexion */}
      <div className="mx-4 mt-5">
        <Button
          variant="danger"
          size="lg"
          fullWidth
          isLoading={isLoggingOut}
          onClick={handleLogout}
          className="min-h-[52px] text-base"
        >
          {isLoggingOut ? 'Déconnexion...' : 'Se déconnecter'}
        </Button>
      </div>

      {/* Note sécurité */}
      <p className="px-4 mt-3 text-xs text-center text-gray-400">
        La déconnexion supprime votre session sur cet appareil
      </p>
    </div>
  );
}
