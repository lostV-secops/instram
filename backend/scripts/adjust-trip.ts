/**
 * adjust-trip.ts
 *
 * Déplace le départ d'un TripInstance à demain à l'heure indiquée.
 * Utile pour tester le flux de réservation sans recréer le seed.
 *
 * Usage :
 *   npx tsx scripts/adjust-trip.ts [date] [heure]
 *   npx tsx scripts/adjust-trip.ts              → demain à 08:00
 *   npx tsx scripts/adjust-trip.ts 08:00        → demain à 08:00
 *   npx tsx scripts/adjust-trip.ts 7/10/2026 08:00  → 7 octobre 2026 à 08:00
 *   npx tsx scripts/adjust-trip.ts 2026-10-07 08:00 → idem (format ISO)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Détecter si le premier argument est une date ou une heure
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  let targetDate: Date;

  if (arg1 && /\d{4}-\d{2}-\d{2}/.test(arg1)) {
    // Format ISO : 2026-10-07
    targetDate = new Date(arg1);
  } else if (arg1 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(arg1)) {
    // Format JJ/MM/AAAA : 7/10/2026
    const [d, m, y] = arg1.split('/').map(Number);
    targetDate = new Date(y, m - 1, d);
  } else {
    // Pas de date → demain
    targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 1);
  }

  // Heure : arg2 si date fournie en arg1, sinon arg1 si c'est une heure
  const timeArg =
    arg2 ??
    (arg1 && /^\d{2}:\d{2}$/.test(arg1) ? arg1 : '08:00');

  const [hours, minutes] = timeArg.split(':').map(Number);
  targetDate.setHours(hours, minutes ?? 0, 0, 0);

  // Prendre le premier TripInstance OPEN_FOR_BOOKING
  const trip = await prisma.tripInstance.findFirst({
    where: { status: 'OPEN_FOR_BOOKING' },
    include: { route: { include: { origin: true, destination: true } } },
    orderBy: { departureAt: 'asc' },
  });

  if (!trip) {
    console.error('❌  Aucun TripInstance OPEN_FOR_BOOKING en base.');
    console.error('    Lance d\'abord : npm run seed:e2e');
    process.exit(1);
  }

  const ancienne = trip.departureAt.toLocaleString('fr-MG');
  const route = `${trip.route.origin.nameFr} → ${trip.route.destination.nameFr}`;

  await prisma.tripInstance.update({
    where: { id: trip.id },
    data: { departureAt: targetDate },
  });

  console.log(`✅  Trajet mis à jour`);
  console.log(`    Route      : ${route}`);
  console.log(`    ID         : ${trip.id}`);
  console.log(`    Avant      : ${ancienne}`);
  console.log(`    Après      : ${targetDate.toLocaleString('fr-MG')}`);
  console.log(`    Statut     : ${trip.status}`);
}

main()
  .catch((err: unknown) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
