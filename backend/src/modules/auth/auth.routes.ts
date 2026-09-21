import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { OtpPurpose } from '@prisma/client';
import { AuthService, TokenGenerator } from './auth.service';
import {
  RegisterSchema,
  LoginSchema,
  RefreshSchema,
  LogoutSchema,
  VerifyOtpSchema,
  ResendOtpSchema,
  PasswordResetRequestSchema,
  PasswordResetSchema,
  RevokeSessionParamsSchema,
  UpdateMeSchema,
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
  // POST /register — crée le compte + envoie OTP (D8)
  // ------------------------------------------------------------------
  fastify.post('/register', {
    config: { rateLimit: { max: 10, timeWindow: '15m' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = RegisterSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parseResult.error) });
    }

    try {
      const result = await authService.register(parseResult.data, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        deviceId: req.headers['x-device-id'] as string | undefined,
      });
      return reply.status(201).send(result);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'DUPLICATE_EMAIL' || code === 'DUPLICATE_PHONE') {
        return reply.status(409).send({ code, message: (err as Error).message });
      }
      req.log.error(err, 'register error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  });

  // ------------------------------------------------------------------
  // POST /verify/otp — vérifie le code OTP d'inscription
  // ------------------------------------------------------------------
  fastify.post('/verify/otp', {
    config: { rateLimit: { max: 20, timeWindow: '5m' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = VerifyOtpSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
    }

    const { target, code, purpose } = parse.data;

    try {
      if (purpose === 'REGISTRATION_VERIFY') {
        const result = await authService.verifyRegistrationOtp(target, code, {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          deviceId: req.headers['x-device-id'] as string | undefined,
        });
        return reply.status(200).send(result);
      }
      return reply.status(400).send({ code: 'INVALID_PURPOSE', message: 'Utilisez /password/reset pour ce type d\'OTP' });
    } catch (err) {
      const errCode = (err as NodeJS.ErrnoException).code;
      if (errCode === 'OTP_INVALID') return reply.status(400).send({ code: errCode, message: (err as Error).message });
      if (errCode === 'OTP_TARGET_LOCKED') return reply.status(429).send({ code: errCode, message: (err as Error).message });
      req.log.error(err, 'verify otp error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  });

  // ------------------------------------------------------------------
  // POST /verify/resend — renvoie un OTP
  // ------------------------------------------------------------------
  fastify.post('/verify/resend', {
    config: { rateLimit: { max: 5, timeWindow: '10m' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = ResendOtpSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
    }

    try {
      await authService.resendOtp(
        parse.data.target,
        parse.data.purpose === 'REGISTRATION_VERIFY' ? OtpPurpose.REGISTRATION_VERIFY : OtpPurpose.PASSWORD_RESET,
        req.headers['x-device-id'] as string | undefined,
      );
      return reply.status(200).send({ message: 'Code renvoyé' });
    } catch (err) {
      const errCode = (err as NodeJS.ErrnoException).code;
      if (errCode === 'OTP_RATE_LIMITED') return reply.status(429).send({ code: errCode, message: (err as Error).message });
      if (errCode === 'OTP_TARGET_LOCKED') return reply.status(429).send({ code: errCode, message: (err as Error).message });
      req.log.error(err, 'resend otp error');
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
      if (code === 'ACCOUNT_NOT_VERIFIED') {
        return reply.status(403).send({ code, message: (err as Error).message, target: (err as any).target });
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
  // GET /me — Profil complet de l'utilisateur connecté
  // ------------------------------------------------------------------
  fastify.get(
    '/me',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req.user as { sub: string }).sub;
      try {
        const user = await authService.getMe(userId);
        return reply.status(200).send(user);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code, message: 'Utilisateur introuvable' });
        }
        req.log.error(err, 'getMe error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // PATCH /me — Mise à jour du profil voyageur
  // ------------------------------------------------------------------
  fastify.patch(
    '/me',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parse = UpdateMeSchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }
      const userId = (req.user as { sub: string }).sub;
      try {
        const user = await authService.updateMe(userId, parse.data);
        return reply.status(200).send(user);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: 'Utilisateur introuvable' });
        req.log.error(err, 'updateMe error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

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
  // POST /password/forgot (contrat) + alias /password/reset-request — demande OTP
  // ------------------------------------------------------------------
  const passwordForgotHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = PasswordResetRequestSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
    }
    await authService.sendPasswordResetOtp(
      parse.data.target,
      req.headers['x-device-id'] as string | undefined,
    ).catch((err) => req.log.warn(err, 'password reset otp silent error'));
    return reply.status(204).send();
  };
  fastify.post('/password/forgot', { config: { rateLimit: { max: 5, timeWindow: '15m' } } }, passwordForgotHandler);
  // ------------------------------------------------------------------
  fastify.post('/password/reset-request', {
    config: { rateLimit: { max: 5, timeWindow: '15m' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = PasswordResetRequestSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
    }

    // Toujours 200 — timing-safe, ne révèle pas l'existence du compte
    await authService.sendPasswordResetOtp(
      parse.data.target,
      req.headers['x-device-id'] as string | undefined,
    ).catch((err) => req.log.warn(err, 'password reset otp silent error'));

    return reply.status(200).send({ message: 'Si ce compte existe, un code a été envoyé' });
  });

  // ------------------------------------------------------------------
  // POST /password/reset — réinitialise le mot de passe via OTP
  // ------------------------------------------------------------------
  fastify.post('/password/reset', {
    config: { rateLimit: { max: 10, timeWindow: '15m' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = PasswordResetSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
    }

    try {
      await authService.resetPassword(
        parse.data.target,
        parse.data.code,
        parse.data.newPassword,
        req.headers['x-device-id'] as string | undefined,
      );
      return reply.status(200).send({ message: 'Mot de passe réinitialisé' });
    } catch (err) {
      const errCode = (err as NodeJS.ErrnoException).code;
      if (errCode === 'OTP_INVALID') return reply.status(400).send({ code: errCode, message: (err as Error).message });
      if (errCode === 'OTP_TARGET_LOCKED') return reply.status(429).send({ code: errCode, message: (err as Error).message });
      req.log.error(err, 'password reset error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  });

  // ------------------------------------------------------------------
  // GET /sessions — liste les sessions actives (D9)
  // ------------------------------------------------------------------
  fastify.get(
    '/sessions',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req.user as { sub: string }).sub;
      try {
        const sessions = await authService.getSessions(userId);
        return reply.status(200).send(sessions);
      } catch (err) {
        req.log.error(err, 'get sessions error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /sessions/:sessionId — révoque une session précise
  // ------------------------------------------------------------------
  fastify.delete(
    '/sessions/:sessionId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req.user as { sub: string }).sub;
      const parse = RevokeSessionParamsSchema.safeParse(req.params);
      if (!parse.success) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      }

      try {
        await authService.revokeSession(userId, parse.data.sessionId);
        return reply.status(204).send();
      } catch (err) {
        const errCode = (err as NodeJS.ErrnoException).code;
        if (errCode === 'SESSION_NOT_FOUND') return reply.status(404).send({ code: errCode, message: (err as Error).message });
        req.log.error(err, 'revoke session error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /sessions — révoque toutes les sessions
  // ------------------------------------------------------------------
  fastify.delete(
    '/sessions',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req.user as { sub: string }).sub;
      try {
        await authService.revokeAllSessions(userId);
        return reply.status(204).send();
      } catch (err) {
        req.log.error(err, 'revoke all sessions error');
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

  // ------------------------------------------------------------------
  // POST /invitations/:token/accept — accepter une invitation
  // ------------------------------------------------------------------
  fastify.post(
    '/invitations/:token/accept',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { token } = req.params as { token: string };
      const body = req.body as { password?: string; firstName?: string; lastName?: string };

      if (!body.password || body.password.length < 10) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Mot de passe requis (min 10 caractères)' });
      }

      try {
        const result = await authService.acceptInvitation(
          token,
          body.password,
          body.firstName,
          body.lastName,
          {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
          },
        );
        return reply.status(200).send(result);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: (err as Error).message });
        if (code === 'INVITATION_ALREADY_USED' || code === 'INVITATION_EXPIRED')
          return reply.status(400).send({ code, message: (err as Error).message });
        req.log.error(err, 'acceptInvitation error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );
}
