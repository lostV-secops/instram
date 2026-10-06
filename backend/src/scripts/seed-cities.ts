/**
 * VH-11 — Catalogue initial de villes Madagascar
 *
 * 23 chefs-lieux des régions malgaches (22 régions + scission Vatovavy/Fitovinany 2021).
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
  // ── ANALAMANGA ───────────────────────────────────────────────────────────────
  { code: 'ANT-01', nameFr: 'Antananarivo',        nameMg: 'Antananarivo',       district: 'Antananarivo Renivohitra', region: 'Analamanga',        lat: -18.9137, lng: 47.5361 },

  // ── VAKINANKARATRA ───────────────────────────────────────────────────────────
  { code: 'VAK-01', nameFr: 'Antsirabe',           nameMg: 'Antsirabe',          district: 'Antsirabe',               region: 'Vakinankaratra',    lat: -19.8655, lng: 47.0330 },

  // ── ITASY ────────────────────────────────────────────────────────────────────
  { code: 'ITA-01', nameFr: 'Miarinarivo',         nameMg: 'Miarinarivo',        district: 'Miarinarivo',             region: 'Itasy',             lat: -18.9980, lng: 46.9170 },

  // ── BONGOLAVA ────────────────────────────────────────────────────────────────
  { code: 'BON-01', nameFr: 'Tsiroanomandidy',     nameMg: 'Tsiroanomandidy',    district: 'Tsiroanomandidy',         region: 'Bongolava',         lat: -18.7700, lng: 46.0530 },

  // ── HAUTE MATSIATRA ──────────────────────────────────────────────────────────
  { code: 'HMA-01', nameFr: 'Fianarantsoa',        nameMg: 'Fianarantsoa',       district: 'Fianarantsoa',            region: 'Haute Matsiatra',   lat: -21.4530, lng: 47.0850 },

  // ── AMORON'I MANIA ───────────────────────────────────────────────────────────
  { code: 'AMO-01', nameFr: 'Ambositra',           nameMg: 'Ambositra',          district: 'Ambositra',               region: "Amoron'i Mania",   lat: -20.5280, lng: 47.2460 },

  // ── FITOVINANY (ex-Vatovavy-Fitovinany, scission 2021) ───────────────────────
  { code: 'VAT-01', nameFr: 'Manakara',            nameMg: 'Manakara',           district: 'Manakara',                region: 'Fitovinany',        lat: -22.1450, lng: 48.0170 },

  // ── VATOVAVY (ex-Vatovavy-Fitovinany, scission 2021) ────────────────────────
  { code: 'VAT-02', nameFr: 'Mananjary',           nameMg: 'Mananjary',          district: 'Mananjary',               region: 'Vatovavy',          lat: -21.2220, lng: 48.3430 },

  // ── IHOROMBE ─────────────────────────────────────────────────────────────────
  { code: 'IHO-01', nameFr: 'Ihosy',              nameMg: 'Ihosy',              district: 'Ihosy',                   region: 'Ihorombe',          lat: -22.4030, lng: 46.1250 },

  // ── ATSIMO-ATSINANANA ────────────────────────────────────────────────────────
  { code: 'ATA-01', nameFr: 'Farafangana',         nameMg: 'Farafangana',        district: 'Farafangana',             region: 'Atsimo-Atsinanana', lat: -22.8180, lng: 47.8330 },

  // ── ATSINANANA ───────────────────────────────────────────────────────────────
  { code: 'ATI-01', nameFr: 'Toamasina',           nameMg: 'Toamasina',          district: 'Toamasina',               region: 'Atsinanana',        lat: -18.1443, lng: 49.4025 },

  // ── ANALANJIROFO ─────────────────────────────────────────────────────────────
  { code: 'ANL-01', nameFr: 'Fenoarivo Atsinanana', nameMg: 'Fenoarivo Atsinanana', district: 'Fenoarivo Atsinanana', region: 'Analanjirofo',      lat: -17.3800, lng: 49.4170 },

  // ── ALAOTRA-MANGORO ──────────────────────────────────────────────────────────
  { code: 'ALA-01', nameFr: 'Ambatondrazaka',      nameMg: 'Ambatondrazaka',     district: 'Ambatondrazaka',          region: 'Alaotra-Mangoro',   lat: -17.8330, lng: 48.4330 },

  // ── BOENY ────────────────────────────────────────────────────────────────────
  { code: 'BOE-01', nameFr: 'Mahajanga',           nameMg: 'Mahajanga',          district: 'Mahajanga',               region: 'Boeny',             lat: -15.7170, lng: 46.3170 },

  // ── SOFIA ────────────────────────────────────────────────────────────────────
  { code: 'SOF-01', nameFr: 'Antsohihy',           nameMg: 'Antsohihy',          district: 'Antsohihy',               region: 'Sofia',             lat: -14.8830, lng: 47.9900 },

  // ── BETSIBOKA ────────────────────────────────────────────────────────────────
  { code: 'BET-01', nameFr: 'Maevatanana',         nameMg: 'Maevatanana',        district: 'Maevatanana',             region: 'Betsiboka',         lat: -16.9330, lng: 46.8670 },

  // ── MELAKY ───────────────────────────────────────────────────────────────────
  { code: 'MEL-01', nameFr: 'Maintirano',          nameMg: 'Maintirano',         district: 'Maintirano',              region: 'Melaky',            lat: -18.0500, lng: 44.0300 },

  // ── ATSIMO-ANDREFANA ─────────────────────────────────────────────────────────
  { code: 'ASA-01', nameFr: 'Toliara',             nameMg: 'Toliara',            district: 'Toliara',                 region: 'Atsimo-Andrefana',  lat: -23.3500, lng: 43.6667 },

  // ── ANDROY ───────────────────────────────────────────────────────────────────
  { code: 'ADR-01', nameFr: 'Ambovombe',           nameMg: 'Ambovombe',          district: 'Ambovombe',               region: 'Androy',            lat: -25.1700, lng: 46.0830 },

  // ── ANOSY ────────────────────────────────────────────────────────────────────
  { code: 'ANO-01', nameFr: 'Fort-Dauphin',        nameMg: 'Tolanaro',           district: 'Tôlanaro',                region: 'Anosy',             lat: -25.0330, lng: 46.9830 },

  // ── MENABE ───────────────────────────────────────────────────────────────────
  { code: 'MEN-01', nameFr: 'Morondava',           nameMg: 'Morondava',          district: 'Morondava',               region: 'Menabe',            lat: -20.3000, lng: 44.2830 },

  // ── DIANA ────────────────────────────────────────────────────────────────────
  { code: 'DIA-01', nameFr: 'Antsiranana',         nameMg: 'Antsiranana',        district: 'Antsiranana',             region: 'Diana',             lat: -12.3500, lng: 49.3000 },

  // ── SAVA ─────────────────────────────────────────────────────────────────────
  { code: 'SAV-01', nameFr: 'Sambava',             nameMg: 'Sambava',            district: 'Sambava',                 region: 'Sava',              lat: -14.2700, lng: 50.1700 },
];

async function main(): Promise<void> {
  process.stdout.write(`[seed-cities] Insertion de ${CITIES.length} chefs-lieux de région…\n`);

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
