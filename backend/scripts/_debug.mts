import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const trip = await prisma.tripInstance.findUnique({
    where: { id: "e2e00000-0000-0000-0001-000000000001" },
    include: { route: true },
  });
  console.log("route.isActive:", trip?.route.isActive);
  console.log("departureAt UTC:", trip?.departureAt.toISOString());
  
  // Test direct de la requete search
  const dayStart = new Date("2026-10-07T00:00:00.000Z");
  const dayEnd   = new Date("2026-10-07T23:59:59.999Z");
  const results = await prisma.tripInstance.findMany({
    where: {
      status: "OPEN_FOR_BOOKING",
      departureAt: { gte: dayStart, lte: dayEnd },
      route: { originCityId: trip?.route.originCityId, destinationCityId: trip?.route.destinationCityId, isActive: true },
    },
    select: { id: true, departureAt: true },
  });
  console.log("Résultats requête search:", results.length, results.map(r => r.id));
}
main().finally(() => prisma.$disconnect());