'use client';

/**
 * Barre de navigation inférieure — application conducteur.
 *
 * Fixée en bas, hauteur h-16 (64 px). Fond blanc avec bordure supérieure.
 * Onglets : Trajets | Scanner (si tripId fourni) | Profil.
 * Icônes SVG inline, labels texte courts, touch targets >= 48 px.
 * Couleur active : bleu principal #205E98 (brand).
 * Jamais de vert (#9CC43D) sur la navigation.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations, useLang } from '@/components/TranslationsProvider';

const IconList = ({ active }: { active: boolean }) => (
  <svg
    className={`w-6 h-6 ${active ? 'text-brand' : 'text-gray-500'}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={active ? 2.5 : 2}
    aria-hidden="true"
  >
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const IconQR = ({ active }: { active: boolean }) => (
  <svg
    className={`w-6 h-6 ${active ? 'text-brand' : 'text-gray-500'}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={active ? 2.5 : 2}
    aria-hidden="true"
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM17 17h4M17 14h4M14 17v4" />
  </svg>
);

const IconUser = ({ active }: { active: boolean }) => (
  <svg
    className={`w-6 h-6 ${active ? 'text-brand' : 'text-gray-500'}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={active ? 2.5 : 2}
    aria-hidden="true"
  >
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

interface DriverBottomNavProps {
  /** tripId courant — si fourni, l'onglet Scanner est affiché et lié à ce trajet */
  tripId?: string;
}

export function DriverBottomNav({ tripId }: DriverBottomNavProps) {
  const pathname = usePathname();
  const lang = useLang();
  const t = useTranslations();

  const isScanActive = pathname.includes('/scan');
  const isProfileActive = pathname.includes('/driver/profile');
  const isTripsActive = !isScanActive && !isProfileActive;

  interface Tab {
    href: string;
    label: string;
    isActive: boolean;
    icon: React.ReactNode;
  }

  const tabs: Tab[] = [
    {
      href: `/${lang}/driver`,
      label: t.driver.nav.trips,
      isActive: isTripsActive,
      icon: <IconList active={isTripsActive} />,
    },
    ...(tripId
      ? [
          {
            href: `/${lang}/driver/trips/${tripId}/scan`,
            label: t.driver.nav.scan,
            isActive: isScanActive,
            icon: <IconQR active={isScanActive} />,
          },
        ]
      : []),
    {
      href: `/${lang}/driver/profile`,
      label: t.driver.nav.profile,
      isActive: isProfileActive,
      icon: <IconUser active={isProfileActive} />,
    },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 h-16 bg-white border-t border-gray-200 flex items-stretch"
      aria-label="Navigation principale conducteur"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.isActive ? 'page' : undefined}
          className={[
            'flex-1 flex flex-col items-center justify-center gap-0.5',
            'min-h-[48px] select-none',
            'transition-colors duration-150',
            tab.isActive
              ? 'text-brand'
              : 'text-gray-500 hover:text-brand',
            'focus:outline-none focus:bg-gray-50',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {tab.icon}
          <span
            className={`text-xs font-medium ${
              tab.isActive ? 'text-brand' : 'text-gray-500'
            }`}
          >
            {tab.label}
          </span>
        </Link>
      ))}
    </nav>
  );
}

export default DriverBottomNav;
