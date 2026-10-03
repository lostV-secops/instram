import argon2 from 'argon2';
import crypto from 'crypto';
import { PrismaClient, User, Lang, OtpPurpose, InvitationStatus } from '@prisma/client';
import { RegisterInput, LoginInput, UpdateMeInput } from './auth.schema';
import { createSmsProvider } from '../../infra/sms/provider';
import { createEmailProvider } from '../../infra/email/provider';

// =====================================================================
// Types de retour
// =====================================================================

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // en secondes
}

export interface AuthResult extends TokenPair {
  user: SafeUser;
}

export interface SafeUser {
  id: string;
  email: string | null;
  phone: string | null;
  preferredLang: Lang;
  roles: string[];
  cooperatives: Array<{ id: string; displayName: string; role: string }>;
  traveler: {
    firstName: string;
    lastName: string;
    mobileMoneyPhone: string | null;
  } | null;
}

// =====================================================================
// Interface du générateur de tokens (injectée pour les tests)
// =====================================================================

export interface TokenGenerator {
  signAccessToken(payload: object): string;
  signRefreshToken(payload: object): string;
  /** Durée du token d'accès en secondes */
  accessExpiresInSeconds: number;
}

export interface RegisterPendingResult {
  requiresVerification: true;
  userId: string;
  target: string;
  /** Présent uniquement hors production — code OTP en clair pour faciliter les tests DEV */
  _devCode?: string;
}

export interface SessionInfo {
  id: string;
  deviceId: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface SessionsResult {
  sessions: SessionInfo[];
  cooperativeContexts: Array<{ coopId: string; coopName: string; role: string }>;
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Hache un refresh token brut (SHA-256 hex) pour le stocker en base.
 * On ne stocke jamais le token brut (principe de sécurité analogue aux mots de passe).
 */
function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Génère un refresh token opaque cryptographiquement sûr.
 */
function generateRawRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

/**
 * Construit une durée en millisecondes depuis une chaîne "15m", "30d", etc.
 */
function parseDurationMs(duration: string): number {
  const units: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Durée invalide : ${duration}`);
  return parseInt(match[1], 10) * units[match[2]];
}

// =====================================================================
// Service
// =====================================================================

export class AuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly tokenGenerator: TokenGenerator,
    private readonly refreshExpiresIn: string = process.env
      .JWT_REFRESH_EXPIRES_IN ?? '30d',
  ) {}

  // ------------------------------------------------------------------
  // register — crée le compte et envoie l'OTP de vérification (D8)
  // ------------------------------------------------------------------

  async register(
    input: RegisterInput,
    meta: { ipAddress?: string; userAgent?: string; deviceId?: string } = {},
  ): Promise<RegisterPendingResult> {
    if (input.email) {
      const existing = await this.db.user.findUnique({ where: { email: input.email } });
      if (existing) {
        const err = new Error('Email déjà utilisé');
        (err as NodeJS.ErrnoException).code = 'DUPLICATE_EMAIL';
        throw err;
      }
    }
    if (input.phone) {
      const existing = await this.db.user.findUnique({ where: { phone: input.phone } });
      if (existing) {
        const err = new Error('Téléphone déjà utilisé');
        (err as NodeJS.ErrnoException).code = 'DUPLICATE_PHONE';
        throw err;
      }
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const user = await this.db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email ?? null,
          phone: input.phone ?? null,
          passwordHash,
          preferredLang: (input.preferredLang as Lang) ?? Lang.FR,
          travelerProfile: {
            create: { firstName: input.firstName, lastName: input.lastName },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: created.id,
          action: 'USER_CREATED',
          entityType: 'User',
          entityId: created.id,
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
        },
      });

      return created;
    });

    // Cible = email en priorité, sinon phone (l'email est plus fiable comme canal de vérification)
    const target = input.email ?? input.phone!;
    const { devCode } = await this._generateAndSendOtp(
      user.id,
      target,
      OtpPurpose.REGISTRATION_VERIFY,
      user.preferredLang,
      meta.deviceId,
    );

    return {
      requiresVerification: true,
      userId: user.id,
      target,
      ...(devCode ? { _devCode: devCode } : {}),
    };
  }

  // ------------------------------------------------------------------
  // login
  // ------------------------------------------------------------------

  async login(
    input: LoginInput,
    meta: { ipAddress?: string; userAgent?: string; deviceId?: string } = {},
  ): Promise<AuthResult> {
    // Recherche de l'utilisateur
    let user: (User & {
      travelerProfile: { firstName: string; lastName: string; mobileMoneyPhone: string | null } | null;
      memberships: Array<{ cooperativeId: string; role: string; cooperative: { id: string; displayName: string } }>;
      adminProfile: { role: string } | null;
    }) | null = null;

    if (input.email) {
      user = await this.db.user.findUnique({
        where: { email: input.email },
        include: {
          travelerProfile: true,
          memberships: { include: { cooperative: true }, where: { active: true } },
          adminProfile: true,
        },
      });
    } else if (input.phone) {
      user = await this.db.user.findUnique({
        where: { phone: input.phone },
        include: {
          travelerProfile: true,
          memberships: { include: { cooperative: true }, where: { active: true } },
          adminProfile: true,
        },
      });
    }

    if (!user || !user.passwordHash) {
      await this._recordFailedLogin(null, meta);
      const err = new Error('Identifiants invalides');
      (err as NodeJS.ErrnoException).code = 'INVALID_CREDENTIALS';
      throw err;
    }

    if (user.status === 'SUSPENDED' || user.status === 'DELETED') {
      const err = new Error('Compte suspendu ou supprimé');
      (err as NodeJS.ErrnoException).code = 'ACCOUNT_INACTIVE';
      throw err;
    }

    // Compte non vérifié par OTP — exiger vérification (D8)
    if (!user.emailVerifiedAt && !user.phoneVerifiedAt) {
      const target = input.phone ?? input.email!;
      const err = new Error('Compte non vérifié — OTP requis');
      (err as NodeJS.ErrnoException & { target: string }).code = 'ACCOUNT_NOT_VERIFIED';
      (err as NodeJS.ErrnoException & { target: string }).target = target;
      throw err;
    }

    // Vérification du mot de passe (Argon2id)
    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      await this._recordFailedLogin(user.id, meta);
      const err = new Error('Identifiants invalides');
      (err as NodeJS.ErrnoException).code = 'INVALID_CREDENTIALS';
      throw err;
    }

    // Mise à jour lastLoginAt
    await this.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this._issueTokens(user, meta);
  }

  // ------------------------------------------------------------------
  // refresh — rotation du refresh token (one-time-use)
  // ------------------------------------------------------------------

  async refresh(
    rawRefreshToken: string,
    meta: { ipAddress?: string; userAgent?: string; deviceId?: string } = {},
  ): Promise<TokenPair> {
    const tokenHash = hashRefreshToken(rawRefreshToken);

    const session = await this.db.authSession.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: {
        user: {
          include: {
            travelerProfile: true,
            memberships: { include: { cooperative: true }, where: { active: true } },
            adminProfile: true,
          },
        },
      },
    });

    if (!session) {
      const err = new Error('Refresh token inconnu');
      (err as NodeJS.ErrnoException).code = 'INVALID_REFRESH_TOKEN';
      throw err;
    }

    // Vérification expiration (non-atomique suffisant : date immuable après création)
    if (session.expiresAt < new Date()) {
      const err = new Error('Refresh token expiré');
      (err as NodeJS.ErrnoException).code = 'REFRESH_TOKEN_EXPIRED';
      throw err;
    }

    if (session.user.status !== 'ACTIVE') {
      const err = new Error('Compte inactif');
      (err as NodeJS.ErrnoException).code = 'ACCOUNT_INACTIVE';
      throw err;
    }

    // M-9 : Rotation atomique — révocation de l'ancien token via updateMany avec
    // condition revokedAt: null. Si count=0, le token a été utilisé entre la lecture
    // et cet appel (replay attack) : on révoque toute la chaîne de sessions.
    const now = new Date();
    const rawNewToken = generateRawRefreshToken();
    const newTokenHash = hashRefreshToken(rawNewToken);
    const expiresAt = new Date(Date.now() + parseDurationMs(this.refreshExpiresIn));

    const revokeResult = await this.db.authSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    });

    if (revokeResult.count === 0) {
      // Token déjà révoqué entre le findUnique et ici → replay attack probable
      await this.db.authSession.updateMany({
        where: { userId: session.userId },
        data: { revokedAt: now },
      });
      const err = new Error('Refresh token déjà utilisé');
      (err as NodeJS.ErrnoException).code = 'INVALID_REFRESH_TOKEN';
      throw err;
    }

    await this.db.authSession.create({
      data: {
        userId: session.userId,
        refreshTokenHash: newTokenHash,
        userAgent: meta.userAgent ?? session.userAgent,
        ipAddress: meta.ipAddress ?? session.ipAddress,
        expiresAt,
      },
    });

    const accessPayload = this._buildAccessPayload(session.user);
    const accessToken = this.tokenGenerator.signAccessToken(accessPayload);
    const refreshToken = rawNewToken;
    const expiresIn = this.tokenGenerator.accessExpiresInSeconds;

    return { accessToken, refreshToken, expiresIn };
  }

  // ------------------------------------------------------------------
  // logout — révocation du refresh token courant
  // ------------------------------------------------------------------

  async logout(
    rawRefreshToken: string,
  ): Promise<void> {
    const tokenHash = hashRefreshToken(rawRefreshToken);

    const session = await this.db.authSession.findUnique({
      where: { refreshTokenHash: tokenHash },
    });

    if (!session || session.revokedAt != null) {
      // Déjà révoqué ou inconnu : on ignore silencieusement (idempotent)
      return;
    }

    await this.db.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }

  // ------------------------------------------------------------------
  // Helpers privés
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // verifyOtp — vérifie le code OTP et émet les tokens (inscription)
  // ou confirme l'identité (reset mot de passe)
  // ------------------------------------------------------------------

  async verifyRegistrationOtp(
    target: string,
    code: string,
    meta: { ipAddress?: string; userAgent?: string; deviceId?: string } = {},
  ): Promise<AuthResult> {
    const deviceId = meta.deviceId ?? 'unknown';
    await this._checkAndIncrementVerifyLimit(target, deviceId);

    const codeHash = this._hashOtp(code);
    const now = new Date();

    const otp = await this.db.otpCode.findFirst({
      where: {
        target,
        codeHash,
        purpose: OtpPurpose.REGISTRATION_VERIFY,
        usedAt: null,
        expiresAt: { gt: now },
      },
      include: { user: { include: { travelerProfile: true, memberships: { include: { cooperative: true }, where: { active: true } }, adminProfile: true } } },
    });

    if (!otp || !otp.user) {
      await this.db.auditLog.create({ data: { action: 'OTP_FAILED', entityType: 'OtpCode', entityId: null, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null } });
      const err = new Error('Code invalide ou expiré');
      (err as NodeJS.ErrnoException).code = 'OTP_INVALID';
      throw err;
    }

    await this.db.$transaction([
      this.db.otpCode.update({ where: { id: otp.id }, data: { usedAt: now } }),
      // Marquer le compte comme vérifié
      otp.target.startsWith('+')
        ? this.db.user.update({ where: { id: otp.user.id }, data: { phoneVerifiedAt: now } })
        : this.db.user.update({ where: { id: otp.user.id }, data: { emailVerifiedAt: now } }),
      this.db.auditLog.create({ data: { actorUserId: otp.user.id, action: 'OTP_VERIFIED', entityType: 'User', entityId: otp.user.id, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null } }),
    ]);

    // Réinitialiser les compteurs de vérification
    await this.db.otpRateLimit.updateMany({
      where: { target, deviceId },
      data: { verifyCount: 0 },
    });

    const updatedUser = { ...otp.user, phoneVerifiedAt: now };
    return this._issueTokens(updatedUser as typeof otp.user, meta);
  }

  // ------------------------------------------------------------------
  // resendOtp — renvoie un nouveau code (limité en fréquence)
  // ------------------------------------------------------------------

  async resendOtp(
    target: string,
    purpose: OtpPurpose,
    deviceId?: string,
    lang?: Lang,
  ): Promise<{ _devCode?: string }> {
    const effectiveLang = lang ?? Lang.FR;
    const dId = deviceId ?? 'unknown';

    // Vérifier lockout
    const rl = await this.db.otpRateLimit.findUnique({ where: { target_deviceId: { target, deviceId: dId } } });
    if (rl?.lockedUntil && rl.lockedUntil > new Date()) {
      const err = new Error('Trop de tentatives — réessayez dans 24h');
      (err as NodeJS.ErrnoException).code = 'OTP_TARGET_LOCKED';
      throw err;
    }

    // Trouver le user pour REGISTRATION_VERIFY
    let userId: string | undefined;
    if (purpose === OtpPurpose.REGISTRATION_VERIFY) {
      const user = await this.db.user.findFirst({ where: target.startsWith('+') ? { phone: target } : { email: target } });
      userId = user?.id;
    } else {
      const user = await this.db.user.findFirst({ where: target.startsWith('+') ? { phone: target } : { email: target } });
      userId = user?.id;
    }

    const { devCode } = await this._generateAndSendOtp(userId ?? null, target, purpose, effectiveLang, dId);
    return devCode ? { _devCode: devCode } : {};
  }

  // ------------------------------------------------------------------
  // sendPasswordResetOtp — démarre le flux reset mot de passe
  // ------------------------------------------------------------------

  async sendPasswordResetOtp(target: string, deviceId?: string): Promise<void> {
    const user = await this.db.user.findFirst({
      where: target.startsWith('+') ? { phone: target } : { email: target },
    });

    // Ne pas révéler si le compte existe ou non (timing-safe)
    if (!user || user.status !== 'ACTIVE') return;

    await this._generateAndSendOtp(user.id, target, OtpPurpose.PASSWORD_RESET, user.preferredLang, deviceId);
    // Note : on ne retourne pas _devCode ici — le reset password est hors flux d'inscription
  }

  // ------------------------------------------------------------------
  // resetPassword — vérifie OTP et met à jour le mot de passe
  // ------------------------------------------------------------------

  async resetPassword(target: string, code: string, newPassword: string, deviceId?: string): Promise<void> {
    const dId = deviceId ?? 'unknown';
    await this._checkAndIncrementVerifyLimit(target, dId);

    const codeHash = this._hashOtp(code);
    const now = new Date();

    const otp = await this.db.otpCode.findFirst({
      where: { target, codeHash, purpose: OtpPurpose.PASSWORD_RESET, usedAt: null, expiresAt: { gt: now } },
      include: { user: true },
    });

    if (!otp || !otp.user) {
      await this.db.auditLog.create({ data: { action: 'OTP_FAILED', entityType: 'OtpCode', entityId: null } });
      const err = new Error('Code invalide ou expiré');
      (err as NodeJS.ErrnoException).code = 'OTP_INVALID';
      throw err;
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });

    await this.db.$transaction([
      this.db.otpCode.update({ where: { id: otp.id }, data: { usedAt: now } }),
      this.db.user.update({ where: { id: otp.user.id }, data: { passwordHash } }),
      // Révoquer toutes les sessions sauf la courante — précaution sécurité
      this.db.authSession.updateMany({ where: { userId: otp.user.id, revokedAt: null }, data: { revokedAt: now } }),
      this.db.auditLog.create({ data: { actorUserId: otp.user.id, action: 'PASSWORD_RESET', entityType: 'User', entityId: otp.user.id } }),
    ]);
  }

  // ------------------------------------------------------------------
  // getSessions — liste les sessions actives + contextes coopératives
  // ------------------------------------------------------------------

  async getSessions(userId: string): Promise<SessionsResult> {
    const [sessions, memberships] = await Promise.all([
      this.db.authSession.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.membership.findMany({
        where: { userId, active: true },
        include: { cooperative: { select: { id: true, displayName: true } } },
      }),
    ]);

    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceId: s.deviceId,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
      cooperativeContexts: memberships.map((m) => ({
        coopId: m.cooperativeId,
        coopName: m.cooperative.displayName,
        role: m.role,
      })),
    };
  }

  // ------------------------------------------------------------------
  // revokeSession — révoque une session spécifique
  // ------------------------------------------------------------------

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.db.authSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      const err = new Error('Session introuvable');
      (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
      throw err;
    }
    await this.db.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await this.db.auditLog.create({ data: { actorUserId: userId, action: 'SESSION_REVOKED', entityType: 'AuthSession', entityId: sessionId } });
  }

  // ------------------------------------------------------------------
  // revokeAllSessions — révoque toutes les sessions (changement de mdp, etc.)
  // ------------------------------------------------------------------

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.db.auditLog.create({ data: { actorUserId: userId, action: 'SESSION_REVOKED', entityType: 'AuthSession', entityId: userId } });
  }

  // ------------------------------------------------------------------
  // Helpers privés OTP
  // ------------------------------------------------------------------

  private _hashOtp(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  private async _generateAndSendOtp(
    userId: string | null | undefined,
    target: string,
    purpose: OtpPurpose,
    lang: Lang,
    deviceId?: string,
  ): Promise<{ devCode?: string }> {
    const dId = deviceId ?? 'unknown';

    // Vérifier rate limit envoi (max 5 par heure par target)
    const rl = await this.db.otpRateLimit.upsert({
      where: { target_deviceId: { target, deviceId: dId } },
      create: { target, deviceId: dId, sendCount: 1, sendWindowStart: new Date() },
      update: {},
    });

    const windowAge = Date.now() - rl.sendWindowStart.getTime();
    const inWindow = windowAge < 3_600_000; // 1 heure
    if (inWindow && rl.sendCount >= 5) {
      const err = new Error('Trop d\'envois OTP — réessayez dans 1h');
      (err as NodeJS.ErrnoException).code = 'OTP_RATE_LIMITED';
      throw err;
    }

    // Réinitialiser fenêtre si expirée
    await this.db.otpRateLimit.update({
      where: { target_deviceId: { target, deviceId: dId } },
      data: inWindow
        ? { sendCount: { increment: 1 } }
        : { sendCount: 1, sendWindowStart: new Date() },
    });

    // Invalider les codes précédents non utilisés du même purpose
    await this.db.otpCode.updateMany({
      where: { target, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });

    // Générer le code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = this._hashOtp(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await this.db.otpCode.create({
      data: { userId: userId ?? null, target, codeHash, purpose, expiresAt },
    });

    const smsText: Record<OtpPurpose, Record<Lang, string>> = {
      [OtpPurpose.REGISTRATION_VERIFY]: {
        [Lang.FR]: `InsTRAM: Votre code de vérification est ${code}. Expire dans 10 min.`,
        [Lang.MG]: `InsTRAM: Ny kaody fanamafisanao: ${code}. Lany amin'ny 10 min.`,
      },
      [OtpPurpose.PASSWORD_RESET]: {
        [Lang.FR]: `InsTRAM: Votre code de réinitialisation: ${code}. Expire dans 10 min.`,
        [Lang.MG]: `InsTRAM: Ny kaody fanavaozana: ${code}. Lany amin'ny 10 min.`,
      },
    };

    const emailSubject: Record<OtpPurpose, Record<Lang, string>> = {
      [OtpPurpose.REGISTRATION_VERIFY]: {
        [Lang.FR]: 'InsTRAM — Vérification de votre compte',
        [Lang.MG]: 'InsTRAM — Fanamafisana ny kaontinao',
      },
      [OtpPurpose.PASSWORD_RESET]: {
        [Lang.FR]: 'InsTRAM — Réinitialisation du mot de passe',
        [Lang.MG]: 'InsTRAM — Fanavaozana ny tenimiafina',
      },
    };

    const isPhone = target.startsWith('+');

    if (isPhone) {
      const sms = createSmsProvider();
      await sms.send({ to: target, text: smsText[purpose][lang], lang: lang as 'FR' | 'MG' });
    } else {
      const text = smsText[purpose][lang];
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="color:#205E98;margin-bottom:4px">InsTRAM</h2>
<p style="color:#374151">${lang === Lang.FR ? 'Votre code de vérification :' : 'Ny kaody fanamafisanao :'}</p>
<p style="font-size:36px;font-weight:bold;color:#162E49;letter-spacing:10px;text-align:center;padding:20px;background:#F3F4F6;border-radius:8px;margin:16px 0">${code}</p>
<p style="color:#6B7280;font-size:13px">${lang === Lang.FR ? 'Ce code expire dans 10 minutes.' : 'Lany amin\'ny 10 minitra ity kaody ity.'}</p>
</body></html>`;
      const email = createEmailProvider();
      await email.send({ to: target, subject: emailSubject[purpose][lang], text, html });
    }

    await this.db.auditLog.create({
      data: {
        actorUserId: userId ?? null,
        action: 'OTP_SENT',
        entityType: 'OtpCode',
        entityId: null,
      },
    });

    // En DEV : retourner le code en clair pour la bannière de test
    const devCode = process.env.NODE_ENV !== 'production' ? code : undefined;
    return { devCode };
  }

  private async _checkAndIncrementVerifyLimit(target: string, deviceId: string): Promise<void> {
    const rl = await this.db.otpRateLimit.findUnique({ where: { target_deviceId: { target, deviceId } } });

    if (rl?.lockedUntil && rl.lockedUntil > new Date()) {
      const err = new Error('Trop de tentatives — réessayez dans 24h');
      (err as NodeJS.ErrnoException).code = 'OTP_TARGET_LOCKED';
      throw err;
    }

    const windowAge = rl ? Date.now() - rl.verifyWindowStart.getTime() : Infinity;
    const inWindow = windowAge < 3_600_000;
    const newCount = inWindow ? (rl?.verifyCount ?? 0) + 1 : 1;
    const locked = newCount >= 10;

    await this.db.otpRateLimit.upsert({
      where: { target_deviceId: { target, deviceId } },
      create: { target, deviceId, verifyCount: 1, verifyWindowStart: new Date(), lockedUntil: null },
      update: inWindow
        ? { verifyCount: { increment: 1 }, lockedUntil: locked ? new Date(Date.now() + 86_400_000) : null }
        : { verifyCount: 1, verifyWindowStart: new Date(), lockedUntil: null },
    });

    if (locked) {
      const err = new Error('Compte bloqué 24h suite à trop d\'échecs OTP');
      (err as NodeJS.ErrnoException).code = 'OTP_TARGET_LOCKED';
      throw err;
    }
  }

  private async _issueTokens(
    user: User & {
      travelerProfile: { firstName: string; lastName: string; mobileMoneyPhone: string | null } | null;
      memberships: Array<{ cooperativeId: string; role: string; cooperative: { id: string; displayName: string } }>;
      adminProfile: { role: string } | null;
    },
    meta: { ipAddress?: string; userAgent?: string; deviceId?: string },
  ): Promise<AuthResult> {
    const accessPayload = this._buildAccessPayload(user);
    const accessToken = this.tokenGenerator.signAccessToken(accessPayload);

    const rawRefreshToken = generateRawRefreshToken();
    const refreshTokenHash = hashRefreshToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + parseDurationMs(this.refreshExpiresIn));

    await this.db.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        deviceId: meta.deviceId ?? null,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt,
      },
    });

    const safeUser = this._toSafeUser(user);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: this.tokenGenerator.accessExpiresInSeconds,
      user: safeUser,
    };
  }

  private _buildAccessPayload(user: User & {
    memberships: Array<{ cooperativeId: string; role: string }>;
    adminProfile: { role: string } | null;
  }): object {
    const roles: string[] = [];

    // Rôle voyageur implicite si pas de profil admin
    if (!user.adminProfile) {
      roles.push('TRAVELER');
    } else {
      roles.push(user.adminProfile.role);
    }

    // Rôles coopérative
    for (const m of user.memberships) {
      if (!roles.includes(m.role)) roles.push(m.role);
    }

    return {
      sub: user.id,
      roles,
    };
  }

  private _toSafeUser(user: User & {
    travelerProfile: { firstName: string; lastName: string; mobileMoneyPhone: string | null } | null;
    memberships: Array<{ cooperativeId: string; role: string; cooperative: { id: string; displayName: string } }>;
    adminProfile: { role: string } | null;
  }): SafeUser {
    const roles: string[] = [];
    if (!user.adminProfile) {
      roles.push('TRAVELER');
    } else {
      roles.push(user.adminProfile.role);
    }
    for (const m of user.memberships) {
      if (!roles.includes(m.role)) roles.push(m.role);
    }

    return {
      id: user.id,
      email: user.email ?? null,
      phone: user.phone ?? null,
      preferredLang: user.preferredLang,
      roles,
      cooperatives: user.memberships.map((m) => ({
        id: m.cooperativeId,
        displayName: m.cooperative.displayName,
        role: m.role,
      })),
      traveler: user.travelerProfile
        ? {
            firstName: user.travelerProfile.firstName,
            lastName: user.travelerProfile.lastName,
            mobileMoneyPhone: user.travelerProfile.mobileMoneyPhone ?? null,
          }
        : null,
    };
  }

  // ------------------------------------------------------------------
  // updateMe — mise à jour du profil voyageur
  // ------------------------------------------------------------------

  async updateMe(userId: string, input: UpdateMeInput): Promise<SafeUser> {
    await this.db.$transaction(async (tx) => {
      if (input.preferredLang !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { preferredLang: input.preferredLang as Lang },
        });
      }

      const profileData: Record<string, unknown> = {};
      if (input.firstName !== undefined) profileData.firstName = input.firstName;
      if (input.lastName !== undefined) profileData.lastName = input.lastName;
      if (input.mobileMoneyPhone !== undefined) {
        profileData.mobileMoneyPhone = input.mobileMoneyPhone || null;
      }

      if (Object.keys(profileData).length > 0) {
        await tx.travelerProfile.update({
          where: { userId },
          data: profileData,
        });
      }
    });

    return this.getMe(userId);
  }

  // ------------------------------------------------------------------
  // getMe — profil complet de l'utilisateur connecté
  // ------------------------------------------------------------------

  async getMe(userId: string): Promise<SafeUser> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        travelerProfile: true,
        memberships: { include: { cooperative: true }, where: { active: true } },
        adminProfile: true,
      },
    });
    if (!user) {
      const err = new Error('Utilisateur introuvable');
      (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
      throw err;
    }
    return this._toSafeUser(user);
  }

  // ------------------------------------------------------------------
  // acceptInvitation — POST /auth/invitations/:token/accept
  // ------------------------------------------------------------------

  async acceptInvitation(
    rawToken: string,
    password: string,
    firstName?: string,
    lastName?: string,
    meta: { ipAddress?: string; userAgent?: string; deviceId?: string } = {},
  ): Promise<AuthResult> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const invitation = await this.db.invitation.findUnique({ where: { tokenHash } });

    if (!invitation) {
      const err = new Error('Invitation introuvable ou déjà utilisée');
      (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
      throw err;
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      const err = new Error('Invitation déjà utilisée ou révoquée');
      (err as NodeJS.ErrnoException).code = 'INVITATION_ALREADY_USED';
      throw err;
    }
    if (invitation.expiresAt < new Date()) {
      await this.db.invitation.update({ where: { id: invitation.id }, data: { status: InvitationStatus.EXPIRED } });
      const err = new Error('Invitation expirée');
      (err as NodeJS.ErrnoException).code = 'INVITATION_EXPIRED';
      throw err;
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
    const now = new Date();

    const existing = invitation.email
      ? await this.db.user.findUnique({ where: { email: invitation.email } })
      : invitation.phone
        ? await this.db.user.findUnique({ where: { phone: invitation.phone } })
        : null;

    let createdUserId: string;

    await this.db.$transaction(async (tx) => {
      let userId: string;
      if (existing) {
        userId = existing.id;
        await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      } else {
        const user = await tx.user.create({
          data: {
            email: invitation.email ?? null,
            phone: invitation.phone ?? null,
            passwordHash,
            status: 'ACTIVE',
            emailVerifiedAt: invitation.email ? now : null,
            phoneVerifiedAt: invitation.phone ? now : null,
            travelerProfile: {
              create: { firstName: firstName ?? '', lastName: lastName ?? '' },
            },
          },
        });
        userId = user.id;
        await tx.auditLog.create({
          data: { actorUserId: userId, action: 'USER_CREATED', entityType: 'User', entityId: userId, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null },
        });
      }
      await tx.membership.upsert({
        where: { userId_cooperativeId_role: { userId, cooperativeId: invitation.cooperativeId, role: invitation.role } },
        create: { userId, cooperativeId: invitation.cooperativeId, role: invitation.role, active: true },
        update: { active: true },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: now },
      });
      createdUserId = userId;
    });

    const finalUser = await this.db.user.findUniqueOrThrow({
      where: { id: createdUserId! },
      include: {
        travelerProfile: true,
        memberships: { include: { cooperative: true }, where: { active: true } },
        adminProfile: true,
      },
    });

    return this._issueTokens(finalUser, meta);
  }

  private async _recordFailedLogin(
    userId: string | null,
    meta: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.db.auditLog.create({
      data: {
        actorUserId: userId ?? null,
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: userId ?? null,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });
  }
}
