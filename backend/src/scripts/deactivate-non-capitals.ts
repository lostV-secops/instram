/**
 * Script one-shot : désactive toutes les villes qui ne sont PAS
 * un chef-lieu de région malgache.
 *
 * À relancer si de nouvelles villes non-capitales venaient d'être insérées.
 * Lancer : npx tsx src/scripts/deactivate-non-capitals.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CAPITAL_CODES = [
  'ANT-01', // Antananarivo     — Analamanga
  'VAK-01', // Antsirabe        — Vakinankaratra
  'ITA-01', // Miarinarivo      — Itasy
  'BON-01', // Tsiroanomandidy  — Bongolava
  'HMA-01', // Fianarantsoa     — Haute Matsiatra
  'AMO-01', // Ambositra        — Amoron'i Mania
  'VAT-01', // Manakara         — Fitovinany
  'VAT-02', // Mananjary        — Vatovavy
  'IHO-01', // Ihosy            — Ihorombe
  'ATA-01', // Farafangana      — Atsimo-Atsinanana
  'ATI-01', // Toamasina        — Atsinanana
  'ANL-01', // Fenoarivo Ats.   — Analanjirofo
  'ALA-01', // Ambatondrazaka   — Alaotra-Mangoro
  'BOE-01', // Mahajanga        — Boeny
  'SOF-01', // Antsohihy        — Sofia
  'BET-01', // Maevatanana      — Betsiboka
  'MEL-01', // Maintirano       — Melaky
  'ASA-01', // Toliara          — Atsimo-Andrefana
  'ADR-01', // Ambovombe        — Androy
  'ANO-01', // Fort-Dauphin     — Anosy
  'MEN-01', // Morondava        — Menabe
  'DIA-01', // Antsiranana      — Diana
  'SAV-01', // Sambava          — Sava
];

async function main(): Promise<void> {
  const { count: deactivated } = await prisma.city.updateMany({
    where: { code: { notIn: CAPITAL_CODES } },
    data: { isActive: false },
  });

  const { count: activated } = await prisma.city.updateMany({
    where: { code: { in: CAPITAL_CODES } },
    data: { isActive: true },
  });

  process.stdout.write(
    `[deactivate-non-capitals] ${deactivated} ville(s) désactivée(s), ${activated} chef(s)-lieu confirmé(s) actif(s).\n`,
  );
}

main()
  .catch((e) => {
    process.stderr.write(`Erreur : ${String(e)}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
