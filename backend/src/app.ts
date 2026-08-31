import Fastify, { FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyCompress from '@fastify/compress';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import prisma from './infra/db/prisma';
import redis from './infra/cache/redis';

// Routes
import authRoutes from './modules/auth/auth.routes';
import catalogRoutes from './modules/catalog/catalog.routes';
import searchRoutes from './modules/search/search.routes';
import seatsRoutes from './modules/seats/seats.routes';
import bookingsRoutes from './modules/bookings/bookings.routes';

// =====================================================================
// Déclaration d'augmentation de types Fastify pour authenticate
// =====================================================================
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>;
  }
}

// =====================================================================
// Factory de l'application Fastify
// =====================================================================

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Pino JSON : format adapté aux logs structurés (observabilité §7.6)
      ...(process.env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:standard' },
            },
          }
        : {}),
    },
    trustProxy: true, // Nécessaire pour req.ip derrière un load-balancer / edge
    disableRequestLogging: false,
  });

  // ------------------------------------------------------------------
  // Plugins de sécurité et transport
  // ------------------------------------------------------------------

  // Helmet : headers HTTP de sécurité
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
  });

  // CORS : origines configurables via env
  await app.register(fastifyCors, {
    origin: process.env.CORS_ORIGIN ?? true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Compression brotli/gzip — obligatoire pour cible 3G lente (architecture §7.1)
  await app.register(fastifyCompress, {
    global: true,
    encodings: ['br', 'gzip'],
    threshold: 512, // bytes — ne pas compresser les toutes petites réponses
  });

  // Rate-limit global (sécurité §7.4)
  await app.register(fastifyRateLimit, {
    global: true,
    max: 200,
    timeWindow: '1m',
    redis,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, context) => ({
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Trop de requêtes. Réessayez dans ${Math.ceil(context.ttl / 1000)} secondes.`,
    }),
  });

  // ------------------------------------------------------------------
  // JWT : access token 15 min (architecture §2.2)
  // ------------------------------------------------------------------
  await app.register(fastifyJwt, {
    secret: process.env.JWT_ACCESS_SECRET ?? 'change_me_access',
    sign: {
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    },
  });

  // Décorateur d'authentification utilisé dans les routes protégées
  app.decorate(
    'authenticate',
    async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Token invalide ou expiré' });
      }
    },
  );

  // ------------------------------------------------------------------
  // Health checks (architecture §7.5, contrat §/healthz, /readyz)
  // Ces routes sont hors préfixe /v1 pour compatibilité avec les probes k8s
  // ------------------------------------------------------------------
  app.get('/healthz', { config: { rateLimit: { skip: () => true } } }, async (_req, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  app.get('/readyz', { config: { rateLimit: { skip: () => true } } }, async (_req, reply) => {
    try {
      // Vérification connexion PostgreSQL
      await prisma.$queryRaw`SELECT 1`;
      // Vérification connexion Redis
      await redis.ping();
      return reply.status(200).send({ status: 'ok', db: 'ok', cache: 'ok' });
    } catch (err) {
      app.log.error(err, 'readyz check failed');
      return reply.status(503).send({
        status: 'unavailable',
        message: (err as Error).message,
      });
    }
  });

  // ------------------------------------------------------------------
  // Routes versionnées /v1
  // ------------------------------------------------------------------
  await app.register(
    async (v1) => {
      // Auth
      await v1.register(authRoutes, { prefix: '/auth' });

      // Catalog (public, no auth)
      await v1.register(catalogRoutes, { prefix: '/catalog' });

      // Search (public, no auth)
      await v1.register(searchRoutes, { prefix: '/search' });

      // Seats — GET/POST/DELETE /trips/:tripInstanceId/seats/*
      await v1.register(seatsRoutes);

      // Bookings — /bookings, /payments, /coop/bookings/*, /webhooks/mobile-money/*
      await v1.register(bookingsRoutes);
    },
    { prefix: '/v1' },
  );

  // ------------------------------------------------------------------
  // Gestionnaire d'erreurs global
  // ------------------------------------------------------------------
  app.setErrorHandler((error, req, reply) => {
    req.log.error(error, 'Unhandled error');
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      code: error.code ?? 'INTERNAL_ERROR',
      message:
        process.env.NODE_ENV === 'production'
          ? 'Erreur serveur'
          : error.message,
    });
  });

  // Gestionnaire 404
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ code: 'NOT_FOUND', message: 'Route introuvable' });
  });

  return app;
}
