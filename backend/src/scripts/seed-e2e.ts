/**
 * Script de seed E2E — crée les données minimales nécessaires aux tests Playwright.
 *
 * Idempotent : chaque entité utilise un identifiant unique fixe (upsert ou
 * skipDuplicates) pour pouvoir être relancé sans erreur.
 *
 * Données créées :
 * - 1 coopérative de test (VALIDATED)
 * - 1 SeatMap (4 sièges STANDARD + 2 VIP)
 * - 1 Vehicle
 * - 1 Route Antananarivo → Toamasina
 * - 2 TripInstances OPEN_FOR_BOOKING (demain + dans 7 jours)
 * - Fares pour chaque trip
 *
 * Usage :
 *   npx ts-node -r tsconfig-paths/register src/scripts/seed-e2e.ts
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

// IDs fixes pour idempotence (générés une fois, hardcodés)
const COOP_ID         = 'e2e00000-0000-0000-0000-000000000001';
const SEATMAP_ID      = 'e2e00000-0000-0000-0000-000000000002';
const VEHICLE_ID      = 'e2e00000-0000-0000-0000-000000000003';
const ROUTE_ID        = 'e2e00000-0000-0000-0000-000000000004';

// Villes issues du seed officiel des villes
const CITY_TANA_ID    = '770b9808-5087-431b-8342-243848dcb4fe'; // Antananarivo
const CITY_TOAMA_ID   = 'd90e8189-f95c-4ea7-9238-396c127f870c'; // Toamasina

async function main() {
  console.log('[seed-e2e] Début du seed E2E...');

  // 1. Coopérative
  await db.cooperative.upsert({
    where: { id: COOP_ID },
    update: {},
    create: {
      id: COOP_ID,
      slug: 'e2e-test-coop',
      legalName: 'Coopérative E2E Test',
      displayName: 'InsTRAM E2E Test',
      status: 'VALIDATED',
      contactEmail: 'e2e@instram.mg',
      contactPhone: '+261340000099',
      validatedAt: new Date(),
    },
  });
  console.log('[seed-e2e] ✓ Coopérative');

  // 2. SeatMap (layout minimaliste)
  await db.seatMap.upsert({
    where: { id: SEATMAP_ID },
    update: {},
    create: {
      id: SEATMAP_ID,
      cooperativeId: COOP_ID,
      name: 'Minibus 6 places E2E',
      capacity: 6,
      layout: {
        rows: 3,
        columns: 2,
        driverRow: null,
        specialSeats: [],
      },
    },
  });
  console.log('[seed-e2e] ✓ SeatMap');

  // 3. SeatDefinitions (idempotent via skipDuplicates)
  const seatDefs = [
    { code: '1A', category: 'VIP',      row: 1, column: 1 },
    { code: '1B', category: 'VIP',      row: 1, column: 2 },
    { code: '2A', category: 'STANDARD', row: 2, column: 1 },
    { code: '2B', category: 'STANDARD', row: 2, column: 2 },
    { code: '3A', category: 'STANDARD', row: 3, column: 1 },
    { code: '3B', category: 'STANDARD', row: 3, column: 2 },
  ] as const;

  await db.seatDefinition.createMany({
    data: seatDefs.map((s) => ({ ...s, seatMapId: SEATMAP_ID })),
    skipDuplicates: true,
  });
  console.log('[seed-e2e] ✓ SeatDefinitions');

  // 4. Vehicle
  await db.vehicle.upsert({
    where: { id: VEHICLE_ID },
    update: {},
    create: {
      id: VEHICLE_ID,
      cooperativeId: COOP_ID,
      seatMapId: SEATMAP_ID,
      registration: 'E2E-0001',
      displayName: 'Minibus E2E',
      model: 'Toyota Hiace',
      capacity: 6,
      isActive: true,
    },
  });
  console.log('[seed-e2e] ✓ Vehicle');

  // 5. Route
  await db.route.upsert({
    where: { id: ROUTE_ID },
    update: {},
    create: {
      id: ROUTE_ID,
      cooperativeId: COOP_ID,
      originCityId: CITY_TANA_ID,
      destinationCityId: CITY_TOAMA_ID,
      displayName: 'Antananarivo → Toamasina (E2E)',
      distanceKm: 362,
      estimatedDurationMin: 480,
      isActive: true,
    },
  });
  console.log('[seed-e2e] ✓ Route');

  // 6. TripInstances — demain et dans 7 jours
  const seatDefs2 = await db.seatDefinition.findMany({ where: { seatMapId: SEATMAP_ID } });

  for (const daysFromNow of [1, 7]) {
    const departure = new Date();
    departure.setDate(departure.getDate() + daysFromNow);
    departure.setHours(7, 0, 0, 0); // 07:00 UTC

    const arrival = new Date(departure);
    arrival.setHours(arrival.getHours() + 8);

    // Identifiant fixe basé sur le décalage
    const tripId = `e2e00000-0000-0000-0001-${String(daysFromNow).padStart(12, '0')}`;

    const trip = await db.tripInstance.upsert({
      where: { id: tripId },
      update: {
        departureAt: departure,
        arrivalEstimatedAt: arrival,
        status: 'OPEN_FOR_BOOKING',
      },
      create: {
        id: tripId,
        cooperativeId: COOP_ID,
        routeId: ROUTE_ID,
        vehicleId: VEHICLE_ID,
        departureAt: departure,
        arrivalEstimatedAt: arrival,
        status: 'OPEN_FOR_BOOKING',
        openedForBookingAt: new Date(),
      },
    });

    // Fares (prix par catégorie)
    await db.fare.deleteMany({ where: { tripInstanceId: trip.id } });
    const fareData = seatDefs2.map((seat) => ({
      tripInstanceId: trip.id,
      seatDefinitionId: seat.id,
      category: seat.category,
      priceMga: seat.category === 'VIP' ? 45_000 : 25_000,
    }));
    await db.fare.createMany({ data: fareData, skipDuplicates: true });

    const dateStr = departure.toISOString().split('T')[0];
    console.log(`[seed-e2e] ✓ TripInstance J+${daysFromNow} (${dateStr}) — id: ${tripId}`);
  }

  console.log('[seed-e2e] Seed E2E terminé avec succès.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
