/**
 * VH-11 — Catalogue initial de villes Madagascar
 *
 * 109 villes couvrant les 22 régions administratives.
 * Les districts à suffixe romain (I/II) sont fusionnés en une seule entrée
 * (ex. Antsirabe I + II → "Antsirabe").
 *
 * Idempotent : upsert sur le code unique. Peut être relancé sans effet.
 * Les coopératives peuvent ajouter des villes manquantes ; elles deviennent
 * disponibles pour tout le monde immédiatement (VH-11).
 *
 * Lancer : npm run prisma:seed
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CityData {
  code: string;
  nameFr: string;
  nameMg: string;
  district: string;
  region: string;
  lat?: number;
  lng?: number;
}

const CITIES: CityData[] = [
  // ── ANALAMANGA (7) ──────────────────────────────────────────────────────────
  { code: 'ANT-01', nameFr: 'Antananarivo',              nameMg: 'Antananarivo',           district: 'Antananarivo Renivohitra', region: 'Analamanga',          lat: -18.9137, lng: 47.5361 },
  { code: 'ANT-02', nameFr: 'Antananarivo Avaradrano',   nameMg: 'Antananarivo Avaradrano',district: 'Antananarivo Avaradrano', region: 'Analamanga',          lat: -18.8570, lng: 47.5310 },
  { code: 'ANT-03', nameFr: 'Antananarivo Atsimondrano', nameMg: 'Antananarivo Atsimondrano', district: 'Antananarivo Atsimondrano', region: 'Analamanga',    lat: -18.9720, lng: 47.4790 },
  { code: 'ANT-04', nameFr: 'Ambohidratrimo',            nameMg: 'Ambohidratrimo',         district: 'Ambohidratrimo',          region: 'Analamanga',          lat: -18.7689, lng: 47.4334 },
  { code: 'ANT-05', nameFr: 'Ankazobe',                  nameMg: 'Ankazobe',               district: 'Ankazobe',                region: 'Analamanga',          lat: -18.3030, lng: 47.1170 },
  { code: 'ANT-06', nameFr: 'Anjozorobe',                nameMg: 'Anjozorobe',             district: 'Anjozorobe',              region: 'Analamanga',          lat: -18.4013, lng: 47.8740 },
  { code: 'ANT-07', nameFr: 'Andramasina',               nameMg: 'Andramasina',            district: 'Andramasina',             region: 'Analamanga',          lat: -19.0220, lng: 47.6250 },

  // ── VAKINANKARATRA (6) — Antsirabe I+II fusionnés ────────────────────────────
  { code: 'VAK-01', nameFr: 'Antsirabe',                 nameMg: 'Antsirabe',              district: 'Antsirabe',               region: 'Vakinankaratra',       lat: -19.8655, lng: 47.0330 },
  { code: 'VAK-02', nameFr: 'Ambatolampy',               nameMg: 'Ambatolampy',            district: 'Ambatolampy',             region: 'Vakinankaratra',       lat: -19.3744, lng: 47.4218 },
  { code: 'VAK-03', nameFr: 'Antanifotsy',               nameMg: 'Antanifotsy',            district: 'Antanifotsy',             region: 'Vakinankaratra',       lat: -19.6530, lng: 47.3200 },
  { code: 'VAK-04', nameFr: 'Betafo',                    nameMg: 'Betafo',                 district: 'Betafo',                  region: 'Vakinankaratra',       lat: -19.8330, lng: 46.8400 },
  { code: 'VAK-05', nameFr: 'Faratsiho',                 nameMg: 'Faratsiho',              district: 'Faratsiho',               region: 'Vakinankaratra',       lat: -19.4700, lng: 46.9500 },
  { code: 'VAK-06', nameFr: 'Mandoto',                   nameMg: 'Mandoto',                district: 'Mandoto',                 region: 'Vakinankaratra',       lat: -20.1800, lng: 46.1700 },

  // ── ITASY (3) ────────────────────────────────────────────────────────────────
  { code: 'ITA-01', nameFr: 'Miarinarivo',               nameMg: 'Miarinarivo',            district: 'Miarinarivo',             region: 'Itasy',               lat: -18.9980, lng: 46.9170 },
  { code: 'ITA-02', nameFr: 'Arivonimamo',               nameMg: 'Arivonimamo',            district: 'Arivonimamo',             region: 'Itasy',               lat: -19.0180, lng: 47.1830 },
  { code: 'ITA-03', nameFr: 'Soavinandriana',            nameMg: 'Soavinandriana',         district: 'Soavinandriana',          region: 'Itasy',               lat: -19.1820, lng: 46.7220 },

  // ── BONGOLAVA (2) ────────────────────────────────────────────────────────────
  { code: 'BON-01', nameFr: 'Tsiroanomandidy',           nameMg: 'Tsiroanomandidy',        district: 'Tsiroanomandidy',         region: 'Bongolava',           lat: -18.7700, lng: 46.0530 },
  { code: 'BON-02', nameFr: 'Fenoarivobe',               nameMg: 'Fenoarivobe',            district: 'Fenoarivobe',             region: 'Bongolava',           lat: -18.9500, lng: 46.5200 },

  // ── HAUTE MATSIATRA (6) — Fianarantsoa I+II fusionnés ───────────────────────
  { code: 'HMA-01', nameFr: 'Fianarantsoa',              nameMg: 'Fianarantsoa',           district: 'Fianarantsoa',            region: 'Haute Matsiatra',     lat: -21.4530, lng: 47.0850 },
  { code: 'HMA-02', nameFr: 'Ambalavao',                 nameMg: 'Ambalavao',              district: 'Ambalavao',               region: 'Haute Matsiatra',     lat: -21.8330, lng: 46.9330 },
  { code: 'HMA-03', nameFr: 'Ambohimahasoa',             nameMg: 'Ambohimahasoa',          district: 'Ambohimahasoa',           region: 'Haute Matsiatra',     lat: -20.8830, lng: 47.2170 },
  { code: 'HMA-04', nameFr: 'Ikalamavony',               nameMg: 'Ikalamavony',            district: 'Ikalamavony',             region: 'Haute Matsiatra',     lat: -21.6730, lng: 46.5330 },
  { code: 'HMA-05', nameFr: 'Lalangina',                 nameMg: 'Lalangina',              district: 'Lalangina',               region: 'Haute Matsiatra',     lat: -21.4830, lng: 47.1200 },
  { code: 'HMA-06', nameFr: 'Vohibato',                  nameMg: 'Vohibato',               district: 'Vohibato',                region: 'Haute Matsiatra',     lat: -21.5200, lng: 47.0500 },

  // ── AMORON'I MANIA (4) ───────────────────────────────────────────────────────
  { code: 'AMO-01', nameFr: 'Ambositra',                 nameMg: 'Ambositra',              district: 'Ambositra',               region: "Amoron'i Mania",      lat: -20.5280, lng: 47.2460 },
  { code: 'AMO-02', nameFr: 'Ambatofinandrahana',        nameMg: 'Ambatofinandrahana',     district: 'Ambatofinandrahana',      region: "Amoron'i Mania",      lat: -20.5530, lng: 46.8000 },
  { code: 'AMO-03', nameFr: 'Fandriana',                 nameMg: 'Fandriana',              district: 'Fandriana',               region: "Amoron'i Mania",      lat: -20.2330, lng: 47.3700 },
  { code: 'AMO-04', nameFr: 'Manandriana',               nameMg: 'Manandriana',            district: 'Manandriana',             region: "Amoron'i Mania",      lat: -20.6000, lng: 47.5030 },

  // ── VATOVAVY-FITOVINANY (6) ──────────────────────────────────────────────────
  { code: 'VAT-01', nameFr: 'Manakara',                  nameMg: 'Manakara',               district: 'Manakara',                region: 'Vatovavy-Fitovinany', lat: -22.1450, lng: 48.0170 },
  { code: 'VAT-02', nameFr: 'Mananjary',                 nameMg: 'Mananjary',              district: 'Mananjary',               region: 'Vatovavy-Fitovinany', lat: -21.2220, lng: 48.3430 },
  { code: 'VAT-03', nameFr: 'Ifanadiana',                nameMg: 'Ifanadiana',             district: 'Ifanadiana',              region: 'Vatovavy-Fitovinany', lat: -21.3000, lng: 47.6500 },
  { code: 'VAT-04', nameFr: 'Ikongo',                    nameMg: 'Ikongo',                 district: 'Ikongo',                  region: 'Vatovavy-Fitovinany', lat: -21.8830, lng: 47.4500 },
  { code: 'VAT-05', nameFr: 'Nosy Varika',               nameMg: 'Nosy Varika',            district: 'Nosy Varika',             region: 'Vatovavy-Fitovinany', lat: -20.5830, lng: 48.5330 },
  { code: 'VAT-06', nameFr: 'Vohipeno',                  nameMg: 'Vohipeno',               district: 'Vohipeno',                region: 'Vatovavy-Fitovinany', lat: -22.3700, lng: 47.8500 },

  // ── IHOROMBE (3) ─────────────────────────────────────────────────────────────
  { code: 'IHO-01', nameFr: 'Ihosy',                     nameMg: 'Ihosy',                  district: 'Ihosy',                   region: 'Ihorombe',            lat: -22.4030, lng: 46.1250 },
  { code: 'IHO-02', nameFr: 'Ivohibe',                   nameMg: 'Ivohibe',                district: 'Ivohibe',                 region: 'Ihorombe',            lat: -22.5000, lng: 46.9500 },
  { code: 'IHO-03', nameFr: 'Ranohira',                  nameMg: 'Ranohira',               district: 'Ranohira',                region: 'Ihorombe',            lat: -22.5480, lng: 45.3980 },

  // ── ATSIMO-ATSINANANA (6) ────────────────────────────────────────────────────
  { code: 'ATA-01', nameFr: 'Farafangana',               nameMg: 'Farafangana',            district: 'Farafangana',             region: 'Atsimo-Atsinanana',   lat: -22.8180, lng: 47.8330 },
  { code: 'ATA-02', nameFr: 'Vangaindrano',              nameMg: 'Vangaindrano',           district: 'Vangaindrano',            region: 'Atsimo-Atsinanana',   lat: -23.3500, lng: 47.5960 },
  { code: 'ATA-03', nameFr: 'Vondrozo',                  nameMg: 'Vondrozo',               district: 'Vondrozo',                region: 'Atsimo-Atsinanana',   lat: -22.8170, lng: 47.2830 },
  { code: 'ATA-04', nameFr: 'Befotaka',                  nameMg: 'Befotaka',               district: 'Befotaka',                region: 'Atsimo-Atsinanana',   lat: -23.1170, lng: 47.4330 },
  { code: 'ATA-05', nameFr: 'Midongy du Sud',            nameMg: 'Midongy Atsimo',         district: 'Midongy du Sud',          region: 'Atsimo-Atsinanana',   lat: -23.5830, lng: 47.0500 },
  { code: 'ATA-06', nameFr: 'Iakora',                    nameMg: 'Iakora',                 district: 'Iakora',                  region: 'Atsimo-Atsinanana',   lat: -22.8500, lng: 46.5500 },

  // ── ATSINANANA (6) — Toamasina I+II fusionnés ───────────────────────────────
  { code: 'ATI-01', nameFr: 'Toamasina',                 nameMg: 'Toamasina',              district: 'Toamasina',               region: 'Atsinanana',          lat: -18.1443, lng: 49.4025 },
  { code: 'ATI-02', nameFr: 'Brickaville',               nameMg: 'Brickaville',            district: 'Brickaville',             region: 'Atsinanana',          lat: -18.8230, lng: 49.0670 },
  { code: 'ATI-03', nameFr: 'Mahanoro',                  nameMg: 'Mahanoro',               district: 'Mahanoro',                region: 'Atsinanana',          lat: -19.9000, lng: 48.8000 },
  { code: 'ATI-04', nameFr: 'Marolambo',                 nameMg: 'Marolambo',              district: 'Marolambo',               region: 'Atsinanana',          lat: -20.0700, lng: 48.1330 },
  { code: 'ATI-05', nameFr: 'Vatomandry',                nameMg: 'Vatomandry',             district: 'Vatomandry',              region: 'Atsinanana',          lat: -19.3330, lng: 48.9830 },
  { code: 'ATI-06', nameFr: 'Antanambao Manampotsy',     nameMg: 'Antanambao Manampotsy',  district: 'Antanambao Manampotsy',   region: 'Atsinanana',          lat: -18.9500, lng: 48.6700 },

  // ── ANALANJIROFO (6) ─────────────────────────────────────────────────────────
  { code: 'ANL-01', nameFr: 'Fenoarivo Atsinanana',      nameMg: 'Fenoarivo Atsinanana',   district: 'Fenoarivo Atsinanana',    region: 'Analanjirofo',        lat: -17.3800, lng: 49.4170 },
  { code: 'ANL-02', nameFr: 'Mananara Avaratra',         nameMg: 'Mananara Avaratra',      district: 'Mananara Avaratra',       region: 'Analanjirofo',        lat: -16.1700, lng: 49.7700 },
  { code: 'ANL-03', nameFr: 'Maroantsetra',              nameMg: 'Maroantsetra',           district: 'Maroantsetra',            region: 'Analanjirofo',        lat: -15.4330, lng: 49.7500 },
  { code: 'ANL-04', nameFr: 'Soanierana Ivongo',         nameMg: 'Soanierana Ivongo',      district: 'Soanierana Ivongo',       region: 'Analanjirofo',        lat: -16.9170, lng: 49.5830 },
  { code: 'ANL-05', nameFr: 'Sainte Marie',              nameMg: 'Nosy Boraha',            district: 'Nosy Boraha',             region: 'Analanjirofo',        lat: -17.0000, lng: 49.8700 },
  { code: 'ANL-06', nameFr: 'Vavatenina',                nameMg: 'Vavatenina',             district: 'Vavatenina',              region: 'Analanjirofo',        lat: -17.4700, lng: 49.1830 },

  // ── ALAOTRA-MANGORO (5) ──────────────────────────────────────────────────────
  { code: 'ALA-01', nameFr: 'Ambatondrazaka',            nameMg: 'Ambatondrazaka',         district: 'Ambatondrazaka',          region: 'Alaotra-Mangoro',     lat: -17.8330, lng: 48.4330 },
  { code: 'ALA-02', nameFr: 'Amparafaravola',            nameMg: 'Amparafaravola',         district: 'Amparafaravola',          region: 'Alaotra-Mangoro',     lat: -17.6200, lng: 48.2200 },
  { code: 'ALA-03', nameFr: 'Andilamena',                nameMg: 'Andilamena',             district: 'Andilamena',              region: 'Alaotra-Mangoro',     lat: -17.0200, lng: 48.4200 },
  { code: 'ALA-04', nameFr: "Anosibe An'Ala",            nameMg: "Anosibe An'ala",         district: "Anosibe An'Ala",          region: 'Alaotra-Mangoro',     lat: -19.4500, lng: 48.0800 },
  { code: 'ALA-05', nameFr: 'Moramanga',                 nameMg: 'Moramanga',              district: 'Moramanga',               region: 'Alaotra-Mangoro',     lat: -18.9330, lng: 48.2170 },

  // ── BOENY (5) — Mahajanga I+II fusionnés ─────────────────────────────────────
  { code: 'BOE-01', nameFr: 'Mahajanga',                 nameMg: 'Mahajanga',              district: 'Mahajanga',               region: 'Boeny',               lat: -15.7170, lng: 46.3170 },
  { code: 'BOE-02', nameFr: 'Ambato Boeny',              nameMg: 'Ambato Boeny',           district: 'Ambato Boeny',            region: 'Boeny',               lat: -16.4670, lng: 46.7170 },
  { code: 'BOE-03', nameFr: 'Marovoay',                  nameMg: 'Marovoay',               district: 'Marovoay',                region: 'Boeny',               lat: -16.1000, lng: 46.6330 },
  { code: 'BOE-04', nameFr: 'Mitsinjo',                  nameMg: 'Mitsinjo',               district: 'Mitsinjo',                region: 'Boeny',               lat: -15.9830, lng: 45.8670 },
  { code: 'BOE-05', nameFr: 'Soalala',                   nameMg: 'Soalala',                district: 'Soalala',                 region: 'Boeny',               lat: -16.1000, lng: 45.3170 },

  // ── SOFIA (6) ────────────────────────────────────────────────────────────────
  { code: 'SOF-01', nameFr: 'Antsohihy',                 nameMg: 'Antsohihy',              district: 'Antsohihy',               region: 'Sofia',               lat: -14.8830, lng: 47.9900 },
  { code: 'SOF-02', nameFr: 'Analalava',                 nameMg: 'Analalava',              district: 'Analalava',               region: 'Sofia',               lat: -14.6200, lng: 47.7700 },
  { code: 'SOF-03', nameFr: 'Befandriana Avaratra',      nameMg: 'Befandriana Avaratra',   district: 'Befandriana Avaratra',    region: 'Sofia',               lat: -15.2330, lng: 48.4830 },
  { code: 'SOF-04', nameFr: 'Boriziny',                  nameMg: 'Boriziny',               district: 'Boriziny',                region: 'Sofia',               lat: -15.5830, lng: 47.6330 },
  { code: 'SOF-05', nameFr: 'Mampikony',                 nameMg: 'Mampikony',              district: 'Mampikony',               region: 'Sofia',               lat: -16.0700, lng: 47.6300 },
  { code: 'SOF-06', nameFr: 'Mandritsara',               nameMg: 'Mandritsara',            district: 'Mandritsara',             region: 'Sofia',               lat: -15.8330, lng: 48.8330 },

  // ── BETSIBOKA (3) ────────────────────────────────────────────────────────────
  { code: 'BET-01', nameFr: 'Maevatanana',               nameMg: 'Maevatanana',            district: 'Maevatanana',             region: 'Betsiboka',           lat: -16.9330, lng: 46.8670 },
  { code: 'BET-02', nameFr: 'Kandreho',                  nameMg: 'Kandreho',               district: 'Kandreho',                region: 'Betsiboka',           lat: -17.7500, lng: 46.5000 },
  { code: 'BET-03', nameFr: 'Tsaratanana',               nameMg: 'Tsaratanana',            district: 'Tsaratanana',             region: 'Betsiboka',           lat: -16.4000, lng: 47.6500 },

  // ── MELAKY (5) ───────────────────────────────────────────────────────────────
  { code: 'MEL-01', nameFr: 'Maintirano',                nameMg: 'Maintirano',             district: 'Maintirano',              region: 'Melaky',              lat: -18.0500, lng: 44.0300 },
  { code: 'MEL-02', nameFr: 'Ambatomainty',              nameMg: 'Ambatomainty',           district: 'Ambatomainty',            region: 'Melaky',              lat: -17.6800, lng: 45.6800 },
  { code: 'MEL-03', nameFr: 'Antsalova',                 nameMg: 'Antsalova',              district: 'Antsalova',               region: 'Melaky',              lat: -18.6800, lng: 44.6200 },
  { code: 'MEL-04', nameFr: 'Besalampy',                 nameMg: 'Besalampy',              district: 'Besalampy',               region: 'Melaky',              lat: -16.7330, lng: 44.4800 },
  { code: 'MEL-05', nameFr: 'Morafenobe',                nameMg: 'Morafenobe',             district: 'Morafenobe',              region: 'Melaky',              lat: -17.8500, lng: 44.9200 },

  // ── ATSIMO-ANDREFANA (8) — Toliara I+II fusionnés ───────────────────────────
  { code: 'ASA-01', nameFr: 'Toliara',                   nameMg: 'Toliara',                district: 'Toliara',                 region: 'Atsimo-Andrefana',    lat: -23.3500, lng: 43.6667 },
  { code: 'ASA-02', nameFr: 'Ampanihy',                  nameMg: 'Ampanihy',               district: 'Ampanihy',                region: 'Atsimo-Andrefana',    lat: -24.7000, lng: 44.7500 },
  { code: 'ASA-03', nameFr: 'Ankazoabo',                 nameMg: 'Ankazoabo',              district: 'Ankazoabo',               region: 'Atsimo-Andrefana',    lat: -22.3000, lng: 44.5200 },
  { code: 'ASA-04', nameFr: 'Benenitra',                 nameMg: 'Benenitra',              district: 'Benenitra',               region: 'Atsimo-Andrefana',    lat: -23.4500, lng: 44.9800 },
  { code: 'ASA-05', nameFr: 'Beroroha',                  nameMg: 'Beroroha',               district: 'Beroroha',                region: 'Atsimo-Andrefana',    lat: -21.6700, lng: 45.1700 },
  { code: 'ASA-06', nameFr: 'Betioky',                   nameMg: 'Betioky',                district: 'Betioky',                 region: 'Atsimo-Andrefana',    lat: -23.7200, lng: 44.3800 },
  { code: 'ASA-07', nameFr: 'Morombe',                   nameMg: 'Morombe',                district: 'Morombe',                 region: 'Atsimo-Andrefana',    lat: -21.7330, lng: 43.3700 },
  { code: 'ASA-08', nameFr: 'Sakaraha',                  nameMg: 'Sakaraha',               district: 'Sakaraha',                region: 'Atsimo-Andrefana',    lat: -22.9000, lng: 44.5300 },

  // ── ANDROY (4) ───────────────────────────────────────────────────────────────
  { code: 'ADR-01', nameFr: 'Ambovombe',                 nameMg: 'Ambovombe',              district: 'Ambovombe',               region: 'Androy',              lat: -25.1700, lng: 46.0830 },
  { code: 'ADR-02', nameFr: 'Bekily',                    nameMg: 'Bekily',                 district: 'Bekily',                  region: 'Androy',              lat: -24.2200, lng: 45.3200 },
  { code: 'ADR-03', nameFr: 'Beloha',                    nameMg: 'Beloha',                 district: 'Beloha',                  region: 'Androy',              lat: -25.1700, lng: 45.0500 },
  { code: 'ADR-04', nameFr: 'Tsihombe',                  nameMg: 'Tsihombe',               district: 'Tsihombe',                region: 'Androy',              lat: -25.3300, lng: 45.4800 },

  // ── ANOSY (3) ────────────────────────────────────────────────────────────────
  { code: 'ANO-01', nameFr: 'Fort-Dauphin',              nameMg: 'Tolanaro',               district: 'Tôlanaro',                region: 'Anosy',               lat: -25.0330, lng: 46.9830 },
  { code: 'ANO-02', nameFr: 'Amboasary Atsimo',          nameMg: 'Amboasary Atsimo',       district: 'Amboasary Atsimo',        region: 'Anosy',               lat: -24.9700, lng: 46.4500 },
  { code: 'ANO-03', nameFr: 'Betroka',                   nameMg: 'Betroka',                district: 'Betroka',                 region: 'Anosy',               lat: -23.2700, lng: 46.1000 },

  // ── MENABE (6) ───────────────────────────────────────────────────────────────
  { code: 'MEN-01', nameFr: 'Morondava',                 nameMg: 'Morondava',              district: 'Morondava',               region: 'Menabe',              lat: -20.3000, lng: 44.2830 },
  { code: 'MEN-02', nameFr: 'Belo sur Tsiribihina',      nameMg: 'Belo-Tsiribihina',       district: 'Belo sur Tsiribihina',    region: 'Menabe',              lat: -19.6800, lng: 44.5300 },
  { code: 'MEN-03', nameFr: 'Mahabo',                    nameMg: 'Mahabo',                 district: 'Mahabo',                  region: 'Menabe',              lat: -20.3800, lng: 44.6800 },
  { code: 'MEN-04', nameFr: 'Manja',                     nameMg: 'Manja',                  district: 'Manja',                   region: 'Menabe',              lat: -21.4200, lng: 44.8700 },
  { code: 'MEN-05', nameFr: 'Miandrivazo',               nameMg: 'Miandrivazo',            district: 'Miandrivazo',             region: 'Menabe',              lat: -19.5200, lng: 45.4500 },
  { code: 'MEN-06', nameFr: 'Ankavandra',                nameMg: 'Ankavandra',             district: 'Ankavandra',              region: 'Menabe',              lat: -18.7800, lng: 45.2800 },

  // ── DIANA (5) — Antsiranana I+II fusionnés ───────────────────────────────────
  { code: 'DIA-01', nameFr: 'Antsiranana',               nameMg: 'Antsiranana',            district: 'Antsiranana',             region: 'Diana',               lat: -12.3500, lng: 49.3000 },
  { code: 'DIA-02', nameFr: 'Ambanja',                   nameMg: 'Ambanja',                district: 'Ambanja',                 region: 'Diana',               lat: -13.6830, lng: 48.4500 },
  { code: 'DIA-03', nameFr: 'Ambilobe',                  nameMg: 'Ambilobe',               district: 'Ambilobe',                region: 'Diana',               lat: -13.1830, lng: 49.0500 },
  { code: 'DIA-04', nameFr: 'Nosy Be',                   nameMg: 'Nosy Be',                district: 'Nosy Be',                 region: 'Diana',               lat: -13.3330, lng: 48.2700 },
  { code: 'DIA-05', nameFr: 'Anivorano Avaratra',        nameMg: 'Anivorano Avaratra',     district: 'Anivorano Avaratra',      region: 'Diana',               lat: -12.8500, lng: 49.2500 },

  // ── SAVA (4) ─────────────────────────────────────────────────────────────────
  { code: 'SAV-01', nameFr: 'Sambava',                   nameMg: 'Sambava',                district: 'Sambava',                 region: 'Sava',                lat: -14.2700, lng: 50.1700 },
  { code: 'SAV-02', nameFr: 'Andapa',                    nameMg: 'Andapa',                 district: 'Andapa',                  region: 'Sava',                lat: -14.6500, lng: 49.6500 },
  { code: 'SAV-03', nameFr: 'Antalaha',                  nameMg: 'Antalaha',               district: 'Antalaha',                region: 'Sava',                lat: -14.8830, lng: 50.2700 },
  { code: 'SAV-04', nameFr: 'Vohemar',                   nameMg: 'Vohemar',                district: 'Vohemar',                 region: 'Sava',                lat: -13.3500, lng: 50.0000 },
];

async function main(): Promise<void> {
  process.stdout.write(`[seed-cities] Insertion de ${CITIES.length} villes…\n`);

  let created = 0;
  let updated = 0;

  for (const city of CITIES) {
    const result = await prisma.city.upsert({
      where: { code: city.code },
      update: {
        nameFr:   city.nameFr,
        nameMg:   city.nameMg,
        district: city.district,
        region:   city.region,
        lat:      city.lat ?? null,
        lng:      city.lng ?? null,
        isActive: true,
      },
      create: {
        code:     city.code,
        nameFr:   city.nameFr,
        nameMg:   city.nameMg,
        district: city.district,
        region:   city.region,
        lat:      city.lat ?? null,
        lng:      city.lng ?? null,
        isActive: true,
      },
    });

    // Prisma upsert ne distingue pas create vs update — on compare createdAt ≈ updatedAt
    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created++;
    } else {
      updated++;
    }
  }

  process.stdout.write(
    `[seed-cities] Terminé : ${created} créée(s), ${updated} mise(s) à jour.\n`,
  );
}

main()
  .catch((e) => {
    process.stderr.write(`[seed-cities] Erreur : ${String(e)}\n`);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
