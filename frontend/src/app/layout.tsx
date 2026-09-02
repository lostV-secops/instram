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
        {/*
          Viewport : maximum-scale=1 bloque le zoom involontaire sur mobile
          (particulièrement utile dans l'app conducteur utilisée debout dans un bus).
          user-scalable=no est évité pour l'accessibilité sur les autres pages.
        */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* PWA — manifest et theme-color */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#205E98" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Conducteur" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        {/* Pas de preconnect vers des CDN externes — frugalité réseau */}
      </head>
      <body className="min-h-screen flex flex-col bg-gray-50">
        {children}
      </body>
    </html>
  );
}
