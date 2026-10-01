'use client';

/**
 * Header mobile de l'application conducteur.
 *
 * Hauteur fixe h-14 (56 px). Fond bleu foncé #162E49 (brand-dark).
 * Logo InsTRAM à gauche, nom conducteur au centre, bouton déconnexion à droite.
 * Pas d'image décorative — icône SVG inline uniquement.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations, useLang } from '@/components/TranslationsProvider';

interface DriverHeaderProps {
  driverName: string;
}

const IconLogout = () => (
  <svg
    className="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export function DriverHeader({ driverName }: DriverHeaderProps) {
  const router = useRouter();
  const lang = useLang();
  const t = useTranslations();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignorer les erreurs réseau — on redirige quand même
    }
    router.replace(`/${lang}/auth/login`);
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-30 h-14 bg-brand-dark flex items-center px-4 gap-3"
      role="banner"
    >
      {/* Logo texte */}
      <span className="text-white font-bold text-lg tracking-tight select-none flex-shrink-0">
        InsTRAM
      </span>

      {/* Nom conducteur — tronqué si trop long */}
      <span className="flex-1 text-center text-white text-sm font-medium truncate px-2">
        {driverName}
      </span>

      {/* Bouton déconnexion — min 48×48 px */}
      <button
        type="button"
        onClick={handleLogout}
        disabled={isLoggingOut}
        aria-label={t.driver.header.logout}
        className={[
          'flex items-center justify-center w-12 h-12 -mr-2',
          'rounded-lg text-white/80 hover:text-white hover:bg-white/10',
          'transition-colors duration-150',
          'focus:outline-none focus:ring-2 focus:ring-white/50',
          isLoggingOut ? 'opacity-50 cursor-not-allowed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {isLoggingOut ? (
          <svg
            className="animate-spin h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : (
          <IconLogout />
        )}
      </button>
    </header>
  );
}

export default DriverHeader;
