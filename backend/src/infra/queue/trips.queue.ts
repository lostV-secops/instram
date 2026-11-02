import { Queue, Worker, type Job } from 'bullmq';
import type { Redis as RedisType } from 'ioredis';
import { TripStatus, AuditAction } from '@prisma/client';
import prisma from '../db/prisma';
import { enqueueSms } from './sms.queue';
import { emitDriverBoardingUpdate, emitCoopDashboardUpdate } from '../../modules/ws/ws.publisher';

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
    include: {
      bookings: {
        where: { status: 'CONFIRMED' },
        include: {
          buyer: { select: { phone: true, preferredLang: true } },
          passengers: { take: 1, select: { phone: true } },
        },
      },
    },
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
    for (const trip of tripsToClose) {
      await tx.auditLog.create({
        data: {
          actorUserId: null,
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

  // RATING_REQUEST SMS — inviter les voyageurs à noter (non transactionnel)
  const appBase = process.env.FRONTEND_URL ?? 'https://instram.mg';
  for (const trip of tripsToClose) {
    for (const booking of trip.bookings) {
      const phone = booking.buyer?.phone ?? booking.passengers[0]?.phone;
      const lang = (booking.buyer?.preferredLang ?? 'FR') as 'FR' | 'MG';
      if (!phone) continue;

      const ratingUrl = `${appBase}/fr/bookings/${booking.id}`;
      await enqueueSms({
        phone,
        lang,
        templateCode: 'RATING_REQUEST',
        bookingId: booking.id,
        params: { ratingUrl },
        isTransactional: false,
      }).catch((e: unknown) =>
        process.stderr.write(`[trip.autoClose] RATING_REQUEST SMS error: ${String(e)}\n`),
      );
    }
  }

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

// =====================================================================
// Worker trip.reminder — rappel SMS J-1 avant départ (CDC §5.5)
//
// Fréquence : toutes les heures (0 * * * *)
// Cible : TripInstance dont departureAt est dans ]now+23h, now+25h]
//         ET reminderSentAt IS NULL (pas encore envoyé)
//         ET status IN (OPEN_FOR_BOOKING, CLOSED_FOR_BOOKING, DEPARTED?)
// Pour chaque booking CONFIRMED du trajet, envoyer le SMS TRIP_REMINDER
// dans la langue préférée de l'acheteur.
// Les SMS de rappel respectent la plage de silence nocturne (isTransactional=false).
// =====================================================================

const REMINDER_QUEUE_NAME = 'trip.reminder';
const REMINDER_CRON = '0 * * * *'; // toutes les heures

let _tripReminderQueue: Queue | undefined;

export function getTripReminderQueue(): Queue {
  if (_tripReminderQueue) return _tripReminderQueue;
  _tripReminderQueue = new Queue(REMINDER_QUEUE_NAME, {
    connection: createBullConnection(),
    defaultJobOptions: {
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 20 },
    },
  });
  return _tripReminderQueue;
}

export async function scheduleTripReminder(): Promise<void> {
  const queue = getTripReminderQueue();
  await queue.add('reminder', {}, {
    repeat: { pattern: REMINDER_CRON },
    removeOnComplete: { count: 1 },
    removeOnFail: { count: 10 },
  });
  process.stdout.write(`[trip.reminder] Job répété planifié : ${REMINDER_CRON}\n`);
}

export interface ReminderResult {
  tripsProcessed: number;
  smsSent: number;
}

export async function runTripReminder(): Promise<ReminderResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const trips = await prisma.tripInstance.findMany({
    where: {
      departureAt: { gt: windowStart, lte: windowEnd },
      reminderSentAt: null,
      status: { in: [TripStatus.OPEN_FOR_BOOKING, TripStatus.CLOSED_FOR_BOOKING] },
    },
    include: {
      route: { include: { origin: true, destination: true } },
      bookings: {
        where: { status: 'CONFIRMED' },
        include: {
          buyer: { select: { phone: true, preferredLang: true } },
          passengers: { take: 1, select: { phone: true } },
        },
      },
    },
  });

  let smsSent = 0;

  for (const trip of trips) {
    const departureStr = trip.departureAt.toLocaleTimeString('fr-MG', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Antananarivo',
    });

    for (const booking of trip.bookings) {
      const phone = booking.buyer?.phone ?? booking.passengers[0]?.phone;
      const lang = (booking.buyer?.preferredLang ?? 'FR') as 'FR' | 'MG';
      if (!phone) continue;

      await enqueueSms({
        phone,
        lang,
        templateCode: 'TRIP_REMINDER',
        bookingId: booking.id,
        params: {
          origin: trip.route.origin.nameFr,
          destination: trip.route.destination.nameFr,
          departureAt: departureStr,
          reference: booking.reference,
        },
        isTransactional: false,
      }).catch((e: unknown) =>
        process.stderr.write(`[trip.reminder] SMS error booking ${booking.id}: ${String(e)}\n`),
      );
      smsSent++;
    }

    await prisma.tripInstance.update({
      where: { id: trip.id },
      data: { reminderSentAt: now },
    });
  }

  if (trips.length > 0) {
    process.stdout.write(`[trip.reminder] ${trips.length} trajet(s), ${smsSent} SMS envoyés\n`);
  }

  return { tripsProcessed: trips.length, smsSent };
}

let _reminderWorker: Worker | undefined;

export function createTripReminderWorker(): Worker {
  if (_reminderWorker) return _reminderWorker;

  _reminderWorker = new Worker(
    REMINDER_QUEUE_NAME,
    async (_job: Job) => runTripReminder(),
    { connection: createBullConnection(), concurrency: 1 },
  );

  _reminderWorker.on('completed', (job, result: ReminderResult) => {
    process.stdout.write(
      `[trip.reminder] Job ${job.id} terminé : ${result.smsSent} SMS\n`,
    );
  });

  _reminderWorker.on('failed', (job, err) => {
    process.stderr.write(`[trip.reminder] Job ${job?.id} échoué : ${err.message}\n`);
  });

  return _reminderWorker;
}

// =====================================================================
// Worker trip.autoDepart — fermeture automatique de l'embarquement
//
// Au moment du départ planifié (departureAt), tous les passagers encore
// en statut NOT_BOARDED passent automatiquement en ABSENT et le trajet
// bascule en DEPARTED. Le conducteur n'a rien à faire manuellement.
//
// Fréquence : toutes les minutes (* * * * *)
// Cibles : TripInstance dont departureAt ≤ NOW() ET status ∉ {DEPARTED, COMPLETED, CANCELLED}
// =====================================================================

const AUTO_DEPART_QUEUE_NAME = 'trip.autoDepart';
const AUTO_DEPART_CRON = '* * * * *'; // chaque minute

let _autoDepartQueue: Queue | undefined;

export function getTripAutoDepartQueue(): Queue {
  if (_autoDepartQueue) return _autoDepartQueue;
  _autoDepartQueue = new Queue(AUTO_DEPART_QUEUE_NAME, {
    connection: createBullConnection(),
    defaultJobOptions: {
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 20 },
    },
  });
  return _autoDepartQueue;
}

export async function scheduleTripAutoDepart(): Promise<void> {
  const queue = getTripAutoDepartQueue();
  await queue.add('autoDepart', {}, {
    repeat: { pattern: AUTO_DEPART_CRON },
    removeOnComplete: { count: 1 },
    removeOnFail: { count: 10 },
  });
  process.stdout.write(`[trip.autoDepart] Job répété planifié : ${AUTO_DEPART_CRON}\n`);
}

export interface AutoDepartResult {
  departedCount: number;
  tripIds: string[];
}

export async function runAutoDepart(): Promise<AutoDepartResult> {
  const now = new Date();

  const trips = await prisma.tripInstance.findMany({
    where: {
      departureAt: { lte: now },
      status: { notIn: [TripStatus.DEPARTED, TripStatus.COMPLETED, TripStatus.CANCELLED] },
    },
    select: { id: true, cooperativeId: true, departureAt: true },
  });

  if (trips.length === 0) return { departedCount: 0, tripIds: [] };

  for (const trip of trips) {
    await prisma.$transaction(async (tx) => {
      await tx.tripInstance.update({
        where: { id: trip.id },
        data: {
          status: TripStatus.DEPARTED,
          actualDepartedAt: trip.departureAt,
        },
      });

      // Marquer tous les passagers non embarqués comme absents
      await tx.booking.updateMany({
        where: {
          tripInstanceId: trip.id,
          status: 'CONFIRMED',
          boardingStatus: 'NOT_BOARDED',
        },
        data: { boardingStatus: 'ABSENT' },
      });
    });

    // Émissions WS après le commit
    await emitDriverBoardingUpdate(trip.id, {
      type: 'AUTO_DEPARTED',
      departedAt: trip.departureAt.toISOString(),
    }).catch(() => {});

    await emitCoopDashboardUpdate(trip.cooperativeId, {
      type: 'TRIP_DEPARTED',
      tripInstanceId: trip.id,
      departedAt: trip.departureAt.toISOString(),
    }).catch(() => {});
  }

  const tripIds = trips.map((t) => t.id);
  process.stdout.write(
    `[trip.autoDepart] ${tripIds.length} trajet(s) clôturé(s) automatiquement à l'heure de départ\n`,
  );
  return { departedCount: tripIds.length, tripIds };
}

let _autoDepartWorker: Worker | undefined;

export function createTripAutoDepartWorker(): Worker {
  if (_autoDepartWorker) return _autoDepartWorker;

  _autoDepartWorker = new Worker(
    AUTO_DEPART_QUEUE_NAME,
    async (_job: Job) => runAutoDepart(),
    { connection: createBullConnection(), concurrency: 1 },
  );

  _autoDepartWorker.on('completed', (job, result: AutoDepartResult) => {
    if (result.departedCount > 0) {
      process.stdout.write(
        `[trip.autoDepart] Job ${job.id} : ${result.departedCount} trajet(s)\n`,
      );
    }
  });

  _autoDepartWorker.on('failed', (job, err) => {
    process.stderr.write(`[trip.autoDepart] Job ${job?.id} échoué : ${err.message}\n`);
  });

  return _autoDepartWorker;
}
