'use client';

/**
 * Barre de navigation latérale — console admin InsTRAM.
 *
 * Desktop : sidebar fixe à gauche (w-64), fond brand-dark (#162E49).
 * Mobile : drawer par-dessus le contenu, ouvert via AdminHeader.
 *
 * FR uniquement — pas de version malgache pour la console admin (cahier des charges §5.6).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

// ─── Icônes SVG inline ────────────────────────────────────────────────────────

const IconGrid = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const IconBuilding = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 21V9h6v12" />
    <path d="M3 9h18" />
  </svg>
);

const IconCalendar = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const IconClipboard = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
  </svg>
);

const IconStar = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const IconUsers = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const IconDownload = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const IconSettings = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const NAV_ITEMS: NavItem[] = [
  { href: '/fr/admin', label: 'Tableau de bord', icon: <IconGrid /> },
  { href: '/fr/admin/cooperatives', label: 'Coopératives', icon: <IconBuilding /> },
  { href: '/fr/admin/trips', label: 'Trajets', icon: <IconCalendar /> },
  { href: '/fr/admin/bookings', label: 'Réservations', icon: <IconClipboard /> },
  { href: '/fr/admin/ratings', label: 'Modération avis', icon: <IconStar /> },
  { href: '/fr/admin/users', label: 'Utilisateurs', icon: <IconUsers /> },
  { href: '/fr/admin/exports', label: 'Exports', icon: <IconDownload /> },
  { href: '/fr/admin/settings', label: 'Paramètres plateforme', icon: <IconSettings /> },
];

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AdminSidebar({ isOpen, onClose }: AdminSidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/fr/admin') return pathname === '/fr/admin';
    return pathname.startsWith(href);
  };

  const navContent = (
    <nav aria-label="Navigation console admin">
      {/* Logo / Titre */}
      <div className="px-4 py-5 border-b border-white/10">
        <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">
          Console
        </p>
        <p className="text-sm font-bold text-white mt-0.5">InsTRAM Admin</p>
      </div>

      <ul className="py-3 space-y-0.5 px-2" role="list">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onClose}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium',
                'transition-colors duration-150',
                isActive(item.href)
                  ? 'bg-brand text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white',
              ].join(' ')}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <>
      {/* Desktop : sidebar fixe */}
      <aside
        className="hidden lg:flex flex-col w-64 min-h-screen bg-brand-dark flex-shrink-0"
        aria-label="Sidebar console admin"
      >
        {navContent}
      </aside>

      {/* Mobile : drawer overlay */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50"
            aria-hidden="true"
            onClick={onClose}
          />
          {/* Drawer */}
          <aside className="relative flex flex-col w-72 bg-brand-dark z-50 shadow-xl">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}

export default AdminSidebar;
