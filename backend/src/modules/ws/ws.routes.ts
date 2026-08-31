import type { FastifyInstance } from 'fastify';
import prisma from '../../infra/db/prisma';
import { registerWsServer, getWsHub } from '../../infra/ws/server';
import { createPrismaAuthorizer } from '../../infra/ws/authorization';

// =====================================================================
// InsTRAM — Module WS : câblage du serveur temps réel dans l'application
//
// Enregistré à la racine (hors préfixe /v1) : l'URL de connexion est
// `wss://api.instram.mg/ws?token=<jwt>` (architecture §2.3). Le protocole
// WS n'est pas versionné par l'URL — le champ `type` de chaque WsEvent
// joue ce rôle, et un client qui reçoit un type inconnu doit l'ignorer.
// =====================================================================

export default async function wsRoutes(fastify: FastifyInstance): Promise<void> {
  await registerWsServer(fastify, {
    path: '/ws',
    authorizer: createPrismaAuthorizer(prisma),
  });

  // Sonde d'observabilité : nombre de connexions et de canaux portés par
  // CETTE instance. Utile pour vérifier l'équilibrage derrière le
  // load-balancer et pour détecter une fuite de connexions en production.
  fastify.get(
    '/ws/stats',
    { config: { rateLimit: { max: 30, timeWindow: '1m' } } },
    async (_req, reply) => {
      const hub = getWsHub();
      return reply.status(200).send({
        clients: hub.clientCount(),
        channels: hub.channelCount(),
        instance: process.env.HOSTNAME ?? 'local',
      });
    },
  );
}
