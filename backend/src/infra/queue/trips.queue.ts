import { Queue, Worker, type Job } from 'bullmq';
import type { Redis as RedisType } from 'ioredis';
import { TripStatus, AuditAction } from '@prisma/client';
import prisma from '../db/prisma';

// =====================================================================
// Worker trip.autoClose — Architecture §2.7, §6.6
//
// Règle VH-03 : clôture automatique 72 heures après le DÉPART RÉEL.
// Fréquence : toutes les 10 minutes (cron */10 * * * *).
// Marque COMPLETED les TripInstance dont :
//   status = DEPARTED  ET  actualDepartedAt < NOW() - 72h
// Un trajet qui n'a jamais quitté (DRAFT, OPEN…) n'est jamais clôturé
// automatiquement, même si son heure planifiée est dépassée.
// Chaque transition est loggée dans AuditLog (RG-13).
//
// Ambiguïté documentée : le schéma AuditAction n'a pas d'action dédiée
// pour la clôture automatique de trajet. SCHEDULE_CHANGED est utilisé
// comme action la plus proche sémantiquement.
// =====================================================================

const QUEUE_NAME = 'trip.autoClose';
const AUTO_CLOSE_HOURS = 72; // VH-03
const AUTO_CLOSE_CRON = '*/10 * * * *'; // toutes les 10 minutes

// ------------------------------------------------------------------
// Connexion Redis dédiée BullMQ (distincte du client principal pour
// éviter les conflits en mode subscribe)
// ------------------------------------------------------------------

function createBullConnection(): RedisType {
  // Require dynamique pour permettre le mock dans les tests unitaires
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Redis = require('ioredis') as typeof import('ioredis').default;
  return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }) as RedisType;
}

// ------------------------------------------------------------------
// Queue singleton
// ------------------------------------------------------------------

let _tripAutoCloseQueue: Queue | undefined;

export function getTripAutoCloseQueue(): Queue {
  if (_tripAutoCloseQueue) return _tripAutoCloseQueue;
  _tripAutoCloseQueue = new Queue(QUEUE_NAME, {
    connection: createBullConnection(),
    defaultJobOptions: {
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 20 },
    },
  });
  return _tripAutoCloseQueue;
}

/**
 * Enregistre le job répété dans la file (à appeler au démarrage du serveur).
 * BullMQ déduplique les jobs répétés par leur pattern — idempotent.
 */
export async function scheduleTripAutoClose(): Promise<void> {
  const queue = getTripAutoCloseQueue();
  await queue.add(
    'autoClose',
    {},
    {
      repeat: { pattern: AUTO_CLOSE_CRON },
      removeOnComplete: { count: 1 },
      removeOnFail: { count: 10 },
    },
  );
  process.stdout.write(`[trip.autoClose] Job répété planifié : ${AUTO_CLOSE_CRON}\n`);
}

// ------------------------------------------------------------------
// Logique métier d'auto-clôture (exportée pour les tests unitaires)
// ------------------------------------------------------------------

export interface AutoCloseResult {
  closedCount: number;
  tripIds: string[];
}

export async function runAutoClose(): Promise<AutoCloseResult> {
  const cutoff = new Date(Date.now() - AUTO_CLOSE_HOURS * 60 * 60 * 1000);

  // Trouver les trajets à clôturer : DEPARTED depuis plus de 72h (VH-03)
  // On utilise actualDepartedAt, pas departureAt, pour ne pas fermer
  // un trajet retardé qui n'est jamais parti.
  const tripsToClose = await prisma.tripInstance.findMany({
    where: {
      status: TripStatus.DEPARTED,
      actualDepartedAt: { lt: cutoff },
    },
    select: { id: true, status: true },
  });

  if (tripsToClose.length === 0) {
    return { closedCount: 0, tripIds: [] };
  }

  const tripIds = tripsToClose.map((t) => t.id);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Mise à jour en lot
    await tx.tripInstance.updateMany({
      where: { id: { in: tripIds } },
      data: {
        status: TripStatus.COMPLETED,
        completedAt: now,
      },
    });

    // AuditLog par trajet (RG-13 — traçabilité)
    // Création séquentielle pour éviter une requête createMany volumineuse
    for (const trip of tripsToClose) {
      await tx.auditLog.create({
        data: {
          actorUserId: null, // Action système, pas d'acteur humain
          action: AuditAction.SCHEDULE_CHANGED,
          entityType: 'TripInstance',
          entityId: trip.id,
          before: { status: trip.status },
          after: {
            status: TripStatus.COMPLETED,
            reason: 'AUTO_CLOSE_72H',
            completedAt: now.toISOString(),
          },
        },
      });
    }
  });

  process.stdout.write(
    `[trip.autoClose] ${tripIds.length} trajet(s) clôturé(s) automatiquement (72h)\n`,
  );

  return { closedCount: tripIds.length, tripIds };
}

// ------------------------------------------------------------------
// Worker BullMQ
// ------------------------------------------------------------------

let _worker: Worker | undefined;

export function createTripAutoCloseWorker(): Worker {
  if (_worker) return _worker;

  _worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      return runAutoClose();
    },
    {
      connection: createBullConnection(),
      concurrency: 1, // Un seul job à la fois pour éviter les doublons
    },
  );

  _worker.on('completed', (job, result: AutoCloseResult) => {
    process.stdout.write(
      `[trip.autoClose] Job ${job.id} terminé : ${result.closedCount} trajet(s) clôturé(s)\n`,
    );
  });

  _worker.on('failed', (job, err) => {
    process.stderr.write(
      `[trip.autoClose] Job ${job?.id} échoué : ${err.message}\n`,
    );
  });

  return _worker;
}

/** Expose pour les tests qui souhaitent injecter leur propre queue */
export function _setTripAutoCloseQueueForTest(q: Queue): void {
  _tripAutoCloseQueue = q;
}

/** Réinitialise le worker (utile dans les tests) */
export function _resetWorkerForTest(): void {
  _worker = undefined;
  _tripAutoCloseQueue = undefined;
}
