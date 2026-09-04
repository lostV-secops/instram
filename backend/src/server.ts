import { buildApp } from './app';
import prisma from './infra/db/prisma';
import redis from './infra/cache/redis';
import { scheduleTripAutoClose, createTripAutoCloseWorker } from './infra/queue/trips.queue';
import { scheduleReconcileJob, startPaymentReconcileWorker } from './infra/queue/payments.queue';
import { startSmsWorker } from './infra/queue/sms.queue';
import { startExportWorker } from './infra/queue/exports.queue';
import { NotificationsService } from './modules/notifications/notifications.service';
import { createSmsProvider } from './infra/sms/provider';

// =====================================================================
// Point d'entrée du serveur InsTRAM
// Gestion du graceful shutdown sur SIGTERM / SIGINT
// =====================================================================

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function start(): Promise<void> {
  // Validation des secrets critiques avant tout démarrage
  const REQUIRED_SECRETS: Array<[string, string]> = [
    ['JWT_ACCESS_SECRET', 'change_me_access'],
    ['JWT_REFRESH_SECRET', 'change_me_refresh'],
    ['QR_SECRET', 'change_me_qr_secret'],
  ];
  for (const [name, placeholder] of REQUIRED_SECRETS) {
    const val = process.env[name];
    if (!val || val === placeholder || val.length < 32) {
      process.stderr.write(
        `[BOOT ERROR] ${name} est absent, trop court ou égal à la valeur d'exemple. Arrêt.\n`,
      );
      process.exit(1);
    }
  }

  // H-1 : TRUSTED_PROXY_IPS obligatoire en production pour que req.ip soit fiable
  if (process.env.NODE_ENV === 'production' && !process.env.TRUSTED_PROXY_IPS) {
    process.stderr.write(
      '[BOOT ERROR] TRUSTED_PROXY_IPS requis en production (ex: 10.0.0.0/8). Arrêt.\n',
    );
    process.exit(1);
  }

  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`InsTRAM backend démarré sur http://${HOST}:${PORT}`);

    // Planification de la clôture automatique des trajets (VH-03)
    await scheduleTripAutoClose();
    createTripAutoCloseWorker();

    // Workers BullMQ : réconciliation paiements, exports, SMS (architecture §2.7)
    await scheduleReconcileJob();
    startPaymentReconcileWorker({ db: prisma, redis });
    startExportWorker(prisma);
    const notificationsService = new NotificationsService(prisma, redis, createSmsProvider());
    startSmsWorker(notificationsService);
  } catch (err) {
    app.log.error(err, 'Impossible de démarrer le serveur');
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // Graceful shutdown
  // ------------------------------------------------------------------
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Signal ${signal} reçu — arrêt gracieux en cours...`);

    try {
      // 1. Fermer le serveur HTTP (plus de nouvelles connexions)
      await app.close();
      app.log.info('Serveur HTTP fermé');

      // 2. Fermer la connexion PostgreSQL
      await prisma.$disconnect();
      app.log.info('Connexion PostgreSQL fermée');

      // 3. Fermer la connexion Redis
      await redis.quit();
      app.log.info('Connexion Redis fermée');

      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Erreur lors du shutdown gracieux');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Gestion des erreurs non capturées
  process.on('uncaughtException', (err) => {
    app.log.fatal(err, 'uncaughtException — arrêt forcé');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ reason }, 'unhandledRejection — arrêt forcé');
    process.exit(1);
  });
}

void start();
