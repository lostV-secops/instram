import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const trip = await prisma.tripInstance.findUnique({
    where: { id: "e2e00000-0000-0000-0001-000000000001" },
    include: {
      route: { include: { origin: true, destination: true } },
      _count: { select: { bookingSeats: { where: { isActive: true } } } },
      vehicle: { select: { capacity: true } },
    },
  });
  console.log("departureAt:", trip?.departureAt.toISOString());
  console.log("originCityId     :", trip?.route.originCityId);
  console.log("destinationCityId:", trip?.route.destinationCityId);
  console.log("origin:", trip?.route.origin.nameFr);
  console.log("destination:", trip?.route.destination.nameFr);
  console.log("sièges vendus:", trip?._count.bookingSeats, "/", trip?.vehicle.capacity);
}
main().finally(() => prisma.$disconnect());