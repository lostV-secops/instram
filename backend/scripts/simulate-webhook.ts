/**
 * simulate-webhook.ts
 *
 * Simule un webhook Mobile Money entrant sur le backend InsTRAM.
 * Forge un payload signé HMAC-SHA256 identique à ce qu'enverrait
 * l'opérateur en production.
 *
 * Usage :
 *   npx tsx scripts/simulate-webhook.ts <bookingId> [mvola|orange_money]
 *
 * Exemples :
 *   npx tsx scripts/simulate-webhook.ts 550e8400-e29b-41d4-a716-446655440000
 *   npx tsx scripts/simulate-webhook.ts 550e8400-e29b-41d4-a716-446655440000 orange_money
 *
 * Prérequis :
 *   - Backend démarré sur http://localhost:4000 (ou BACKEND_URL dans .env)
 *   - MVOLA_WEBHOOK_SECRET (ou ORANGE_MONEY_WEBHOOK_SECRET) défini dans .env
 *   - Réservation en statut PENDING_PAYMENT
 */

import crypto from 'crypto';
import { resolve } from 'path';

// Charger .env sans dépendance externe (Node 20.12+)
try {
  (process as NodeJS.Process & { loadEnvFile?: (path: string) => void })
    .loadEnvFile?.(resolve(__dirname, '..', '.env'));
} catch { /* .env optionnel */ }
import { PrismaClient } from '@prisma/client';

// ─── Arguments ────────────────────────────────────────────────────────────────

const bookingId = process.argv[2];
const providerArg = (process.argv[3] ?? 'mvola').toLowerCase();

if (!bookingId) {
  console.error('❌  Usage : npx tsx scripts/simulate-webhook.ts <bookingId> [mvola|orange_money]');
  process.exit(1);
}

if (providerArg !== 'mvola' && providerArg !== 'orange_money') {
  console.error('❌  Provider invalide. Valeurs acceptées : mvola, orange_money');
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

async function main() {
  // 1. Charger la réservation (référence + montant + payment PENDING)
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      totalAmountMga: true,
      status: true,
      payments: {
        where: { status: 'PENDING' },
        select: { amountMga: true, provider: true },
        take: 1,
      },
    },
  });

  if (!booking) {
    console.error(`❌  Réservation introuvable : ${bookingId}`);
    process.exit(1);
  }

  console.log(`📋  Réservation : ${booking.reference} (${booking.status})`);

  if (booking.status !== 'PENDING_PAYMENT') {
    console.warn(`⚠️   Statut actuel : ${booking.status} (attendu : PENDING_PAYMENT)`);
    console.warn('    Le webhook sera probablement ignoré par le backend.');
  }

  // Montant : utiliser celui du Payment PENDING si disponible (double contrôle)
  const pendingPayment = booking.payments[0];
  const amountMga = pendingPayment?.amountMga ?? booking.totalAmountMga;

  console.log(`💰  Montant : ${amountMga.toLocaleString('fr-MG')} MGA`);

  // 2. Construire le payload webhook
  const webhookPayload = JSON.stringify({
    providerTransactionId: `SIM-${Date.now()}`,
    bookingReference: booking.reference,
    status: 'SUCCESS',
    amountMga,
  });

  // 3. Calculer la signature HMAC-SHA256
  const secretEnvKey =
    providerArg === 'mvola'
      ? 'MVOLA_WEBHOOK_SECRET'
      : 'ORANGE_MONEY_WEBHOOK_SECRET';

  const secret = process.env[secretEnvKey];
  if (!secret) {
    console.error(`❌  Variable d'environnement manquante : ${secretEnvKey}`);
    console.error(`    Ajoute ${secretEnvKey}=<valeur> dans backend/.env`);
    process.exit(1);
  }

  const signature = crypto
    .createHmac('sha256', secret)
    .update(webhookPayload)
    .digest('hex');

  // 4. En-tête de signature selon le provider
  const signatureHeader =
    providerArg === 'mvola' ? 'x-signature' : 'x-orange-signature';

  // 5. Appeler le webhook
  const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = `${backendUrl}/v1/webhooks/mobile-money/${providerArg}`;

  console.log(`\n🚀  POST ${url}`);
  console.log(`    ${signatureHeader}: ${signature.slice(0, 16)}…`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [signatureHeader]: signature,
    },
    body: webhookPayload,
  });

  const body = await res.text();

  if (res.ok) {
    console.log(`\n✅  ${res.status} — ${body}`);
    console.log('    La réservation doit maintenant être CONFIRMED.');
    console.log('    Le canal WS booking:{userId} doit avoir reçu PAYMENT_CONFIRMED.');
  } else {
    console.error(`\n❌  ${res.status} — ${body}`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
