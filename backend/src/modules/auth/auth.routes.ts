import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AuthService, TokenGenerator } from './auth.service';
import {
  RegisterSchema,
  LoginSchema,
  RefreshSchema,
  LogoutSchema,
} from './auth.schema';
import prisma from '../../infra/db/prisma';
import { requestAccountDeletion } from './auth.delete.service';

// =====================================================================
// Plugin Fastify — routes Auth
// Préfixe attendu : /v1/auth (enregistré depuis app.ts)
// Contrat : docs/contrat-api.yaml §/auth/*
// =====================================================================

function buildTokenGenerator(fastify: FastifyInstance): TokenGenerator {
  const accessExpiresIn = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';

  // Conversion "15m" → secondes pour le champ expiresIn de la réponse
  function toSeconds(duration: string): number {
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 900;
    return parseInt(match[1], 10) * units[match[2]];
  }

  return {
    accessExpiresInSeconds: toSeconds(accessExpiresIn),
    signAccessToken(payload: object): string {
      return fastify.jwt.sign(payload as Record<string, unknown>, {
        expiresIn: accessExpiresIn,
        // On signe avec le secret d'accès (configuré dans app.ts)
      });
    },
    signRefreshToken(_payload: object): string {
      // Le refresh token est un token opaque généré par le service,
      // on n'utilise pas JWT pour le refresh — pas besoin de signer ici.
      throw new Error('signRefreshToken ne doit pas être appelé directement');
    },
  };
}

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const tokenGenerator = buildTokenGenerator(fastify);
  const authService = new AuthService(prisma, tokenGenerator);

  // ------------------------------------------------------------------
  // POST /register
  // ------------------------------------------------------------------
  fastify.post('/register', {
    config: { rateLimit: { max: 10, timeWindow: '15m' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = RegisterSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: formatZodError(parseResult.error),
      });
    }

    try {
      const result = await authService.register(parseResult.data, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return reply.status(201).send(result);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'DUPLICATE_EMAIL' || code === 'DUPLICATE_PHONE') {
        return reply.status(409).send({
          code,
          message: (err as Error).message,
        });
      }
      req.log.error(err, 'register error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  });

  // ------------------------------------------------------------------
  // POST /login  (rate-limit renforcé : 5 req / 15 min / IP)
  // ------------------------------------------------------------------
  fastify.post('/login', {
    config: { rateLimit: { max: 5, timeWindow: '15m' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = LoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: formatZodError(parseResult.error),
      });
    }

    try {
      const result = await authService.login(parseResult.data, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return reply.status(200).send(result);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'INVALID_CREDENTIALS') {
        return reply.status(401).send({ code, message: 'Identifiants invalides' });
      }
      if (code === 'ACCOUNT_INACTIVE') {
        return reply.status(401).send({ code, message: (err as Error).message });
      }
      req.log.error(err, 'login error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  });

  // ------------------------------------------------------------------
  // POST /refresh
  // ------------------------------------------------------------------
  fastify.post('/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = RefreshSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: formatZodError(parseResult.error),
      });
    }

    try {
      const tokens = await authService.refresh(parseResult.data.refreshToken, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return reply.status(200).send(tokens);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (
        code === 'INVALID_REFRESH_TOKEN' ||
        code === 'REFRESH_TOKEN_EXPIRED' ||
        code === 'ACCOUNT_INACTIVE'
      ) {
        return reply.status(401).send({ code, message: (err as Error).message });
      }
      req.log.error(err, 'refresh error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  });

  // ------------------------------------------------------------------
  // DELETE /me — Suppression / anonymisation du compte voyageur (H-5)
  // Nécessite un JWT d'accès valide. Opération irréversible côté applicatif.
  // Les données financières (Booking, Payment, etc.) sont conservées (audit légal).
  // ------------------------------------------------------------------
  fastify.delete(
    '/me',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req.user as { sub: string }).sub;
      try {
        await requestAccountDeletion(userId, prisma);
        return reply.status(204).send();
      } catch (err) {
        req.log.error(err, 'delete account error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /logout  (nécessite un JWT d'accès valide)
  // ------------------------------------------------------------------
  fastify.post(
    '/logout',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseResult = LogoutSchema.safeParse(req.body);
      const rawToken = parseResult.success ? parseResult.data.refreshToken : undefined;

      if (!rawToken) {
        return reply.status(400).send({
          code: 'MISSING_REFRESH_TOKEN',
          message: 'refreshToken requis pour logout',
        });
      }

      try {
        await authService.logout(rawToken);
        return reply.status(204).send();
      } catch (err) {
        req.log.error(err, 'logout error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );
}
