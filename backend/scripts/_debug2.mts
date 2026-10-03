import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const tripId = "e2e00000-0000-0000-0001-000000000001";
  
  const counts = await prisma.tripInstance.findUnique({
    where: { id: tripId },
    select: {
      _count: { select: { bookingSeats: { where: { isActive: true } } } },
      vehicle: { select: { capacity: true } },
      fares: { select: { priceMga: true } },
    },
  });
  
  const capacity = counts?.vehicle.capacity ?? 0;
  const sold = counts?._count.bookingSeats ?? 0;
  const available = capacity - sold;
  
  console.log("Capacité   :", capacity);
  console.log("Vendus     :", sold);
  console.log("Disponibles:", available);
  console.log("Tarifs     :", counts?.fares.map(f => f.priceMga));
  console.log("seatsAvailable >= 1:", available >= 1);
}
main().finally(() => prisma.$disconnect());