'use client';

/**
 * En-tête du back-office coopérative.
 *
 * Affiche :
 * - Bouton hamburger (mobile)
 * - Nom de la coopérative (depuis le contexte)
 * - Rôle de l'utilisateur
 * - Bouton de déconnexion
 */

import { useRouter } from 'next/navigation';
import { useCoop } from '@/app/fr/coop/CoopContext';
import type { CooperativeRole } from '@/lib/types';

const roleLabels: Record<CooperativeRole, string> = {
  COOP_ADMIN: 'Administrateur',
  COOP_ASSISTANT: 'Assistant',
  COOP_DRIVER: 'Conducteur',
  COOP_CONTROLLER: 'Contrôleur',
};

interface CoopHeaderProps {
  onMenuToggle: () => void;
}

export function CoopHeader({ onMenuToggle }: CoopHeaderProps) {
  const { cooperative, role } = useCoop();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignorer l'erreur réseau — la session sera invalide de toute façon
    }
    router.push('/fr/auth/login');
  };

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 flex-shrink-0">
      {/* Hamburger mobile */}
      <button
        type="button"
        className="lg:hidden p-2 rounded-md text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand"
        onClick={onMenuToggle}
        aria-label="Ouvrir le menu"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Nom coopérative */}
      <div className="flex-1 min-w-0">
        <h1 className="text-sm font-bold text-brand-dark truncate">
          {cooperative.displayName}
        </h1>
        <p className="text-xs text-gray-500">{roleLabels[role]}</p>
      </div>

      {/* Déconnexion */}
      <button
        type="button"
        onClick={handleLogout}
        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 rounded px-2 py-1 transition-colors"
        aria-label="Se déconnecter"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span className="hidden sm:inline">Déconnexion</span>
      </button>
    </header>
  );
}

export default CoopHeader;
