import argon2 from 'argon2';
import crypto from 'crypto';
import { PrismaClient, User, Lang } from '@prisma/client';
import { RegisterInput, LoginInput } from './auth.schema';

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
  // register
  // ------------------------------------------------------------------

  async register(
    input: RegisterInput,
    meta: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<AuthResult> {
    // Vérification unicité email/phone
    if (input.email) {
      const existing = await this.db.user.findUnique({
        where: { email: input.email },
      });
      if (existing) {
        const err = new Error('Email déjà utilisé');
        (err as NodeJS.ErrnoException).code = 'DUPLICATE_EMAIL';
        throw err;
      }
    }
    if (input.phone) {
      const existing = await this.db.user.findUnique({
        where: { phone: input.phone },
      });
      if (existing) {
        const err = new Error('Téléphone déjà utilisé');
        (err as NodeJS.ErrnoException).code = 'DUPLICATE_PHONE';
        throw err;
      }
    }

    // Hash Argon2id (VH-12)
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MiB
      timeCost: 3,
      parallelism: 4,
    });

    // Création utilisateur + profil voyageur en transaction
    const user = await this.db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email ?? null,
          phone: input.phone ?? null,
          passwordHash,
          preferredLang: (input.preferredLang as Lang) ?? Lang.FR,
          travelerProfile: {
            create: {
              firstName: input.firstName,
              lastName: input.lastName,
            },
          },
        },
        include: {
          travelerProfile: true,
          memberships: { include: { cooperative: true } },
          adminProfile: true,
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

    return this._issueTokens(user, meta);
  }

  // ------------------------------------------------------------------
  // login
  // ------------------------------------------------------------------

  async login(
    input: LoginInput,
    meta: { ipAddress?: string; userAgent?: string } = {},
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
    meta: { ipAddress?: string; userAgent?: string } = {},
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

    if (session.revokedAt != null || session.expiresAt < new Date()) {
      // Token révoqué ou expiré — si révoqué, c'est peut-être une attaque de replay
      if (session.revokedAt != null) {
        // Révocation de toutes les sessions actives de l'utilisateur (défense en profondeur)
        await this.db.authSession.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      const err = new Error('Refresh token expiré ou révoqué');
      (err as NodeJS.ErrnoException).code = 'REFRESH_TOKEN_EXPIRED';
      throw err;
    }

    if (session.user.status !== 'ACTIVE') {
      const err = new Error('Compte inactif');
      (err as NodeJS.ErrnoException).code = 'ACCOUNT_INACTIVE';
      throw err;
    }

    // Rotation : révocation de l'ancien token + création d'un nouveau
    const rawNewToken = generateRawRefreshToken();
    const newTokenHash = hashRefreshToken(rawNewToken);
    const expiresAt = new Date(Date.now() + parseDurationMs(this.refreshExpiresIn));

    await this.db.$transaction([
      this.db.authSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      this.db.authSession.create({
        data: {
          userId: session.userId,
          refreshTokenHash: newTokenHash,
          userAgent: meta.userAgent ?? session.userAgent,
          ipAddress: meta.ipAddress ?? session.ipAddress,
          expiresAt,
        },
      }),
    ]);

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

  private async _issueTokens(
    user: User & {
      travelerProfile: { firstName: string; lastName: string; mobileMoneyPhone: string | null } | null;
      memberships: Array<{ cooperativeId: string; role: string; cooperative: { id: string; displayName: string } }>;
      adminProfile: { role: string } | null;
    },
    meta: { ipAddress?: string; userAgent?: string },
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
      traveler: user.travelerProfile
        ? {
            firstName: user.travelerProfile.firstName,
            lastName: user.travelerProfile.lastName,
            mobileMoneyPhone: user.travelerProfile.mobileMoneyPhone ?? null,
          }
        : null,
    };
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
