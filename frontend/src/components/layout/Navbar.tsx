'use client';

/**
 * Barre de navigation InsTRAM — espace voyageur.
 * Couleurs : bleu #205E98 (fond), blanc (texte/liens).
 * Sélecteur de langue : lien discret (pas de vert).
 * Aucun vert (#9CC43D) dans la navigation.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations, useLang } from '@/components/TranslationsProvider';

interface NavbarProps {
  /** Indique si l'utilisateur est connecté */
  isAuthenticated?: boolean;
  userFirstName?: string;
}

export function Navbar({ isAuthenticated = false, userFirstName }: NavbarProps) {
  const t = useTranslations();
  const lang = useLang();
  const pathname = usePathname();

  // Générer le chemin équivalent dans l'autre langue
  const otherLang = lang === 'fr' ? 'mg' : 'fr';
  const switchLangPath = pathname.replace(`/${lang}`, `/${otherLang}`);

  return (
    <header className="bg-brand shadow-md" role="banner">
      <nav
        className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between"
        aria-label="Navigation principale"
      >
        {/* Logo / Nom de la plateforme */}
        <Link
          href={`/${lang}`}
          className="text-white font-bold text-xl tracking-tight hover:opacity-90 transition-opacity"
          aria-label="InsTRAM — Accueil"
        >
          InsTRAM
        </Link>

        {/* Navigation centrale (masquée sur très petit écran) */}
        <ul
          className="hidden sm:flex items-center gap-4"
          role="list"
          aria-label="Liens principaux"
        >
          <li>
            <Link
              href={`/${lang}`}
              className="text-white/90 hover:text-white text-sm transition-colors"
            >
              {t.nav.home}
            </Link>
          </li>
          <li>
            <Link
              href={`/${lang}/cooperatives`}
              className="text-white/90 hover:text-white text-sm transition-colors"
            >
              {t.nav.cooperatives}
            </Link>
          </li>
          {isAuthenticated && (
            <>
              <li>
                <Link
                  href={`/${lang}/bookings`}
                  className="text-white/90 hover:text-white text-sm transition-colors"
                >
                  {t.nav.myBookings}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/profile`}
                  className="text-white/90 hover:text-white text-sm transition-colors"
                >
                  {t.nav.myProfile}
                </Link>
              </li>
            </>
          )}
        </ul>

        {/* Actions à droite */}
        <div className="flex items-center gap-3">
          {/* Sélecteur de langue */}
          <Link
            href={switchLangPath}
            className="text-white/80 hover:text-white text-xs border border-white/30 rounded px-2 py-1 transition-colors"
            aria-label={`Basculer vers ${otherLang === 'fr' ? 'Français' : 'Malagasy'}`}
          >
            {t.nav.switchLang}
          </Link>

          {/* Authentification */}
          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              {userFirstName && (
                <span className="text-white/80 text-sm hidden sm:inline">
                  {userFirstName}
                </span>
              )}
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="text-white/90 hover:text-white text-sm transition-colors"
                >
                  {t.common.logout}
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href={`/${lang}/auth/login`}
                className="text-white/90 hover:text-white text-sm transition-colors"
              >
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
        </div>
      </nav>
    </header>
  );
}

export default Navbar;
