import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { CooperativeService } from './cooperative.service';
import {
  InviteMemberSchema,
  UpdateMemberSchema,
  CreateVehicleSchema,
  UpdateVehicleSchema,
  UpdateCooperativeSchema,
  UpsertPolicySchema,
} from './cooperative.schema';
import prisma from '../../infra/db/prisma';

// =====================================================================
// Plugin Fastify — module cooperative
// Préfixe attendu : /v1/coop (enregistré depuis app.ts)
//
// Contrat : docs/contrat-api.yaml §Cooperative
//
// Ambiguïtés documentées :
//   1. Le contrat expose GET /coop/cooperatives/current mais la tâche
//      demande GET /coop/me. Les deux routes sont implémentées ici.
//   2. Le contrat expose POST /coop/members (pas /members/invite).
//      La route /members/invite est ajoutée comme alias pour compatibilité
//      avec la spécification de la tâche.
//   3. Le contrat expose PATCH /coop/members/:memberId (pas :userId/role).
//      La route utilise :memberId conformément au contrat.
// =====================================================================

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

function getUserId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

export default async function cooperativeRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const service = new CooperativeService(prisma);

  // ------------------------------------------------------------------
  // GET /cooperatives/current  (et alias /me — tâche vs contrat)
  // Retourne le profil de la coopérative de l'utilisateur connecté.
  // ------------------------------------------------------------------
  const getCoopMeHandler = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      const coop = await service.getCoopMe(getUserId(req));
      return reply.send(coop);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
      if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: (err as Error).message });
      req.log.error(err, 'getCoopMe error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  };

  fastify.get(
    '/cooperatives/current',
    { onRequest: [fastify.authenticate] },
    getCoopMeHandler,
  );

  // Alias /me (demandé par la tâche, non présent dans le contrat — documenté)
  fastify.get('/me', { onRequest: [fastify.authenticate] }, getCoopMeHandler);

  // ------------------------------------------------------------------
  // PATCH /cooperatives/current — modifier le profil public de la coop
  // Réservé aux COOP_ADMIN.
  // ------------------------------------------------------------------
  fastify.patch(
    '/cooperatives/current',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseResult = UpdateCooperativeSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }
      try {
        const coop = await service.updateCoopMe(getUserId(req), parseResult.data);
        return reply.send(coop);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
        if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: (err as Error).message });
        req.log.error(err, 'updateCoopMe error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /policies/current — politique d'annulation active
  // ------------------------------------------------------------------
  fastify.get(
    '/policies/current',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { cooperativeId } = await service.requireMembership(getUserId(req));
        const policy = await service.getPolicy(cooperativeId);
        if (!policy) return reply.status(404).send({ code: 'NOT_FOUND', message: 'Aucune politique active' });
        return reply.send(policy);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
        req.log.error(err, 'getPolicy error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // PUT /policies/current — créer ou mettre à jour la politique d'annulation
  // Réservé aux COOP_ADMIN.
  // ------------------------------------------------------------------
  fastify.put(
    '/policies/current',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseResult = UpsertPolicySchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }
      try {
        const { cooperativeId } = await service.requireMembership(getUserId(req), ['COOP_ADMIN']);
        const policy = await service.upsertPolicy(cooperativeId, parseResult.data);
        return reply.send(policy);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
        req.log.error(err, 'upsertPolicy error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /members — liste des membres de la coopérative
  // ------------------------------------------------------------------
  fastify.get(
    '/members',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { cooperativeId } = await service.requireMembership(getUserId(req));
        const members = await service.getMembers(cooperativeId);
        return reply.send(members);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
        req.log.error(err, 'getMembers error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /members — inviter un membre (contrat) + alias /members/invite
  // Réservé aux COOP_ADMIN.
  // ------------------------------------------------------------------
  const inviteMemberHandler = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const parseResult = InviteMemberSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: formatZodError(parseResult.error),
      });
    }

    try {
      const { cooperativeId } = await service.requireMembership(getUserId(req), [
        'COOP_ADMIN',
      ]);
      const invitation = await service.inviteMember(
        cooperativeId,
        getUserId(req),
        parseResult.data,
      );
      return reply.status(201).send(invitation);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
      if (code === 'CONFLICT') return reply.status(409).send({ code, message: (err as Error).message });
      req.log.error(err, 'inviteMember error');
      return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
    }
  };

  fastify.post('/members', { onRequest: [fastify.authenticate] }, inviteMemberHandler);
  // Alias /members/invite (tâche) — non dans le contrat, documenté
  fastify.post('/members/invite', { onRequest: [fastify.authenticate] }, inviteMemberHandler);

  // ------------------------------------------------------------------
  // PATCH /members/:memberId — modifier rôle ou statut d'un membre
  // Réservé aux COOP_ADMIN.
  // ------------------------------------------------------------------
  fastify.patch<{ Params: { memberId: string } }>(
    '/members/:memberId',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { memberId: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = UpdateMemberSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      try {
        const { cooperativeId } = await service.requireMembership(getUserId(req), [
          'COOP_ADMIN',
        ]);
        const member = await service.updateMember(
          cooperativeId,
          req.params.memberId,
          parseResult.data,
        );
        return reply.send(member);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
        if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: (err as Error).message });
        req.log.error(err, 'updateMember error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /members/:memberId — désactiver un membre
  // Réservé aux COOP_ADMIN.
  // ------------------------------------------------------------------
  fastify.delete<{ Params: { memberId: string } }>(
    '/members/:memberId',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { memberId: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { cooperativeId } = await service.requireMembership(getUserId(req), ['COOP_ADMIN']);
        await service.deleteMember(cooperativeId, req.params.memberId);
        return reply.status(204).send();
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
        if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: (err as Error).message });
        req.log.error(err, 'deleteMember error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /vehicles — liste des véhicules de la coopérative
  // ------------------------------------------------------------------
  fastify.get(
    '/vehicles',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { cooperativeId } = await service.requireMembership(getUserId(req));
        const vehicles = await service.getVehicles(cooperativeId);
        return reply.send(vehicles);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
        req.log.error(err, 'getVehicles error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /vehicles — créer un véhicule + plan de sièges (transaction)
  // Réservé aux COOP_ADMIN.
  // ------------------------------------------------------------------
  fastify.post(
    '/vehicles',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CreateVehicleSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }

      try {
        const { cooperativeId } = await service.requireMembership(getUserId(req), [
          'COOP_ADMIN',
        ]);
        const vehicle = await service.createVehicle(cooperativeId, parseResult.data);
        return reply.status(201).send(vehicle);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
        if (code === 'CONFLICT') return reply.status(409).send({ code, message: (err as Error).message });
        req.log.error(err, 'createVehicle error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /vehicles/:vehicleId — détail véhicule + plan de sièges
  // ------------------------------------------------------------------
  fastify.get<{ Params: { vehicleId: string } }>(
    '/vehicles/:vehicleId',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { vehicleId: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { cooperativeId } = await service.requireMembership(getUserId(req));
        const vehicle = await service.getVehicle(cooperativeId, req.params.vehicleId);
        return reply.send(vehicle);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
        if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: (err as Error).message });
        req.log.error(err, 'getVehicle error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // DELETE /vehicles/:vehicleId — désactiver un véhicule
  // Réservé aux COOP_ADMIN. Bloqué si trajets actifs existent.
  // ------------------------------------------------------------------
  fastify.delete<{ Params: { vehicleId: string } }>(
    '/vehicles/:vehicleId',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { vehicleId: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { cooperativeId } = await service.requireMembership(getUserId(req), ['COOP_ADMIN']);
        await service.deleteVehicle(cooperativeId, req.params.vehicleId);
        return reply.status(204).send();
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
        if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: (err as Error).message });
        if (code === 'CONFLICT') return reply.status(409).send({ code, message: (err as Error).message });
        req.log.error(err, 'deleteVehicle error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );

  // ------------------------------------------------------------------
  // PATCH /vehicles/:vehicleId — activer/désactiver, renommer
  // Réservé aux COOP_ADMIN.
  // ------------------------------------------------------------------
  fastify.patch<{ Params: { vehicleId: string } }>(
    '/vehicles/:vehicleId',
    { onRequest: [fastify.authenticate] },
    async (
      req: FastifyRequest<{ Params: { vehicleId: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = UpdateVehicleSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: formatZodError(parseResult.error),
        });
      }
      try {
        const { cooperativeId } = await service.requireMembership(getUserId(req), ['COOP_ADMIN']);
        const vehicle = await service.updateVehicle(cooperativeId, req.params.vehicleId, parseResult.data);
        return reply.send(vehicle);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
        if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: (err as Error).message });
        req.log.error(err, 'updateVehicle error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );
}
