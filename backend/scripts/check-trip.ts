import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const trip = await prisma.tripInstance.findUnique({
    where: { id: 'e2e00000-0000-0000-0001-000000000001' },
    include: {
      route: {
        include: {
          origin: { select: { id: true, nameFr: true } },
          destination: { select: { id: true, nameFr: true } },
        },
      },
      fares: { select: { priceMga: true, category: true } },
      vehicle: { select: { capacity: true, model: true } },
    },
  });

  if (!trip) { console.error('Trajet introuvable'); return; }

  console.log('=== Trajet ===');
  console.log('ID         :', trip.id);
  console.log('Départ     :', trip.departureAt.toISOString());
  console.log('Statut     :', trip.status);
  console.log('Route      :', trip.route.origin.nameFr, '→', trip.route.destination.nameFr);
  console.log('originCityId     :', trip.route.originCityId);
  console.log('destinationCityId:', trip.route.destinationCityId);
  console.log('Véhicule   :', trip.vehicle.model, '—', trip.vehicle.capacity, 'places');
  console.log('Tarifs     :', trip.fares.length === 0 ? '⚠️  AUCUN TARIF' : trip.fares.map(f => `${f.category}: ${f.priceMga} MGA`).join(', '));
}

main().finally(() => prisma.$disconnect());
