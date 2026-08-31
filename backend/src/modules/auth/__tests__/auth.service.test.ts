/**
 * Tests unitaires du module auth — AuthService
 *
 * Hypothèses documentées :
 * 1. Les tests utilisent un mock complet de PrismaClient (pas de vraie DB).
 * 2. Le TokenGenerator est un stub déterministe pour des assertions prévisibles.
 * 3. argon2.hash et argon2.verify sont mockés pour la vitesse (les tests ne valident
 *    pas l'algorithme de hashage lui-même, qui est une dépendance externe).
 * 4. La rotation du refresh token invalide l'ancien hash et en crée un nouveau distinct.
 * 5. Un token révoqué déclenche la révocation de toutes les sessions actives (défense replay).
 */

import { AuthService, TokenGenerator } from '../auth.service';
import { PrismaClient, Lang, UserStatus } from '@prisma/client';
import argon2 from 'argon2';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('argon2');
const argon2Mock = argon2 as jest.Mocked<typeof argon2>;

// Stub TokenGenerator
const stubTokenGenerator: TokenGenerator = {
  accessExpiresInSeconds: 900,
  signAccessToken: jest.fn(() => 'stub-access-token'),
  signRefreshToken: jest.fn(() => 'stub-refresh-token'),
};

// Helper pour créer un mock Prisma minimal
function createPrismaMock() {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    authSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

// Utilisateur factice réutilisable
const fakeUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  phone: null,
  passwordHash: '$argon2id$fakehash',
  preferredLang: Lang.FR,
  status: UserStatus.ACTIVE,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  emailVerifiedAt: null,
  phoneVerifiedAt: null,
  deletionRequestedAt: null,
  anonymizedAt: null,
  travelerProfile: {
    firstName: 'Jean',
    lastName: 'Dupont',
    mobileMoneyPhone: null,
  },
  memberships: [],
  adminProfile: null,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock = createPrismaMock();
    service = new AuthService(
      prismaMock as unknown as PrismaClient,
      stubTokenGenerator,
      '30d',
    );
  });

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------

  describe('register', () => {
    it('crée un utilisateur, une session, et retourne des tokens', async () => {
      // Arrange
      prismaMock.user.findUnique.mockResolvedValue(null); // pas de doublon
      argon2Mock.hash.mockResolvedValue('$argon2id$hashed' as never);

      // $transaction exécute le callback
      prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        // On simule le comportement de la transaction
        const fakeTx = {
          user: {
            create: jest.fn().mockResolvedValue(fakeUser),
          },
          auditLog: {
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(fakeTx);
      });

      prismaMock.authSession.create.mockResolvedValue({
        id: 'session-1',
        userId: fakeUser.id,
        refreshTokenHash: 'hash',
        expiresAt: new Date(),
        createdAt: new Date(),
        revokedAt: null,
        userAgent: null,
        ipAddress: null,
      });

      // Act
      const result = await service.register({
        email: 'test@example.com',
        password: 'password123456',
        firstName: 'Jean',
        lastName: 'Dupont',
        preferredLang: 'FR',
      });

      // Assert
      expect(result.accessToken).toBe('stub-access-token');
      expect(result.refreshToken).toBeTruthy();
      expect(result.expiresIn).toBe(900);
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.roles).toContain('TRAVELER');
      expect(argon2Mock.hash).toHaveBeenCalledWith(
        'password123456',
        expect.objectContaining({ type: argon2.argon2id }),
      );
    });

    it('rejette si email déjà utilisé (code DUPLICATE_EMAIL)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(fakeUser);

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'password123456',
          firstName: 'Jean',
          lastName: 'Dupont',
          preferredLang: 'FR',
        }),
      ).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });
    });
  });

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------

  describe('login', () => {
    it('retourne des tokens pour des identifiants valides', async () => {
      // Arrange
      prismaMock.user.findUnique.mockResolvedValue(fakeUser);
      argon2Mock.verify.mockResolvedValue(true as never);
      prismaMock.user.update.mockResolvedValue(fakeUser);
      prismaMock.authSession.create.mockResolvedValue({
        id: 'session-1',
        userId: fakeUser.id,
        refreshTokenHash: 'hash',
        expiresAt: new Date(),
        createdAt: new Date(),
        revokedAt: null,
        userAgent: null,
        ipAddress: null,
      });

      // Act
      const result = await service.login({
        email: 'test@example.com',
        password: 'password123456',
      });

      // Assert
      expect(result.accessToken).toBe('stub-access-token');
      expect(result.refreshToken).toBeTruthy();
      expect(result.user.id).toBe(fakeUser.id);
    });

    it('rejette avec INVALID_CREDENTIALS si mot de passe incorrect', async () => {
      prismaMock.user.findUnique.mockResolvedValue(fakeUser);
      argon2Mock.verify.mockResolvedValue(false as never);
      // auditLog.create pour le login échoué
      prismaMock.auditLog.create.mockResolvedValue({});

      await expect(
        service.login({ email: 'test@example.com', password: 'mauvais_mdp' }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('rejette avec INVALID_CREDENTIALS si utilisateur inexistant', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.auditLog.create.mockResolvedValue({});

      await expect(
        service.login({ email: 'nobody@example.com', password: 'password123456' }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('rejette si compte suspendu', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...fakeUser,
        status: UserStatus.SUSPENDED,
      });
      argon2Mock.verify.mockResolvedValue(true as never);

      await expect(
        service.login({ email: 'test@example.com', password: 'password123456' }),
      ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
    });
  });

  // -------------------------------------------------------------------------
  // refresh — rotation
  // -------------------------------------------------------------------------

  describe('refresh', () => {
    it('retourne de nouveaux tokens et révoque l\'ancien', async () => {
      const futureDate = new Date(Date.now() + 86_400_000);
      const fakeSession = {
        id: 'session-1',
        userId: fakeUser.id,
        refreshTokenHash: 'willbecomputedbyhash',
        revokedAt: null,
        expiresAt: futureDate,
        userAgent: null,
        ipAddress: null,
        createdAt: new Date(),
        user: fakeUser,
      };

      prismaMock.authSession.findUnique.mockResolvedValue(fakeSession);

      // $transaction pour la rotation
      prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => {
        return Promise.all(ops);
      });

      prismaMock.authSession.update.mockResolvedValue({
        ...fakeSession,
        revokedAt: new Date(),
      });
      prismaMock.authSession.create.mockResolvedValue({
        id: 'session-2',
        userId: fakeUser.id,
        refreshTokenHash: 'newhash',
        expiresAt: futureDate,
        createdAt: new Date(),
        revokedAt: null,
        userAgent: null,
        ipAddress: null,
      });

      const result = await service.refresh('some-valid-raw-token');

      expect(result.accessToken).toBe('stub-access-token');
      expect(result.refreshToken).toBeTruthy();
      // L'ancien hash a bien été révoqué
      expect(prismaMock.authSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('rejette si token inconnu', async () => {
      prismaMock.authSession.findUnique.mockResolvedValue(null);

      await expect(service.refresh('invalid-token')).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
    });

    it('révoque toutes les sessions si token déjà révoqué (replay attack)', async () => {
      const fakeSession = {
        id: 'session-1',
        userId: fakeUser.id,
        refreshTokenHash: 'hash',
        revokedAt: new Date(Date.now() - 1000), // déjà révoqué
        expiresAt: new Date(Date.now() + 86_400_000),
        userAgent: null,
        ipAddress: null,
        createdAt: new Date(),
        user: fakeUser,
      };

      prismaMock.authSession.findUnique.mockResolvedValue(fakeSession);
      prismaMock.authSession.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.refresh('replayed-token')).rejects.toMatchObject({
        code: 'REFRESH_TOKEN_EXPIRED',
      });

      // Toutes les sessions actives ont été révoquées
      expect(prismaMock.authSession.updateMany).toHaveBeenCalledWith({
        where: { userId: fakeUser.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------

  describe('logout', () => {
    it('révoque la session correspondant au refresh token', async () => {
      const fakeSession = {
        id: 'session-1',
        userId: fakeUser.id,
        refreshTokenHash: 'hash',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        userAgent: null,
        ipAddress: null,
        createdAt: new Date(),
      };

      prismaMock.authSession.findUnique.mockResolvedValue(fakeSession);
      prismaMock.authSession.update.mockResolvedValue({
        ...fakeSession,
        revokedAt: new Date(),
      });

      await service.logout('some-raw-token');

      expect(prismaMock.authSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('est idempotent si token déjà révoqué', async () => {
      const fakeSession = {
        id: 'session-1',
        userId: fakeUser.id,
        refreshTokenHash: 'hash',
        revokedAt: new Date(), // déjà révoqué
        expiresAt: new Date(Date.now() + 86_400_000),
        userAgent: null,
        ipAddress: null,
        createdAt: new Date(),
      };

      prismaMock.authSession.findUnique.mockResolvedValue(fakeSession);

      // Ne doit pas lever d'exception
      await expect(service.logout('some-raw-token')).resolves.toBeUndefined();
      expect(prismaMock.authSession.update).not.toHaveBeenCalled();
    });

    it('est idempotent si token inconnu', async () => {
      prismaMock.authSession.findUnique.mockResolvedValue(null);

      await expect(service.logout('unknown-token')).resolves.toBeUndefined();
      expect(prismaMock.authSession.update).not.toHaveBeenCalled();
    });
  });
});
