/**
 * Layout racine — requis par Next.js App Router.
 * Le contenu réel (html, body, lang) est fourni par [lang]/layout.tsx.
 * Lit le cookie NEXT_LOCALE pour initialiser le lang sur html.
 */

import { cookies } from 'next/headers';
import './globals.css';

export const metadata = {
  title: 'InsTRAM — Réservation de transport à Madagascar',
  description:
    'Réservez votre place dans les transports terrestres à Madagascar / Ambara ny toeranao amin\'ny fitaterana an-tanety eto Madagasikara',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Lire la langue depuis le cookie (défini par le middleware)
  const cookieStore = cookies();
  const lang = cookieStore.get('NEXT_LOCALE')?.value ?? 'fr';
  const validLang = lang === 'mg' ? 'mg' : 'fr';

  return (
    <html lang={validLang} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Pas de preconnect vers des CDN externes — frugalité réseau */}
      </head>
      <body className="min-h-screen flex flex-col bg-gray-50">
        {children}
      </body>
    </html>
  );
}
