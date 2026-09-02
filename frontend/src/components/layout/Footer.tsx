/**
 * Pied de page InsTRAM.
 * Fond bleu foncé #162E49 (brand-dark) — zone officielle.
 * Pas de vert dans le footer.
 */

import Link from 'next/link';
import type { Lang } from '@/lib/types';
import type { Translations } from '@/lib/i18n';

interface FooterProps {
  lang: Lang;
  t: Translations;
}

export function Footer({ lang, t }: FooterProps) {
  return (
    <footer
      className="bg-brand-dark text-white/70 mt-auto"
      role="contentinfo"
    >
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
          <p>{t.footer.copyright}</p>

          <nav aria-label="Liens légaux">
            <ul className="flex gap-4" role="list">
              <li>
                <Link
                  href={`/${lang}/terms`}
                  className="hover:text-white transition-colors underline-offset-2 hover:underline"
                >
                  {t.footer.terms}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/privacy`}
                  className="hover:text-white transition-colors underline-offset-2 hover:underline"
                >
                  {t.footer.privacy}
                </Link>
              </li>
              <li>
                <a
                  href="mailto:contact@codel.mg"
                  className="hover:text-white transition-colors underline-offset-2 hover:underline"
                >
                  {t.footer.contact}
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
