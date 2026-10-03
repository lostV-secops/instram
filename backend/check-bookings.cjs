const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
async function main() {
  const bookings = await db.booking.findMany({
    select: { id: true, reference: true, status: true, boardingStatus: true },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('Bookings:', JSON.stringify(bookings, null, 2));

  // Update IT-RFNJD to COMPLETED for rating test
  const updated = await db.booking.updateMany({
    where: { reference: 'IT-RFNJD' },
    data: {
      status: 'COMPLETED',
      boardingStatus: 'BOARDED',
      confirmedAt: new Date(),
    }
  });
  console.log('Updated to COMPLETED:', updated.count);
}
main().catch(console.error).finally(() => db.$disconnect());
