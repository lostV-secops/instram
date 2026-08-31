import type { PrismaClient } from '@prisma/client';
import type { ParsedChannel } from './channels';

// =====================================================================
// InsTRAM — Autorisation d'abonnement à un canal WebSocket
// Source : docs/architecture.md §2.3
//
// PRINCIPE : le JWT prouve QUI est le client, jamais CE À QUOI il a droit
// sur un canal donné. Le payload d'access token produit par
// `modules/auth/auth.service.ts` ne contient que `{ sub, roles }` — il ne
// porte PAS la liste des coopératives de l'utilisateur. Les canaux
// `cooperative:{id}` et `driver:{tripId}` exigent donc une vérification
// serveur en base (table `Membership`), sinon n'importe quel employé d'une
// coopérative pourrait écouter le tableau de bord d'une concurrente.
//
// Le contrôle se fait en deux temps :
//   1. filtre rapide sur les rôles du token (aucun accès DB si le rôle
//      requis est absent) ;
//   2. vérification d'appartenance en base pour la ressource précise.
// =====================================================================

export interface WsPrincipal {
  userId: string;
  roles: string[];
}

export interface WsAuthorizer {
  /** L'utilisateur a-t-il une adhésion active (rôle COOP_*) à cette coopérative ? */
  isCooperativeMember(userId: string, cooperativeId: string): Promise<boolean>;
  /** L'utilisateur est-il conducteur actif de la coopérative propriétaire du trajet ? */
  isTripDriver(userId: string, tripInstanceId: string): Promise<boolean>;
}

export type AuthorizationResult =
  | { ok: true }
  | { ok: false; code: 'FORBIDDEN_CHANNEL'; message: string };

const DENIED = (message: string): AuthorizationResult => ({
  ok: false,
  code: 'FORBIDDEN_CHANNEL',
  message,
});

/** Vrai si le token porte au moins un rôle coopérative. */
export function hasAnyCoopRole(roles: string[]): boolean {
  return roles.some((r) => r.startsWith('COOP_'));
}

/**
 * Décide si `principal` peut s'abonner à `parsed`.
 *
 * - `trip:{id}`         : tout utilisateur authentifié (la carte des sièges
 *                         est publique une fois connecté — elle ne révèle
 *                         aucune donnée personnelle, seulement des statuts).
 * - `booking:{userId}`  : uniquement le propriétaire du canal.
 * - `cooperative:{id}`  : rôle COOP_* ET adhésion active à CETTE coopérative.
 * - `driver:{tripId}`   : rôle COOP_DRIVER ET adhésion à la coopérative du trajet.
 */
export async function authorizeChannel(
  principal: WsPrincipal,
  parsed: ParsedChannel,
  authorizer: WsAuthorizer,
): Promise<AuthorizationResult> {
  switch (parsed.kind) {
    case 'trip':
      return { ok: true };

    case 'booking':
      return parsed.id === principal.userId
        ? { ok: true }
        : DENIED('Canal de réservation réservé à son propriétaire');

    case 'cooperative': {
      if (!hasAnyCoopRole(principal.roles)) {
        return DENIED('Rôle coopérative requis');
      }
      const member = await authorizer.isCooperativeMember(principal.userId, parsed.id);
      return member
        ? { ok: true }
        : DENIED('Aucune adhésion active à cette coopérative');
    }

    case 'driver': {
      if (!principal.roles.includes('COOP_DRIVER')) {
        return DENIED('Rôle COOP_DRIVER requis');
      }
      const driver = await authorizer.isTripDriver(principal.userId, parsed.id);
      return driver
        ? { ok: true }
        : DENIED('Conducteur non rattaché à la coopérative de ce trajet');
    }

    default:
      return DENIED('Canal inconnu');
  }
}

// ---------------------------------------------------------------------
// Implémentation Prisma
// ---------------------------------------------------------------------

/**
 * Autorisateur adossé à PostgreSQL. Les réponses sont mises en cache en
 * mémoire pour une durée très courte : un client WS peut renvoyer plusieurs
 * `subscribe` (reconnexions 3G fréquentes sur la cible Madagascar), on ne
 * veut pas une requête SQL par tentative. Le TTL court garantit qu'une
 * révocation d'adhésion prend effet en quelques secondes.
 */
export function createPrismaAuthorizer(
  db: PrismaClient,
  cacheTtlMs = 30_000,
): WsAuthorizer {
  const cache = new Map<string, { value: boolean; expiresAt: number }>();

  const memo = async (key: string, compute: () => Promise<boolean>): Promise<boolean> => {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value;

    const value = await compute();
    cache.set(key, { value, expiresAt: now + cacheTtlMs });

    // Purge paresseuse — évite une croissance non bornée sur un process long.
    if (cache.size > 5000) {
      for (const [k, v] of cache) {
        if (v.expiresAt <= now) cache.delete(k);
      }
    }
    return value;
  };

  return {
    async isCooperativeMember(userId: string, cooperativeId: string): Promise<boolean> {
      return memo(`coop:${userId}:${cooperativeId}`, async () => {
        const membership = await db.membership.findFirst({
          where: { userId, cooperativeId, active: true },
          select: { id: true },
        });
        return membership !== null;
      });
    },

    async isTripDriver(userId: string, tripInstanceId: string): Promise<boolean> {
      return memo(`driver:${userId}:${tripInstanceId}`, async () => {
        const trip = await db.tripInstance.findUnique({
          where: { id: tripInstanceId },
          select: { cooperativeId: true },
        });
        if (!trip) return false;

        const membership = await db.membership.findFirst({
          where: {
            userId,
            cooperativeId: trip.cooperativeId,
            role: 'COOP_DRIVER',
            active: true,
          },
          select: { id: true },
        });
        return membership !== null;
      });
    },
  };
}

/** Autorisateur permissif — usage strictement réservé aux tests unitaires. */
export const allowAllAuthorizer: WsAuthorizer = {
  isCooperativeMember: async () => true,
  isTripDriver: async () => true,
};
