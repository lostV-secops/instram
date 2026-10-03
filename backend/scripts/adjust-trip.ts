/**
 * adjust-trip.ts
 *
 * Déplace le départ d'un TripInstance à demain à l'heure indiquée.
 * Utile pour tester le flux de réservation sans recréer le seed.
 *
 * Usage :
 *   npx tsx scripts/adjust-trip.ts [heure]    → premier trajet SCHEDULED
 *   npx tsx scripts/adjust-trip.ts 08:00       → demain à 08h00
 *
 * Sans argument : 08:00 par défaut.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const timeArg = process.argv[2] ?? '08:00';
  const [hours, minutes] = timeArg.split(':').map(Number);

  // Demain à l'heure demandée
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(hours, minutes ?? 0, 0, 0);

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
    data: { departureAt: tomorrow },
  });

  console.log(`✅  Trajet mis à jour`);
  console.log(`    Route      : ${route}`);
  console.log(`    ID         : ${trip.id}`);
  console.log(`    Avant      : ${ancienne}`);
  console.log(`    Après      : ${tomorrow.toLocaleString('fr-MG')}`);
  console.log(`    Statut     : ${trip.status}`);
}

main()
  .catch((err: unknown) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
