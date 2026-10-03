const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
async function main() {
  // Find the e2e cooperative
  const coop = await db.cooperative.findFirst({
    where: { displayName: { contains: 'E2E' } }
  });
  if (!coop) {
    console.log('No E2E cooperative found');
    return;
  }
  console.log('Found cooperative:', coop.id, coop.displayName, coop.slug);

  // Create a directory entry
  const entry = await db.directoryEntry.upsert({
    where: { cooperativeId: coop.id },
    create: {
      cooperativeId: coop.id,
      slug: coop.slug,
      displayName: coop.displayName,
      descriptionFr: 'Coopérative de transport test pour les tests E2E InsTRAM. Relie Antananarivo à Toamasina.',
      descriptionMg: 'Kooperativan\'ny fitaterana fitsapana ho an\'ny fitsapana E2E InsTRAM.',
      regionsServed: ['Analamanga', 'Atsinanana'],
      ratingAverage: 0,
      ratingCount: 0,
    },
    update: {
      displayName: coop.displayName,
      ratingAverage: 0,
      ratingCount: 0,
    }
  });
  console.log('Directory entry created/updated:', entry.id, entry.slug);
}
main().catch(console.error).finally(() => db.$disconnect());
