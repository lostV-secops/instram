import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const target = new Date("2026-10-07T05:00:00.000Z"); // 08h00 Madagascar (UTC+3)
  await prisma.tripInstance.update({
    where: { id: "e2e00000-0000-0000-0001-000000000007" },
    data: { departureAt: target },
  });
  console.log("✅ TripInstance J+7 deplacement → 2026-10-07T05:00:00Z (08h00 heure locale)");
}
main().finally(() => prisma.$disconnect());