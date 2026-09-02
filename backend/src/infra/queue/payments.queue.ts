import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';
import type { Redis } from 'ioredis';

// =====================================================================
// File BullMQ — payment.reconcile
// Architecture §2.7 : worker payment.reconcile
//   - Job répété toutes les 5 minutes
//   - Appelle PaymentsService.reconcilePending()
//   - Log résultats dans AuditLog
//
// Note : PaymentsService est importé dynamiquement pour éviter les
// dépendances circulaires et permettre les mocks dans les tests.
// =====================================================================

const QUEUE_NAME = 'payment.reconcile';
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _reconcileQueue: Queue | undefined;

/**
 * Retourne la file payment.reconcile, en créant une connexion Redis dédiée BullMQ.
 * (BullMQ impose une connexion distincte du client principal pour éviter les conflits mode subscribe)
 */
function getReconcileQueue(): Queue {
  if (_reconcileQueue) return _reconcileQueue;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IoRedis = require('ioredis') as typeof import('ioredis').default;
  const connection = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  _reconcileQueue = new Queue(QUEUE_NAME, { connection });
  return _reconcileQueue;
}

/**
 * Enregistre le job répété de réconciliation (toutes les 5 minutes).
 * À appeler une seule fois au démarrage des workers.
 */
export async function scheduleReconcileJob(): Promise<void> {
  const queue = getReconcileQueue();

  // Supprimer les jobs répétés obsolètes avant d'en ajouter un nouveau
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add(
    'reconcile',
    {},
    {
      repeat: { every: RECONCILE_INTERVAL_MS },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    },
  );
}

/** Expose pour les tests qui souhaitent injecter leur propre queue */
export function _setReconcileQueueForTest(q: Queue): void {
  _reconcileQueue = q;
}

// =====================================================================
// Worker BullMQ — payment.reconcile
// Appelé par le processus worker (séparé ou même processus).
// =====================================================================

export interface ReconcileWorkerDeps {
  db: PrismaClient;
  redis: Redis;
}

/**
 * Démarre le worker BullMQ qui traite les jobs payment.reconcile.
 * Les dépendances (db, redis) sont injectées pour faciliter les tests.
 */
export function startPaymentReconcileWorker(deps: ReconcileWorkerDeps): Worker {
  // Connexion dédiée au worker
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IoRedis = require('ioredis') as typeof import('ioredis').default;
  const connection = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const worker = new Worker<Record<string, never>>(
    QUEUE_NAME,
    async (_job: Job<Record<string, never>>) => {
      // Import dynamique du PaymentsService pour éviter les dépendances circulaires
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PaymentsService } = require('../../modules/payments/payments.service') as {
        PaymentsService: new (
          db: PrismaClient,
          redis: Redis,
          gateways: Map<string, import('../../infra/mobileMoney/gateway').MobileMoneyGateway>,
        ) => import('../../modules/payments/payments.service').PaymentsService;
      };

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { buildGatewayMap } = require('../../infra/mobileMoney/gateway') as {
        buildGatewayMap: (redis: Redis) => Map<string, import('../../infra/mobileMoney/gateway').MobileMoneyGateway>;
      };

      const gateways = buildGatewayMap(deps.redis);
      const paymentsService = new PaymentsService(deps.db, deps.redis, gateways);

      const result = await paymentsService.reconcilePending();

      // Log résultats dans AuditLog (RG-13)
      if (result.checked > 0) {
        await deps.db.auditLog.create({
          data: {
            action: AuditAction.PAYMENT_CONFIRMED, // Action de réconciliation — voir note ci-dessous
            entityType: 'PaymentReconcile',
            entityId: null,
            after: {
              source: 'payment.reconcile.worker',
              checked: result.checked,
              confirmed: result.confirmed,
              failed: result.failed,
              runAt: new Date().toISOString(),
            },
          },
        });
      }

      return result;
    },
    {
      connection,
      settings: {
        // Retry backoff : 30 s → 2 min (cohérent avec sms.queue)
        backoffStrategy: (attemptsMade: number): number => {
          if (attemptsMade === 1) return 30_000;
          return 120_000;
        },
      },
    },
  );

  worker.on('completed', (_job, result: { checked: number; confirmed: number; failed: number }) => {
    if (result?.checked > 0) {
      process.stdout.write(
        `[payment.reconcile] Réconciliation : checked=${result.checked}, confirmed=${result.confirmed}, failed=${result.failed}\n`,
      );
    }
  });

  worker.on('failed', (job, err) => {
    process.stderr.write(
      `[payment.reconcile] Job ${job?.id ?? '?'} échoué (tentative ${job?.attemptsMade ?? '?'}): ${err.message}\n`,
    );
  });

  return worker;
}
