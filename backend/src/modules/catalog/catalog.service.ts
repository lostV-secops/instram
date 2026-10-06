import { PrismaClient, City } from '@prisma/client';
import { ListCitiesQuery, CreateCity } from './catalog.schema';

// =====================================================================
// Types de réponse
// =====================================================================

export interface CityDto {
  id: string;
  code: string;
  /** Nom localisé selon la langue demandée */
  name: string;
  district: string;
  region: string;
}

export interface CityListResponse {
  items: CityDto[];
  nextCursor: string | null;
}

// =====================================================================
// Helpers
// =====================================================================

function toDto(city: City, lang: string): CityDto {
  return {
    id: city.id,
    code: city.code,
    name: lang === 'mg' ? city.nameMg : city.nameFr,
    district: city.district,
    region: city.region,
  };
}

// =====================================================================
// Service
// =====================================================================

export class CatalogService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Liste paginée des villes actives.
   * Recherche par nom FR ou MG via pg_trgm (icontains sur les deux champs).
   * Pagination par curseur (ID de la dernière ville vue).
   *
   * Hypothèse : le curseur est l'ID (UUID) de la dernière ville de la page précédente.
   */
  async listCities(query: ListCitiesQuery, lang: string): Promise<CityListResponse> {
    const { q, region, cursor, limit } = query;

    const where = {
      isActive: true,
      ...(region ? { region } : {}),
      ...(q
        ? {
            OR: [
              { nameFr: { contains: q, mode: 'insensitive' as const } },
              { nameMg: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(cursor ? { id: { gt: cursor } } : {}),
    };

    const cities = await this.db.city.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit + 1, // prendre un de plus pour savoir s'il y a une page suivante
    });

    const hasNextPage = cities.length > limit;
    const items = hasNextPage ? cities.slice(0, limit) : cities;
    const nextCursor = hasNextPage ? items[items.length - 1].id : null;

    return {
      items: items.map((c) => toDto(c, lang)),
      nextCursor,
    };
  }

  /**
   * Détail d'une ville par ID.
   */
  async getCityById(id: string, lang: string): Promise<CityDto | null> {
    const city = await this.db.city.findUnique({ where: { id } });
    if (!city || !city.isActive) return null;
    return toDto(city, lang);
  }

  /**
   * Crée une nouvelle ville (soumise par une coopérative pour les communes manquantes).
   * Le code est auto-généré si non fourni.
   */
  async createCity(input: CreateCity, lang: string): Promise<CityDto> {
    const code = input.code ?? `USR-${Date.now()}`;
    const city = await this.db.city.create({
      data: {
        code,
        nameFr: input.nameFr,
        nameMg: input.nameMg,
        district: input.district,
        region: input.region,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        isActive: true,
      },
    });
    return toDto(city, lang);
  }
}
