import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { TripsService } from './trips.service';
import { CooperativeService } from '../cooperative/cooperative.service';
import {
  CreateRouteSchema,
  UpdateRouteSchema,
  CreateScheduleSchema,
  UpdateScheduleSchema,
  CreateTripSchema,
  UpdateTripSchema,
  UpsertFaresSchema,
  TripListQuerySchema,
} from './trips.schema';
import prisma from '../../infra/db/prisma';
import redis from '../../infra/cache/redis';

// =====================================================================
// Plugin Fastify — module trips
//
// Deux groupes d'endpoints enregistrés depuis app.ts :
//   1. tripsCoopRoutes — préfixe /v1/coop (back-office coopérative)
//   2. tripsTravelerRoutes — sans préfixe supplémentaire (voyageur)
//
// Contrat : docs/contrat-api.yaml §Cooperative + §Traveler-Trips
//
// Ambiguïtés documentées :
//   - open/close : le contrat utilise POST, la tâche mentionne PATCH.
//     Implémenté en POST conformément au contrat (contrat = source de vérité).
//   - GET /coop/trips/:id/dashboard : non présent dans le contrat (le contrat
//     a GET /coop/dashboard global). Implémenté comme extension documentée.
// =====================================================================

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

function getUserId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

function getLang(req: FastifyRequest): 'fr' | 'mg' {
  const header = req.headers['accept-language'] as string | undefined;
  return header === 'mg' ? 'mg' : 'fr';
}

// =====================================================================
// Routes back-office coopérative — préfixe /v1/coop
// =====================================================================

export async function tripsCoopRoutes(fastify: FastifyInstance): Promise<void> {
  const tripsService = new TripsService(prisma, redis);
  const coopService = new CooperativeService(prisma);

  /** Helper : charge le membership actif, lève ForbiddenError si absent. */
  async function getCoopId(
    userId: string,
    roles?: ('COOP_ADMIN' | 'COOP_ASSISTANT' | 'COOP_DRIVER' | 'COOP_CONTROLLER')[],
  ): Promise<string> {
    const { cooperativeId } = await coopService.requireMembership(userId, roles);
    return cooperativeId;
  }

  function handleError(err: unknown, req: FastifyRequest, reply: FastifyReply, ctx: string) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'FORBIDDEN' || code === 'COOPERATIVE_SUSPENDED') return reply.status(403).send({ code, message: (err as Error).message });
    if (code === 'NOT_FOUND') return reply.status(404).send({ code, message: (err as Error).message });
    if (code === 'CONFLICT') return reply.status(409).send({ code, message: (err as Error).message });
    req.log.error(err, ctx);
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
  }

  // ----------------------------------------------------------------
  // GET /routes
  // ----------------------------------------------------------------
  fastify.get('/routes', { onRequest: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const cooperativeId = await getCoopId(getUserId(req));
      const routes = await tripsService.getRoutes(cooperativeId);
      return reply.send(routes);
    } catch (err) {
      return handleError(err, req, reply, 'getRoutes');
    }
  });

  // ----------------------------------------------------------------
  // POST /routes
  // ----------------------------------------------------------------
  fastify.post('/routes', { onRequest: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = CreateRouteSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });

    try {
      const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
      const route = await tripsService.createRoute(cooperativeId, parse.data);
      return reply.status(201).send(route);
    } catch (err) {
      return handleError(err, req, reply, 'createRoute');
    }
  });

  // ----------------------------------------------------------------
  // GET /routes/:routeId
  // ----------------------------------------------------------------
  fastify.get<{ Params: { routeId: string } }>(
    '/routes/:routeId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { routeId: string } }>, reply: FastifyReply) => {
      try {
        const cooperativeId = await getCoopId(getUserId(req));
        const route = await tripsService.getRoute(cooperativeId, req.params.routeId);
        return reply.send(route);
      } catch (err) {
        return handleError(err, req, reply, 'getRoute');
      }
    },
  );

  // ----------------------------------------------------------------
  // PATCH /routes/:routeId
  // ----------------------------------------------------------------
  fastify.patch<{ Params: { routeId: string } }>(
    '/routes/:routeId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { routeId: string } }>, reply: FastifyReply) => {
      const parse = UpdateRouteSchema.safeParse(req.body);
      if (!parse.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      try {
        const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
        const route = await tripsService.updateRoute(cooperativeId, req.params.routeId, parse.data);
        return reply.send(route);
      } catch (err) {
        return handleError(err, req, reply, 'updateRoute');
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /schedules
  // ----------------------------------------------------------------
  fastify.get('/schedules', { onRequest: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const cooperativeId = await getCoopId(getUserId(req));
      const schedules = await tripsService.getSchedules(cooperativeId);
      return reply.send(schedules);
    } catch (err) {
      return handleError(err, req, reply, 'getSchedules');
    }
  });

  // ----------------------------------------------------------------
  // POST /schedules
  // ----------------------------------------------------------------
  fastify.post('/schedules', { onRequest: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = CreateScheduleSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });

    try {
      const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
      const schedule = await tripsService.createSchedule(cooperativeId, parse.data);
      return reply.status(201).send(schedule);
    } catch (err) {
      return handleError(err, req, reply, 'createSchedule');
    }
  });

  // ----------------------------------------------------------------
  // PATCH /schedules/:scheduleId
  // ----------------------------------------------------------------
  fastify.patch<{ Params: { scheduleId: string } }>(
    '/schedules/:scheduleId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { scheduleId: string } }>, reply: FastifyReply) => {
      const parse = UpdateScheduleSchema.safeParse(req.body);
      if (!parse.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });

      try {
        const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
        const schedule = await tripsService.updateSchedule(cooperativeId, req.params.scheduleId, parse.data);
        return reply.send(schedule);
      } catch (err) {
        return handleError(err, req, reply, 'updateSchedule');
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /trips
  // ----------------------------------------------------------------
  fastify.get('/trips', { onRequest: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = TripListQuerySchema.safeParse(req.query);
    if (!parse.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });

    try {
      const cooperativeId = await getCoopId(getUserId(req));
      const result = await tripsService.getTrips(cooperativeId, parse.data);
      return reply.send(result);
    } catch (err) {
      return handleError(err, req, reply, 'getTrips');
    }
  });

  // ----------------------------------------------------------------
  // POST /trips
  // ----------------------------------------------------------------
  fastify.post('/trips', { onRequest: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = CreateTripSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });

    try {
      const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
      const trip = await tripsService.createTrip(cooperativeId, getUserId(req), parse.data);
      return reply.status(201).send(trip);
    } catch (err) {
      return handleError(err, req, reply, 'createTrip');
    }
  });

  // ----------------------------------------------------------------
  // GET /trips/:tripInstanceId
  // ----------------------------------------------------------------
  fastify.get<{ Params: { tripInstanceId: string } }>(
    '/trips/:tripInstanceId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { tripInstanceId: string } }>, reply: FastifyReply) => {
      try {
        const cooperativeId = await getCoopId(getUserId(req));
        const trip = await tripsService.getTrip(cooperativeId, req.params.tripInstanceId);
        return reply.send(trip);
      } catch (err) {
        return handleError(err, req, reply, 'getTrip');
      }
    },
  );

  // ----------------------------------------------------------------
  // POST /trips/:tripInstanceId/open
  // Contrat : POST (la tâche mentionne PATCH — écart documenté)
  // ----------------------------------------------------------------
  fastify.post<{ Params: { tripInstanceId: string } }>(
    '/trips/:tripInstanceId/open',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { tripInstanceId: string } }>, reply: FastifyReply) => {
      try {
        const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
        const trip = await tripsService.openTrip(cooperativeId, req.params.tripInstanceId, getUserId(req));
        return reply.send(trip);
      } catch (err) {
        return handleError(err, req, reply, 'openTrip');
      }
    },
  );

  // ----------------------------------------------------------------
  // POST /trips/:tripInstanceId/close
  // Contrat : POST (la tâche mentionne PATCH — écart documenté)
  // ----------------------------------------------------------------
  fastify.post<{ Params: { tripInstanceId: string } }>(
    '/trips/:tripInstanceId/close',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { tripInstanceId: string } }>, reply: FastifyReply) => {
      try {
        const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
        const trip = await tripsService.closeTrip(cooperativeId, req.params.tripInstanceId, getUserId(req));
        return reply.send(trip);
      } catch (err) {
        return handleError(err, req, reply, 'closeTrip');
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /trips/:tripInstanceId/fares
  // ----------------------------------------------------------------
  fastify.get<{ Params: { tripInstanceId: string } }>(
    '/trips/:tripInstanceId/fares',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { tripInstanceId: string } }>, reply: FastifyReply) => {
      try {
        const cooperativeId = await getCoopId(getUserId(req));
        const fares = await tripsService.getFares(cooperativeId, req.params.tripInstanceId);
        return reply.send(fares);
      } catch (err) {
        return handleError(err, req, reply, 'getFares');
      }
    },
  );

  // ----------------------------------------------------------------
  // PUT /trips/:tripInstanceId/fares
  // Souveraineté coopérative (RG-04) : aucune validation InsTRAM sur le prix.
  // AuditLog sur chaque tarif (RG-13).
  // ----------------------------------------------------------------
  fastify.put<{ Params: { tripInstanceId: string } }>(
    '/trips/:tripInstanceId/fares',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { tripInstanceId: string } }>, reply: FastifyReply) => {
      const parse = UpsertFaresSchema.safeParse(req.body);
      if (!parse.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });

      try {
        const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
        const fares = await tripsService.upsertFares(
          cooperativeId,
          req.params.tripInstanceId,
          getUserId(req),
          parse.data,
        );
        return reply.send(fares);
      } catch (err) {
        return handleError(err, req, reply, 'upsertFares');
      }
    },
  );

  // ----------------------------------------------------------------
  // PATCH /trips/:tripInstanceId — modifier un trajet (DRAFT uniquement)
  // ----------------------------------------------------------------
  fastify.patch<{ Params: { tripInstanceId: string } }>(
    '/trips/:tripInstanceId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { tripInstanceId: string } }>, reply: FastifyReply) => {
      const parse = UpdateTripSchema.safeParse(req.body);
      if (!parse.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: formatZodError(parse.error) });
      try {
        const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
        const trip = await tripsService.updateTrip(cooperativeId, req.params.tripInstanceId, parse.data);
        return reply.send(trip);
      } catch (err) {
        return handleError(err, req, reply, 'updateTrip');
      }
    },
  );

  // ----------------------------------------------------------------
  // DELETE /trips/:tripInstanceId — annuler un trajet (→ CANCELLED)
  // ----------------------------------------------------------------
  fastify.delete<{ Params: { tripInstanceId: string } }>(
    '/trips/:tripInstanceId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { tripInstanceId: string } }>, reply: FastifyReply) => {
      try {
        const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
        const result = await tripsService.cancelTrip(cooperativeId, req.params.tripInstanceId);
        return reply.status(200).send(result);
      } catch (err) {
        return handleError(err, req, reply, 'cancelTrip');
      }
    },
  );

  // ----------------------------------------------------------------
  // DELETE /routes/:routeId — désactiver une route
  // ----------------------------------------------------------------
  fastify.delete<{ Params: { routeId: string } }>(
    '/routes/:routeId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { routeId: string } }>, reply: FastifyReply) => {
      try {
        const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
        await tripsService.deleteRoute(cooperativeId, req.params.routeId);
        return reply.status(204).send();
      } catch (err) {
        return handleError(err, req, reply, 'deleteRoute');
      }
    },
  );

  // ----------------------------------------------------------------
  // DELETE /schedules/:scheduleId — supprimer un gabarit
  // ----------------------------------------------------------------
  fastify.delete<{ Params: { scheduleId: string } }>(
    '/schedules/:scheduleId',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { scheduleId: string } }>, reply: FastifyReply) => {
      try {
        const cooperativeId = await getCoopId(getUserId(req), ['COOP_ADMIN', 'COOP_ASSISTANT']);
        await tripsService.deleteSchedule(cooperativeId, req.params.scheduleId);
        return reply.status(204).send();
      } catch (err) {
        return handleError(err, req, reply, 'deleteSchedule');
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /trips/:tripInstanceId/dashboard
  // Non dans le contrat officiel — documenté comme extension.
  // ----------------------------------------------------------------
  fastify.get<{ Params: { tripInstanceId: string } }>(
    '/trips/:tripInstanceId/dashboard',
    { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { tripInstanceId: string } }>, reply: FastifyReply) => {
      try {
        const cooperativeId = await getCoopId(getUserId(req));
        const dashboard = await tripsService.getTripDashboard(cooperativeId, req.params.tripInstanceId);
        reply.header('Cache-Control', 'no-store');
        return reply.send(dashboard);
      } catch (err) {
        return handleError(err, req, reply, 'getTripDashboard');
      }
    },
  );
}

// =====================================================================
// Routes voyageur — sans préfixe /coop
// =====================================================================

export async function tripsTravelerRoutes(fastify: FastifyInstance): Promise<void> {
  const tripsService = new TripsService(prisma);

  // ----------------------------------------------------------------
  // GET /trips/:tripInstanceId — détail voyageur
  // Retourne 404 si le trajet n'est pas OPEN_FOR_BOOKING.
  // Public (pas d'auth requise per contrat).
  // ----------------------------------------------------------------
  fastify.get<{ Params: { tripInstanceId: string } }>(
    '/trips/:tripInstanceId',
    async (req: FastifyRequest<{ Params: { tripInstanceId: string } }>, reply: FastifyReply) => {
      const lang = getLang(req);
      try {
        const trip = await tripsService.getTripForTraveler(req.params.tripInstanceId, lang);
        reply.header('Cache-Control', 'no-store');
        return reply.send(trip);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'NOT_FOUND') {
          return reply.status(404).send({ code: 'NOT_FOUND', message: (err as Error).message });
        }
        req.log.error(err, 'getTripForTraveler error');
        return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
      }
    },
  );
}
