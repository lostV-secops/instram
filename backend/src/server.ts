import { buildApp } from './app';
import prisma from './infra/db/prisma';
import redis from './infra/cache/redis';
import { scheduleTripAutoClose, createTripAutoCloseWorker } from './infra/queue/trips.queue';

// =====================================================================
// Point d'entrée du serveur InsTRAM
// Gestion du graceful shutdown sur SIGTERM / SIGINT
// =====================================================================

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function start(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`InsTRAM backend démarré sur http://${HOST}:${PORT}`);

    // Planification de la clôture automatique des trajets (VH-03)
    await scheduleTripAutoClose();
    createTripAutoCloseWorker();
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
