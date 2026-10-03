import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const trips = await prisma.tripInstance.findMany({
    where: { status: "OPEN_FOR_BOOKING" },
    include: {
      route: { include: { origin: true, destination: true } },
      _count: { select: { bookingSeats: { where: { isActive: true } } } },
      vehicle: { select: { capacity: true } },
    },
    orderBy: { departureAt: "asc" },
  });
  for (const t of trips) {
    const avail = t.vehicle.capacity - t._count.bookingSeats;
    console.log(`${t.id} | ${t.departureAt.toISOString()} | ${t.route.origin.nameFr} → ${t.route.destination.nameFr} | ${avail}/${t.vehicle.capacity} dispo`);
  }
}
main().finally(() => prisma.$disconnect());