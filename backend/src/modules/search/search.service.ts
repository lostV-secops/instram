import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { SearchTripsQuery } from './search.schema';

// =====================================================================
// Types de réponse
// Alignés sur TripSearchResult / TripSearchResponse du contrat
// Cible : < 20 kB gzip pour 20 résultats (architecture §6.1)
// =====================================================================

export interface TripSearchResult {
  tripInstanceId: string;
  cooperative: {
    id: string;
    displayName: string;
    ratingAverage: number;
    ratingCount: number;
  };
  route: {
    originCity: { id: string; name: string };
    destinationCity: { id: string; name: string };
    estimatedDurationMin: number | null;
  };
  departureAt: string; // ISO string
  arrivalEstimatedAt: string | null;
  fareMinMga: number;
  fareMaxMga: number;
  seatsAvailable: number;
  vehicle: {
    model: string | null;
    capacity: number;
  };
}

export interface TripSearchResponse {
  items: TripSearchResult[];
  nextCursor: string | null;
}

// =====================================================================
// Service
// =====================================================================

/**
 * Durée du cache Redis pour les résultats de recherche : 60 secondes.
 * Architecture §6.1 : "Cache Redis 60 s sur la clé (origin, destination, date)".
 */
const CACHE_TTL_SECONDS = 60;

export class SearchService {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
  ) {}

  /**
   * Recherche des trajets disponibles.
   *
   * Hypothèses prises (points ambigus du contrat) :
   * - "seatsAvailable" = capacité du véhicule − nombre de BookingSeat actifs confirmés
   *   sur ce TripInstance. Les holds expirés ne comptent pas.
   * - Le cache Redis 60 s porte sur la clé (originCityId, destinationCityId, date, lang).
   *   Le curseur et limit ne font pas partie de la clé de cache car la pagination doit
   *   être cohérente avec les données cachées.
   * - Un trajet n'apparaît que si son statut est OPEN_FOR_BOOKING.
   * - fareMinMga / fareMaxMga sont calculés à partir des Fare associés au TripInstance.
   */
  async searchTrips(
    query: SearchTripsQuery,
    lang: string,
  ): Promise<TripSearchResponse> {
    const { originCityId, destinationCityId, date, passengers, cursor, limit } =
      query;

    // Clé de cache Redis : pas de cursor/limit pour avoir un cache partagé entre pages
    const cacheKey = `search:trips:${originCityId}:${destinationCityId}:${date}:${lang}`;

    // Tentative de lecture depuis le cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const allItems = JSON.parse(cached) as TripSearchResult[];
      return this._paginate(allItems, cursor, limit);
    }

    // Calcul de la plage horaire pour le jour demandé (toute la journée UTC)
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    // Requête Prisma avec projections légères
    const trips = await this.db.tripInstance.findMany({
      where: {
        status: 'OPEN_FOR_BOOKING',
        departureAt: {
          gte: dayStart,
          lte: dayEnd,
        },
        route: {
          originCityId,
          destinationCityId,
          isActive: true,
        },
      },
      select: {
        id: true,
        departureAt: true,
        arrivalEstimatedAt: true,
        cooperative: {
          select: {
            id: true,
            displayName: true,
            ratingAverage: true,
            ratingCount: true,
          },
        },
        route: {
          select: {
            estimatedDurationMin: true,
            origin: {
              select: { id: true, nameFr: true, nameMg: true },
            },
            destination: {
              select: { id: true, nameFr: true, nameMg: true },
            },
          },
        },
        vehicle: {
          select: {
            model: true,
            capacity: true,
          },
        },
        fares: {
          select: { priceMga: true },
        },
        // Nombre de sièges vendus (BookingSeat actifs)
        _count: {
          select: {
            bookingSeats: {
              where: { isActive: true },
            },
          },
        },
      },
      orderBy: { departureAt: 'asc' },
    });

    // Construction des résultats
    const results: TripSearchResult[] = trips.map((trip) => {
      const prices = trip.fares.map((f) => f.priceMga);
      const fareMinMga = prices.length > 0 ? Math.min(...prices) : 0;
      const fareMaxMga = prices.length > 0 ? Math.max(...prices) : 0;
      const soldSeats = trip._count.bookingSeats;
      const seatsAvailable = Math.max(0, trip.vehicle.capacity - soldSeats);

      return {
        tripInstanceId: trip.id,
        cooperative: {
          id: trip.cooperative.id,
          displayName: trip.cooperative.displayName,
          ratingAverage: trip.cooperative.ratingAverage,
          ratingCount: trip.cooperative.ratingCount,
        },
        route: {
          originCity: {
            id: trip.route.origin.id,
            name: lang === 'mg' ? trip.route.origin.nameMg : trip.route.origin.nameFr,
          },
          destinationCity: {
            id: trip.route.destination.id,
            name:
              lang === 'mg'
                ? trip.route.destination.nameMg
                : trip.route.destination.nameFr,
          },
          estimatedDurationMin: trip.route.estimatedDurationMin,
        },
        departureAt: trip.departureAt.toISOString(),
        arrivalEstimatedAt: trip.arrivalEstimatedAt?.toISOString() ?? null,
        fareMinMga,
        fareMaxMga,
        seatsAvailable,
        vehicle: {
          model: trip.vehicle.model,
          capacity: trip.vehicle.capacity,
        },
      };
    });

    // Filtrage des trajets avec assez de sièges disponibles
    const filtered = results.filter((r) => r.seatsAvailable >= passengers);

    // Mise en cache 60 secondes
    await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(filtered));

    return this._paginate(filtered, cursor, limit);
  }

  // ---------------------------------------------------------------------------
  // Pagination par curseur sur les résultats déjà en mémoire / cache
  // Le curseur est le tripInstanceId du dernier élément vu.
  // ---------------------------------------------------------------------------
  private _paginate(
    items: TripSearchResult[],
    cursor: string | undefined,
    limit: number,
  ): TripSearchResponse {
    let startIndex = 0;
    if (cursor) {
      const idx = items.findIndex((i) => i.tripInstanceId === cursor);
      startIndex = idx >= 0 ? idx + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + limit + 1);
    const hasNextPage = page.length > limit;
    const pageItems = hasNextPage ? page.slice(0, limit) : page;
    const nextCursor = hasNextPage
      ? pageItems[pageItems.length - 1].tripInstanceId
      : null;

    return { items: pageItems, nextCursor };
  }
}
