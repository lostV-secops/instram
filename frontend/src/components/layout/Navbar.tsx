'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations, useLang } from '@/components/TranslationsProvider';

interface NavbarProps {
  isAuthenticated?: boolean;
  userFirstName?: string;
}

export function Navbar({ isAuthenticated = false, userFirstName }: NavbarProps) {
  const t = useTranslations();
  const lang = useLang();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const otherLang = lang === 'fr' ? 'mg' : 'fr';
  const switchLangPath = pathname.replace(`/${lang}`, `/${otherLang}`);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="bg-brand shadow-md" role="banner">
      <nav
        className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between"
        aria-label="Navigation principale"
      >
        {/* Logo */}
        <Link
          href={`/${lang}`}
          className="text-white font-bold text-xl tracking-tight hover:opacity-90 transition-opacity"
          aria-label="InsTRAM — Accueil"
          onClick={closeMenu}
        >
          InsTRAM
        </Link>

        {/* Navigation desktop */}
        <ul
          className="hidden sm:flex items-center gap-4"
          role="list"
          aria-label="Liens principaux"
        >
          <li>
            <Link href={`/${lang}`} className="text-white/90 hover:text-white text-sm transition-colors">
              {t.nav.home}
            </Link>
          </li>
          <li>
            <Link href={`/${lang}/cooperatives`} className="text-white/90 hover:text-white text-sm transition-colors">
              {t.nav.cooperatives}
            </Link>
          </li>
          {isAuthenticated && (
            <>
              <li>
                <Link href={`/${lang}/bookings`} className="text-white/90 hover:text-white text-sm transition-colors">
                  {t.nav.myBookings}
                </Link>
              </li>
              <li>
                <Link href={`/${lang}/profile`} className="text-white/90 hover:text-white text-sm transition-colors">
                  {t.nav.myProfile}
                </Link>
              </li>
            </>
          )}
        </ul>

        {/* Actions droite */}
        <div className="flex items-center gap-3">
          {/* Sélecteur de langue */}
          <Link
            href={switchLangPath}
            className="text-white/80 hover:text-white text-xs border border-white/30 rounded px-2 py-1 transition-colors"
            aria-label={`Basculer vers ${otherLang === 'fr' ? 'Français' : 'Malagasy'}`}
            onClick={closeMenu}
          >
            {t.nav.switchLang}
          </Link>

          {/* Auth desktop */}
          {isAuthenticated ? (
            <div className="hidden sm:flex items-center gap-2">
              {userFirstName && (
                <span className="text-white/80 text-sm">{userFirstName}</span>
              )}
              <form action="/api/auth/logout" method="POST">
                <button type="submit" className="text-white/90 hover:text-white text-sm transition-colors">
                  {t.common.logout}
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href={`/${lang}/auth/login`} className="text-white/90 hover:text-white text-sm transition-colors">
                {t.nav.login}
              </Link>
              <Link
                href={`/${lang}/auth/register`}
                className="hidden sm:inline-block bg-white text-brand text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-white/90 transition-colors"
              >
                {t.nav.register}
              </Link>
            </div>
          )}

          {/* Bouton hamburger — mobile uniquement */}
          <button
            className="sm:hidden flex flex-col justify-center items-center w-8 h-8 gap-1.5"
            aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className={`block h-0.5 w-5 bg-white transition-transform duration-200 ${menuOpen ? 'translate-y-2 rotate-45' : ''}`} />
            <span className={`block h-0.5 w-5 bg-white transition-opacity duration-200 ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`block h-0.5 w-5 bg-white transition-transform duration-200 ${menuOpen ? '-translate-y-2 -rotate-45' : ''}`} />
          </button>
        </div>
      </nav>

      {/* Menu mobile déroulant */}
      {menuOpen && (
        <div
          id="mobile-menu"
          className="sm:hidden bg-brand-dark border-t border-white/10 px-4 py-3 space-y-1"
          role="menu"
          aria-label="Menu mobile"
        >
          <Link
            href={`/${lang}`}
            className="block py-2.5 text-white/90 hover:text-white text-sm border-b border-white/10"
            role="menuitem"
            onClick={closeMenu}
          >
            {t.nav.home}
          </Link>
          <Link
            href={`/${lang}/cooperatives`}
            className="block py-2.5 text-white/90 hover:text-white text-sm border-b border-white/10"
            role="menuitem"
            onClick={closeMenu}
          >
            {t.nav.cooperatives}
          </Link>
          {isAuthenticated ? (
            <>
              <Link
                href={`/${lang}/bookings`}
                className="block py-2.5 text-white/90 hover:text-white text-sm border-b border-white/10"
                role="menuitem"
                onClick={closeMenu}
              >
                {t.nav.myBookings}
              </Link>
              <Link
                href={`/${lang}/profile`}
                className="block py-2.5 text-white/90 hover:text-white text-sm border-b border-white/10"
                role="menuitem"
                onClick={closeMenu}
              >
                {t.nav.myProfile}
              </Link>
              {userFirstName && (
                <p className="pt-2 text-white/60 text-xs">{userFirstName}</p>
              )}
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="w-full text-left py-2.5 text-white/90 hover:text-white text-sm"
                  onClick={closeMenu}
                >
                  {t.common.logout}
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href={`/${lang}/auth/login`}
                className="block py-2.5 text-white/90 hover:text-white text-sm border-b border-white/10"
                role="menuitem"
                onClick={closeMenu}
              >
                {t.nav.login}
              </Link>
              <Link
                href={`/${lang}/auth/register`}
                className="block py-2.5 text-white/90 hover:text-white text-sm"
                role="menuitem"
                onClick={closeMenu}
              >
                {t.nav.register}
              </Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}

export default Navbar;
