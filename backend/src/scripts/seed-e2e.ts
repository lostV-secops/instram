/**
 * Script de seed E2E — crée les données minimales nécessaires aux tests Playwright.
 *
 * Idempotent : chaque entité utilise un identifiant unique fixe (upsert ou
 * skipDuplicates) pour pouvoir être relancé sans erreur.
 *
 * Données créées :
 * - 2 coopératives de test (VALIDATED + PENDING_VALIDATION)
 * - 1 SeatMap (6 sièges : 2 VIP + 4 STANDARD)
 * - 1 Vehicle
 * - 1 Route Antananarivo → Toamasina
 * - 2 TripInstances OPEN_FOR_BOOKING (demain + dans 7 jours)
 * - Fares pour chaque trip
 * - 1 utilisateur COOP_ADMIN     (phone +261340000002) + Membership
 * - 1 utilisateur voyageur E2E   (phone +261340000001)
 * - 1 utilisateur COOP_DRIVER    (phone +261340000003) + Membership
 * - 1 utilisateur INSTRAM_ADMIN  (phone +261340000004) + AdminProfile
 * - 1 utilisateur COOP_ASSISTANT (phone +261340000005) + Membership
 * - 1 utilisateur à supprimer    (phone +261340000006)
 *
 * Usage :
 *   npx ts-node -r tsconfig-paths/register src/scripts/seed-e2e.ts
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const db = new PrismaClient();

// IDs fixes pour idempotence (générés une fois, hardcodés)
const COOP_ID              = 'e2e00000-0000-0000-0000-000000000001';
const COOP_PENDING_ID      = 'e2e00000-0000-0000-coop-000000000002';
const SEATMAP_ID           = 'e2e00000-0000-0000-0000-000000000002';
const VEHICLE_ID           = 'e2e00000-0000-0000-0000-000000000003';
const ROUTE_ID             = 'e2e00000-0000-0000-0000-000000000004';

// Utilisateur COOP_ADMIN pour les tests du back-office
export const COOP_ADMIN = {
  phone: '+261340000002',
  password: 'CoopAdmin2024!',
  firstName: 'AdminCoop',
  lastName: 'E2E',
};

// Utilisateur voyageur pour les tests d'inscription/réservation
export const TEST_USER = {
  phone: '+261340000001',
  password: 'TestUser2024!',
  firstName: 'Voyageur',
  lastName: 'E2E',
};

// Conducteur pour les tests de l'app driver
export const DRIVER_USER = {
  phone: '+261340000003',
  password: 'DriverE2E2024!',
  firstName: 'Conducteur',
  lastName: 'E2E',
};

// Administrateur InsTRAM pour la console admin
export const ADMIN_USER = {
  phone: '+261340000004',
  password: 'AdminInsTRAM2024!',
  firstName: 'AdminInsTRAM',
  lastName: 'E2E',
};

// Assistant coopérative (droits limités)
export const ASSISTANT_USER = {
  phone: '+261340000005',
  password: 'AssistantE2E2024!',
  firstName: 'Assistant',
  lastName: 'E2E',
};

// Utilisateur destiné à être supprimé dans les tests VH-08
export const USER_TO_DELETE = {
  phone: '+261340000006',
  password: 'DeleteMe2024!!',
  firstName: 'ToDelete',
  lastName: 'E2E',
};

// Villes issues du seed officiel des villes
const CITY_TANA_ID    = '770b9808-5087-431b-8342-243848dcb4fe'; // Antananarivo
const CITY_TOAMA_ID   = 'd90e8189-f95c-4ea7-9238-396c127f870c'; // Toamasina

async function main() {
  console.log('[seed-e2e] Début du seed E2E...');

  // 1. Coopératives
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

  // Coopérative en attente de validation (pour les tests admin)
  await db.cooperative.upsert({
    where: { id: COOP_PENDING_ID },
    update: {},
    create: {
      id: COOP_PENDING_ID,
      slug: 'e2e-pending-coop',
      legalName: 'Coopérative E2E En Attente',
      displayName: 'InsTRAM E2E Pending',
      status: 'PENDING_VALIDATION',
      contactEmail: 'pending@instram.mg',
      contactPhone: '+261340000098',
    },
  });
  console.log('[seed-e2e] ✓ Coopératives (VALIDATED + PENDING_VALIDATION)');

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

  // 7. Utilisateur COOP_ADMIN + TravelerProfile + Membership
  // Upsert par téléphone (champ unique) pour éviter les conflits d'ID
  const coopAdminHash = await argon2.hash(COOP_ADMIN.password);
  const verifiedAt = new Date();

  const coopAdmin = await db.user.upsert({
    where: { phone: COOP_ADMIN.phone },
    update: { passwordHash: coopAdminHash, phoneVerifiedAt: verifiedAt, status: 'ACTIVE' },
    create: {
      phone: COOP_ADMIN.phone,
      passwordHash: coopAdminHash,
      preferredLang: 'FR',
      status: 'ACTIVE',
      phoneVerifiedAt: verifiedAt,
    },
  });

  await db.travelerProfile.upsert({
    where: { userId: coopAdmin.id },
    update: {},
    create: {
      userId: coopAdmin.id,
      firstName: COOP_ADMIN.firstName,
      lastName: COOP_ADMIN.lastName,
    },
  });

  // Vérifier si un membership COOP_ADMIN existe déjà pour cet user
  const existingMembership = await db.membership.findFirst({
    where: { userId: coopAdmin.id, cooperativeId: COOP_ID },
  });
  if (!existingMembership) {
    await db.membership.create({
      data: {
        userId: coopAdmin.id,
        cooperativeId: COOP_ID,
        role: 'COOP_ADMIN',
        active: true,
      },
    });
  } else {
    await db.membership.update({
      where: { id: existingMembership.id },
      data: { active: true },
    });
  }
  console.log(`[seed-e2e] ✓ Utilisateur COOP_ADMIN (${COOP_ADMIN.phone})`);

  // 8. Utilisateur voyageur E2E (pré-vérifié, sans OTP)
  const testUserHash = await argon2.hash(TEST_USER.password);

  const testUser = await db.user.upsert({
    where: { phone: TEST_USER.phone },
    update: { passwordHash: testUserHash, phoneVerifiedAt: verifiedAt, status: 'ACTIVE' },
    create: {
      phone: TEST_USER.phone,
      passwordHash: testUserHash,
      preferredLang: 'FR',
      status: 'ACTIVE',
      phoneVerifiedAt: verifiedAt,
    },
  });

  await db.travelerProfile.upsert({
    where: { userId: testUser.id },
    update: {},
    create: {
      userId: testUser.id,
      firstName: TEST_USER.firstName,
      lastName: TEST_USER.lastName,
    },
  });
  console.log(`[seed-e2e] ✓ Utilisateur voyageur (${TEST_USER.phone})`);

  // 9. Conducteur (COOP_DRIVER)
  const driverHash = await argon2.hash(DRIVER_USER.password);
  const driver = await db.user.upsert({
    where: { phone: DRIVER_USER.phone },
    update: { passwordHash: driverHash, phoneVerifiedAt: verifiedAt, status: 'ACTIVE' },
    create: {
      phone: DRIVER_USER.phone,
      passwordHash: driverHash,
      preferredLang: 'FR',
      status: 'ACTIVE',
      phoneVerifiedAt: verifiedAt,
    },
  });
  await db.travelerProfile.upsert({
    where: { userId: driver.id },
    update: {},
    create: { userId: driver.id, firstName: DRIVER_USER.firstName, lastName: DRIVER_USER.lastName },
  });
  const existingDriverMembership = await db.membership.findFirst({
    where: { userId: driver.id, cooperativeId: COOP_ID },
  });
  if (!existingDriverMembership) {
    await db.membership.create({
      data: { userId: driver.id, cooperativeId: COOP_ID, role: 'COOP_DRIVER', active: true },
    });
  } else {
    await db.membership.update({ where: { id: existingDriverMembership.id }, data: { active: true } });
  }
  console.log(`[seed-e2e] ✓ Utilisateur COOP_DRIVER (${DRIVER_USER.phone})`);

  // 10. Administrateur InsTRAM (AdminProfile — rôle ADMIN_OPS)
  const adminHash = await argon2.hash(ADMIN_USER.password);
  const adminUser = await db.user.upsert({
    where: { phone: ADMIN_USER.phone },
    update: { passwordHash: adminHash, phoneVerifiedAt: verifiedAt, status: 'ACTIVE' },
    create: {
      phone: ADMIN_USER.phone,
      passwordHash: adminHash,
      preferredLang: 'FR',
      status: 'ACTIVE',
      phoneVerifiedAt: verifiedAt,
    },
  });
  await db.travelerProfile.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: { userId: adminUser.id, firstName: ADMIN_USER.firstName, lastName: ADMIN_USER.lastName },
  });
  await db.adminProfile.upsert({
    where: { userId: adminUser.id },
    update: { role: 'ADMIN_OPS' },
    create: { userId: adminUser.id, role: 'ADMIN_OPS' },
  });
  console.log(`[seed-e2e] ✓ Utilisateur INSTRAM_ADMIN (${ADMIN_USER.phone})`);

  // 11. Assistant coopérative (COOP_ASSISTANT)
  const assistantHash = await argon2.hash(ASSISTANT_USER.password);
  const assistant = await db.user.upsert({
    where: { phone: ASSISTANT_USER.phone },
    update: { passwordHash: assistantHash, phoneVerifiedAt: verifiedAt, status: 'ACTIVE' },
    create: {
      phone: ASSISTANT_USER.phone,
      passwordHash: assistantHash,
      preferredLang: 'FR',
      status: 'ACTIVE',
      phoneVerifiedAt: verifiedAt,
    },
  });
  await db.travelerProfile.upsert({
    where: { userId: assistant.id },
    update: {},
    create: { userId: assistant.id, firstName: ASSISTANT_USER.firstName, lastName: ASSISTANT_USER.lastName },
  });
  const existingAssistantMembership = await db.membership.findFirst({
    where: { userId: assistant.id, cooperativeId: COOP_ID },
  });
  if (!existingAssistantMembership) {
    await db.membership.create({
      data: { userId: assistant.id, cooperativeId: COOP_ID, role: 'COOP_ASSISTANT', active: true },
    });
  } else {
    await db.membership.update({ where: { id: existingAssistantMembership.id }, data: { active: true } });
  }
  console.log(`[seed-e2e] ✓ Utilisateur COOP_ASSISTANT (${ASSISTANT_USER.phone})`);

  // 12. Utilisateur à supprimer (tests VH-08 anonymisation)
  const deleteHash = await argon2.hash(USER_TO_DELETE.password);
  await db.user.upsert({
    where: { phone: USER_TO_DELETE.phone },
    update: { passwordHash: deleteHash, phoneVerifiedAt: verifiedAt, status: 'ACTIVE' },
    create: {
      phone: USER_TO_DELETE.phone,
      passwordHash: deleteHash,
      preferredLang: 'FR',
      status: 'ACTIVE',
      phoneVerifiedAt: verifiedAt,
    },
  });
  // TravelerProfile créé via upsert (on ne le récupère pas)
  const userToDeleteDb = await db.user.findUnique({ where: { phone: USER_TO_DELETE.phone } });
  if (userToDeleteDb) {
    await db.travelerProfile.upsert({
      where: { userId: userToDeleteDb.id },
      update: {},
      create: { userId: userToDeleteDb.id, firstName: USER_TO_DELETE.firstName, lastName: USER_TO_DELETE.lastName },
    });
  }
  console.log(`[seed-e2e] ✓ Utilisateur à supprimer (${USER_TO_DELETE.phone})`);

  console.log('[seed-e2e] Seed E2E terminé avec succès.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
