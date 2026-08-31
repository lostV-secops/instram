import Redis from 'ioredis';

// Singleton ioredis avec retry strategy exponentielle.
// Conforme architecture §2.5 : cache 60 s recherche, verrous distribués hold siège,
// Pub/Sub WebSocket, files BullMQ.

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

  const client = new Redis(url, {
    maxRetriesPerRequest: null, // Requis par BullMQ
    retryStrategy(times: number): number | null {
      if (times > 10) {
        // Abandon après 10 tentatives
        return null;
      }
      // Backoff exponentiel : 50 ms, 100 ms, 200 ms ... plafond 3 s
      return Math.min(50 * Math.pow(2, times - 1), 3000);
    },
    reconnectOnError(err: Error): boolean {
      // Reconnecte sur les erreurs READONLY (failover Redis Sentinel)
      return err.message.includes('READONLY');
    },
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 10_000,
  });

  client.on('connect', () => {
    process.stdout.write('[redis] Connected\n');
  });

  client.on('ready', () => {
    process.stdout.write('[redis] Ready\n');
  });

  client.on('error', (err: Error) => {
    process.stderr.write(`[redis] Error: ${err.message}\n`);
  });

  client.on('close', () => {
    process.stdout.write('[redis] Connection closed\n');
  });

  client.on('reconnecting', () => {
    process.stdout.write('[redis] Reconnecting...\n');
  });

  return client;
}

export const redis: Redis =
  globalThis.__redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__redis = redis;
}

export default redis;
