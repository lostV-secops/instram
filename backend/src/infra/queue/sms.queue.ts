import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

// =====================================================================
// File SMS — Architecture §2.7 worker sms.dispatch
// Respect strict de la plage de silence nocturne VH-02 (côté worker).
// =====================================================================

export interface SmsJobData {
  phone: string;
  templateCode: string;
  params: Record<string, string>;
  lang: 'FR' | 'MG';
  bookingId?: string;
  userId?: string;
  /** Identifiant de l'enregistrement Notification en base (pour mise à jour du statut) */
  notificationId?: string;
  /** true = transactionnel, bypass silence nocturne (VH-02) */
  isTransactional: boolean;
}

let _smsQueue: Queue | undefined;

/**
 * Retourne la file SMS, en créant une connexion Redis dédiée BullMQ
 * (distincte du client principal pour éviter les conflits en mode subscribe).
 */
function getSmsQueue(): Queue {
  if (_smsQueue) return _smsQueue;

  // Import dynamique pour permettre le mock dans les tests unitaires
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Redis = require('ioredis') as typeof import('ioredis').default;
  const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10_000,
  }) as Redis;

  _smsQueue = new Queue('sms.dispatch', { connection });
  return _smsQueue;
}

export async function enqueueSms(job: SmsJobData): Promise<void> {
  await getSmsQueue().add('dispatch', job, {
    attempts: 4, // 1 tentative initiale + 3 retries (VH-02, §2.7)
    backoff: {
      type: 'custom',
      // Les délais sont définis dans startSmsWorker via settings.backoffStrategy
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  });
}

/** Expose pour les tests qui souhaitent injecter leur propre queue */
export function _setSmsQueueForTest(q: Queue): void {
  _smsQueue = q;
}

// =====================================================================
// Worker BullMQ — sms.dispatch
// Appelé par les workers Node (processus séparé ou même processus).
// Délais de retry : 30 s → 2 min → 10 min (architecture §7.2)
// =====================================================================

/**
 * Démarre le worker BullMQ qui traite la file sms.dispatch.
 * Le NotificationsService est injecté pour éviter les imports circulaires.
 *
 * Backoff par tentative :
 *   Tentative 1 (1er retry) : 30 000 ms (30 s)
 *   Tentative 2 (2e retry)  : 120 000 ms (2 min)
 *   Tentative 3 (3e retry)  : 600 000 ms (10 min)
 */
export function startSmsWorker(notificationsService: {
  dispatch(jobData: SmsJobData): Promise<void>;
}): Worker {
  // Connexion dédiée au worker (BullMQ impose une connexion séparée)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Redis = require('ioredis') as typeof import('ioredis').default;
  const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10_000,
  });

  const worker = new Worker<SmsJobData>(
    'sms.dispatch',
    async (job) => {
      await notificationsService.dispatch(job.data);
    },
    {
      connection,
      settings: {
        backoffStrategy: (attemptsMade: number): number => {
          // attemptsMade commence à 1 après le 1er échec
          if (attemptsMade === 1) return 30_000;   // 30 s
          if (attemptsMade === 2) return 120_000;  // 2 min
          return 600_000;                          // 10 min
        },
      },
    },
  );

  worker.on('failed', (job, err) => {
    process.stderr.write(
      `[sms.worker] Job ${job?.id ?? '?'} échoué (tentative ${job?.attemptsMade ?? '?'}): ${err.message}\n`,
    );
  });

  worker.on('completed', (job) => {
    process.stdout.write(`[sms.worker] Job ${job.id} traité avec succès.\n`);
  });

  return worker;
}
