/**
 * Page d'accueil voyageur — /fr et /mg
 *
 * SSR : charge la liste des villes depuis GET /v1/catalog/cities.
 * Affiche le formulaire de recherche (Client Component).
 *
 * Contraintes :
 * - Pas de hero image lourde, pas de carrousel (frugalité 3G).
 * - Titre H1 bilingue.
 * - Formulaire pré-chargé avec les villes pour éviter un second aller-retour.
 */

import type { Metadata } from 'next';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { apiGet } from '@/lib/api';
import { SearchForm } from '@/components/search/SearchForm';
import type { CityList } from '@/lib/types';

interface PageProps {
  params: { lang: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);
  return {
    title: t.home.title,
    description: t.home.subtitle,
  };
}

export default async function HomePage({ params }: PageProps) {
  const { lang } = params;
  if (!isValidLang(lang)) return null;

  const t = getTranslations(lang);

  // Chargement SSR des villes — cached via HTTP Cache-Control du backend (1h)
  let cities: CityList['items'] = [];
  try {
    const data = await apiGet<CityList>('/catalog/cities?limit=500', {
      acceptLang: lang,
      cache: 'no-store',
    });
    cities = data.items ?? [];
  } catch {
    // Si l'API n'est pas disponible, le formulaire sera vide mais fonctionnel
    cities = [];
  }

  return (
    <div className="max-w-xl mx-auto py-4">
      {/* Titre H1 bilingue — pas d'image, pas de carrousel */}
      <div className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-brand-dark mb-2">
          {t.home.title}
        </h1>
        <p className="text-gray-600 text-sm sm:text-base">{t.home.subtitle}</p>
      </div>

      {/* Logo textuel InsTRAM — zone officielle bleu foncé */}
      <div className="flex justify-center mb-6">
        <div className="bg-brand-dark rounded-xl px-6 py-3 text-white">
          <span className="text-2xl font-bold tracking-widest">InsTRAM</span>
          <span className="block text-xs text-white/60 text-center mt-0.5">
            Madagascar
          </span>
        </div>
      </div>

      {/* Formulaire de recherche */}
      <SearchForm cities={cities} />
    </div>
  );
}
