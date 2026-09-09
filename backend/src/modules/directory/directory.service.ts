import { PrismaClient } from '@prisma/client';

// =====================================================================
// directory.service.ts — Annuaire public des coopératives
//
// Endpoints publics (pas d'auth) :
//   GET /v1/directory/cooperatives          → liste paginée
//   GET /v1/directory/cooperatives/:slug    → fiche détail
//
// Source de vérité : docs/contrat-api.yaml §Directory
// =====================================================================

export interface DirectoryEntryDto {
  slug: string;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  regionsServed: string[];
  ratingAverage: number;
  ratingCount: number;
}

export interface CityRef {
  id: string;
  code: string;
  name: string;
  district: string;
  region: string;
}

export interface DirectoryRouteDto {
  displayName: string;
  originCity: CityRef;
  destinationCity: CityRef;
}

export interface CoopPolicyDto {
  id: string;
  titleFr: string;
  titleMg: string;
  bodyFr: string;
  bodyMg: string;
  version: number;
  isActive: boolean;
}

export interface DirectoryEntryDetailDto extends DirectoryEntryDto {
  routes: DirectoryRouteDto[];
  policy: CoopPolicyDto | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface DirectoryListResult {
  items: DirectoryEntryDto[];
  nextCursor: string | null;
}

export interface ListDirectoryQuery {
  q?: string;
  region?: string;
  cursor?: string;
  limit?: number;
}

function toEntryDto(
  entry: {
    slug: string;
    displayName: string;
    descriptionFr: string | null;
    descriptionMg: string | null;
    logoUrl: string | null;
    regionsServed: string[];
    ratingAverage: number;
    ratingCount: number;
  },
  lang: string,
): DirectoryEntryDto {
  return {
    slug: entry.slug,
    displayName: entry.displayName,
    description: (lang === 'mg' ? entry.descriptionMg : entry.descriptionFr) ?? null,
    logoUrl: entry.logoUrl,
    regionsServed: entry.regionsServed,
    ratingAverage: entry.ratingAverage,
    ratingCount: entry.ratingCount,
  };
}

function toCityRef(city: { id: string; code: string; nameFr: string; nameMg: string; district: string; region: string }, lang: string): CityRef {
  return {
    id: city.id,
    code: city.code,
    name: lang === 'mg' ? city.nameMg : city.nameFr,
    district: city.district,
    region: city.region,
  };
}

export class DirectoryService {
  constructor(private readonly db: PrismaClient) {}

  async listCooperatives(query: ListDirectoryQuery, lang: string): Promise<DirectoryListResult> {
    const limit = Math.min(query.limit ?? 20, 100);
    const cursor = query.cursor;

    const where: Record<string, unknown> = {
      cooperative: { status: 'VALIDATED' },
    };

    if (query.q) {
      where['displayName'] = { contains: query.q, mode: 'insensitive' };
    }

    if (query.region) {
      where['regionsServed'] = { has: query.region };
    }

    if (cursor) {
      where['id'] = { gt: cursor };
    }

    const entries = await this.db.directoryEntry.findMany({
      where,
      take: limit + 1,
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        slug: true,
        displayName: true,
        descriptionFr: true,
        descriptionMg: true,
        logoUrl: true,
        regionsServed: true,
        ratingAverage: true,
        ratingCount: true,
      },
    });

    const hasMore = entries.length > limit;
    const items = hasMore ? entries.slice(0, limit) : entries;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items: items.map((e) => toEntryDto(e, lang)),
      nextCursor,
    };
  }

  async getCooperativeBySlug(slug: string, lang: string): Promise<DirectoryEntryDetailDto | null> {
    const entry = await this.db.directoryEntry.findUnique({
      where: { slug },
      include: {
        cooperative: {
          select: {
            status: true,
            contactEmail: true,
            contactPhone: true,
            routes: {
              where: { isActive: true },
              select: {
                displayName: true,
                origin: { select: { id: true, code: true, nameFr: true, nameMg: true, district: true, region: true } },
                destination: { select: { id: true, code: true, nameFr: true, nameMg: true, district: true, region: true } },
              },
              take: 50,
            },
            policies: {
              where: { isActive: true },
              orderBy: { version: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!entry || entry.cooperative.status !== 'VALIDATED') return null;

    const coop = entry.cooperative;
    const policy = coop.policies[0] ?? null;

    return {
      ...toEntryDto(entry, lang),
      contactEmail: coop.contactEmail ?? null,
      contactPhone: coop.contactPhone ?? null,
      routes: coop.routes.map((r) => ({
        displayName: r.displayName,
        originCity: toCityRef(r.origin, lang),
        destinationCity: toCityRef(r.destination, lang),
      })),
      policy: policy
        ? {
            id: policy.id,
            titleFr: policy.titleFr,
            titleMg: policy.titleMg,
            bodyFr: policy.bodyFr,
            bodyMg: policy.bodyMg,
            version: policy.version,
            isActive: policy.isActive,
          }
        : null,
    };
  }
}
