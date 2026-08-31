import { Queue } from 'bullmq';
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
  }) as Redis;

  _smsQueue = new Queue('sms.dispatch', { connection });
  return _smsQueue;
}

export async function enqueueSms(job: SmsJobData): Promise<void> {
  await getSmsQueue().add('dispatch', job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  });
}

/** Expose pour les tests qui souhaitent injecter leur propre queue */
export function _setSmsQueueForTest(q: Queue): void {
  _smsQueue = q;
}
