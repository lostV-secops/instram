import Fastify, { FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyCompress from '@fastify/compress';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import prisma from './infra/db/prisma';
import redis from './infra/cache/redis';
import { createSmsProvider } from './infra/sms/provider';

// Routes
import authRoutes from './modules/auth/auth.routes';
import catalogRoutes from './modules/catalog/catalog.routes';
import searchRoutes from './modules/search/search.routes';
import seatsRoutes from './modules/seats/seats.routes';
import bookingsRoutes from './modules/bookings/bookings.routes';
import paymentsRoutes from './modules/payments/payments.routes';
import cooperativeRoutes from './modules/cooperative/cooperative.routes';
import { tripsCoopRoutes, tripsTravelerRoutes } from './modules/trips/trips.routes';
import wsRoutes from './modules/ws/ws.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import driverRoutes from './modules/driver/driver.routes';
import ratingsRoutes from './modules/ratings/ratings.routes';
import exportsRoutes from './modules/exports/exports.routes';
import adminRoutes from './modules/admin/admin.routes';
import directoryRoutes from './modules/directory/directory.routes';

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
      // H-2 : masquer la query string (contient le JWT WS token) dans tous les logs Pino
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url?.split('?')[0], // retirer la query string des logs
            hostname: req.hostname,
          };
        },
      },
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
    trustProxy: process.env.TRUSTED_PROXY_IPS
      ? process.env.TRUSTED_PROXY_IPS.split(',').map((s) => s.trim())
      : process.env.NODE_ENV === 'production'
      ? false
      : true,
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
  // M-3 : CORS_ORIGIN obligatoire en production ; liste séparée par virgules admise
  await app.register(fastifyCors, {
    origin: process.env.NODE_ENV === 'production'
      ? (process.env.CORS_ORIGIN
          ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
          : (() => { throw new Error('CORS_ORIGIN requis en production'); })())
      : true,
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
    // H-1 : utiliser x-forwarded-for si présent (derrière un reverse proxy),
    // avec fallback sur req.ip puis 'unknown'
    keyGenerator: (req) =>
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? req.ip ?? 'unknown',
    errorResponseBuilder: (_req, context) => ({
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Trop de requêtes. Réessayez dans ${Math.ceil(context.ttl / 1000)} secondes.`,
    }),
  });

  // ------------------------------------------------------------------
  // JWT : access token 15 min (architecture §2.2)
  // ------------------------------------------------------------------
  // Parser rawBody — préserve le buffer brut pour la vérification HMAC des webhooks
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (
      _req: import('fastify').FastifyRequest,
      body: Buffer,
      done: (err: Error | null, body?: unknown) => void,
    ) => {
      (_req as import('fastify').FastifyRequest & { rawBody: Buffer }).rawBody = body;
      try {
        done(null, JSON.parse(body.toString('utf-8')));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  await app.register(fastifyJwt, {
    secret: process.env.JWT_ACCESS_SECRET!,
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
  // WebSocket temps réel — GET /ws?token=<jwt> (architecture §2.3)
  // Hors préfixe /v1 : le versionnage du protocole WS passe par le champ
  // `type` des événements, pas par l'URL.
  // Doit être enregistré APRÈS @fastify/jwt (le handler valide le token).
  // ------------------------------------------------------------------
  await app.register(wsRoutes);

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

      // Directory — annuaire public /directory/cooperatives (public, no auth)
      await v1.register(directoryRoutes, { prefix: '/directory' });

      // Seats — GET/POST/DELETE /trips/:tripInstanceId/seats/*
      await v1.register(seatsRoutes);

      // Bookings — /bookings, /coop/bookings/*, /webhooks/mobile-money/*
      await v1.register(bookingsRoutes);

      // Payments — /payments (POST + GET) ; rate-limit renforcé 30 req/min/user (§7.4)
      await v1.register(paymentsRoutes);

      // Cooperative back-office — /coop/cooperatives/current, /coop/members/*, /coop/vehicles/*
      await v1.register(cooperativeRoutes, { prefix: '/coop' });

      // Trips back-office — /coop/routes/*, /coop/schedules/*, /coop/trips/*
      await v1.register(tripsCoopRoutes, { prefix: '/coop' });

      // Trips voyageur — /trips/:tripInstanceId
      await v1.register(tripsTravelerRoutes);

      // Notifications — /notifications, /notifications/preferences
      await v1.register(notificationsRoutes, {
        db: prisma,
        redis,
        smsProvider: createSmsProvider(),
      });

      // Driver — /driver/trips/today, /driver/trips/:id/manifest|board|no-show|depart
      await v1.register(driverRoutes);

      // Ratings — /bookings/:id/rating, /ratings/cooperative/:id,
      //           /cooperatives/:id/rating-summary, /admin/ratings, /admin/ratings/:id
      await v1.register(ratingsRoutes);

      // Exports — /coop/exports, /coop/exports/:jobId, /admin/exports
      await v1.register(exportsRoutes);

      // Admin — /admin/cooperatives, /admin/users, /admin/ratings,
      //          /admin/dashboard, /admin/audit-logs, /admin/subscriptions
      await v1.register(adminRoutes, { prefix: '/admin' });
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
