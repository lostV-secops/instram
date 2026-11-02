/**
 * seed-billing.ts — insère un plan tarifaire et des commissions de test
 * pour la coopérative e2e (e2e00000-0000-0000-0000-000000000001).
 *
 * Usage : tsx src/scripts/seed-billing.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const COOP_ID = 'e2e00000-0000-0000-0000-000000000001';

async function main() {
  // Éviter les doublons
  const existing = await prisma.cooperativePricingPlan.findFirst({
    where: { cooperativeId: COOP_ID },
  });

  if (!existing) {
    await prisma.cooperativePricingPlan.create({
      data: {
        cooperativeId: COOP_ID,
        type: 'COMMISSION',
        commissionRate: 8.0,
        effectiveFrom: new Date('2026-01-01'),
      },
    });
    console.log('Plan tarifaire COMMISSION 8% créé.');
  } else {
    console.log('Plan tarifaire déjà existant :', existing.type, existing.commissionRate);
  }

  // Chercher les réservations CONFIRMED sans commission existante
  const bookings = await prisma.booking.findMany({
    where: { cooperativeId: COOP_ID, status: 'CONFIRMED' },
    include: { commissions: true },
    take: 10,
  });

  let created = 0;
  for (const booking of bookings) {
    if (booking.commissions.length === 0) {
      await prisma.commission.create({
        data: {
          bookingId: booking.id,
          cooperativeId: COOP_ID,
          amountMga: Math.round(booking.seatSubtotalMga * 0.08),
          pricingPlanRef: 'COMMISSION_8PCT',
        },
      });
      created++;
    }
  }
  console.log(`${created} commission(s) créée(s).`);

  // Abonnements de test (pour démonstration du plan SUBSCRIPTION)
  const existingSubs = await prisma.cooperativeSubscription.count({
    where: { cooperativeId: COOP_ID },
  });
  if (existingSubs === 0) {
    await prisma.cooperativeSubscription.createMany({
      data: [
        {
          cooperativeId: COOP_ID,
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-31'),
          amountMga: 150_000,
          status: 'PAID',
          paidAt: new Date('2026-08-03'),
        },
        {
          cooperativeId: COOP_ID,
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
          amountMga: 150_000,
          status: 'PAID',
          paidAt: new Date('2026-09-02'),
        },
        {
          cooperativeId: COOP_ID,
          periodStart: new Date('2026-10-01'),
          periodEnd: new Date('2026-10-31'),
          amountMga: 150_000,
          status: 'MANUAL',
        },
      ],
    });
    console.log('3 abonnements de test créés.');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
