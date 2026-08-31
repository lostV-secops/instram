import crypto from 'crypto';
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket as WsSocket } from 'ws';

import { WsHub, type WsClient } from './hub';
import { parseChannel } from './channels';
import {
  authorizeChannel,
  type WsAuthorizer,
  allowAllAuthorizer,
} from './authorization';
import type { WsEvent } from './pubsub';

// =====================================================================
// InsTRAM — Serveur WebSocket
// Source : docs/architecture.md §2.3 (canaux, auth), §5.1 (UI temps réel)
//
// CONTRAT AVEC LE FRONT
// ---------------------------------------------------------------------
// Connexion : wss://api.instram.mg/ws?token=<access_jwt>
//
// Le client envoie :
//   { "action": "subscribe",   "channel": "trip:<uuid>" }
//   { "action": "unsubscribe", "channel": "trip:<uuid>" }
//   { "action": "ping" }
//
// Le serveur envoie :
//   { "type": "CONNECTED",    "userId": "...", "at": "..." }
//   { "type": "SUBSCRIBED",   "channel": "...", "at": "..." }
//   { "type": "UNSUBSCRIBED", "channel": "...", "at": "..." }
//   { "type": "PONG",         "at": "..." }
//   { "type": "ERROR", "code": "...", "message": "...", "channel"?: "...", "at": "..." }
//   ...ainsi que les WsEvent métier bruts (SEAT_HELD, SEAT_SOLD, ...).
//
// Codes de fermeture applicatifs :
//   4001 UNAUTHORIZED    token absent, invalide ou expiré
//   4008 SLOW_CONSUMER   backpressure : client trop lent, il se reconnectera
//   4013 TOO_MANY_CHANNELS  quota d'abonnements dépassé
//
// NON-NÉGOCIABLE
// ---------------------------------------------------------------------
// - Aucun fallback long-polling (interdit par le CDC). Si le WS tombe,
//   l'UI affiche « reconnexion... » et rouvre une connexion ; le serveur
//   ne gère aucune reprise de session, il accepte simplement la nouvelle.
// - Le JWT est revalidé côté serveur à CHAQUE connexion. Rien de ce que le
//   client annonce (userId, rôles, coopérative) n'est cru sur parole.
// - Le heartbeat ci-dessous (`setInterval` ping/pong) est un contrôle de
//   liveness sur le transport, PAS du polling de données : il n'interroge
//   aucun endpoint seats/bookings. La règle RG-10 reste respectée.
// =====================================================================

const DEFAULT_PATH = '/ws';
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_MAX_CHANNELS_PER_CLIENT = 25;
const MAX_PAYLOAD_BYTES = 16 * 1024;
/** File d'attente par connexion : au-delà, le client est considéré hostile. */
const MAX_PENDING_MESSAGES = 100;

export interface WsServerOptions {
  /** Vérificateur d'appartenance coopérative / conducteur (adossé à PostgreSQL). */
  authorizer?: WsAuthorizer;
  /** Chemin de la route WS. Défaut : `/ws`. */
  path?: string;
  /** Hub injecté (tests). Défaut : le hub singleton du process. */
  hub?: WsHub;
  /** Période du ping de liveness. 0 pour désactiver (tests). */
  heartbeatIntervalMs?: number;
  /** Quota d'abonnements simultanés par connexion. */
  maxChannelsPerClient?: number;
  /** Enregistrer `@fastify/websocket` ici. Mettre false s'il l'est déjà. */
  registerPlugin?: boolean;
}

interface WsAccessTokenPayload {
  sub?: string;
  roles?: unknown;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------
// Hub singleton du process
// ---------------------------------------------------------------------

let hubSingleton: WsHub | null = null;

export function getWsHub(): WsHub {
  if (!hubSingleton) hubSingleton = new WsHub();
  return hubSingleton;
}

/** Réinitialise le hub — usage tests uniquement. */
export function resetWsHub(): void {
  hubSingleton?.closeAll();
  hubSingleton = null;
}

// ---------------------------------------------------------------------
// Helpers d'émission
// ---------------------------------------------------------------------

const OPEN_STATE = 1;

function send(socket: WsSocket, message: Record<string, unknown>): void {
  if (socket.readyState !== OPEN_STATE) return;
  try {
    socket.send(JSON.stringify({ ...message, at: new Date().toISOString() }));
  } catch {
    /* socket en cours de fermeture */
  }
}

function sendError(
  socket: WsSocket,
  code: string,
  message: string,
  channel?: string,
): void {
  send(socket, channel ? { type: 'ERROR', code, message, channel } : { type: 'ERROR', code, message });
}

/**
 * Extrait `{ userId, roles }` d'un payload JWT vérifié.
 * Retourne null si le payload ne porte pas de sujet exploitable — un token
 * signé mais malformé ne doit pas ouvrir de session.
 */
function principalFromPayload(
  payload: WsAccessTokenPayload,
): { userId: string; roles: string[] } | null {
  const userId = typeof payload.sub === 'string' ? payload.sub : null;
  if (!userId) return null;

  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((r): r is string => typeof r === 'string')
    : [];

  return { userId, roles };
}

// ---------------------------------------------------------------------
// Plugin Fastify
// ---------------------------------------------------------------------

export async function registerWsServer(
  fastify: FastifyInstance,
  options: WsServerOptions = {},
): Promise<WsHub> {
  const {
    authorizer = allowAllAuthorizer,
    path = DEFAULT_PATH,
    hub = getWsHub(),
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
    maxChannelsPerClient = DEFAULT_MAX_CHANNELS_PER_CLIENT,
    registerPlugin = true,
  } = options;

  if (registerPlugin) {
    await fastify.register(fastifyWebsocket, {
      options: {
        // Un message client légitime fait quelques dizaines d'octets.
        maxPayload: MAX_PAYLOAD_BYTES,
      },
    });
  }

  /** Connexions vivantes portées par cette instance de plugin. */
  const activeClients = new Set<WsClient>();

  // ------------------------------------------------------------------
  // Heartbeat : détection des connexions mortes.
  // Sur 3G malgache, une coupure radio ne produit souvent AUCUN événement
  // TCP côté serveur. Sans ping/pong, le hub accumulerait des clients
  // fantômes et diffuserait dans le vide.
  // ------------------------------------------------------------------
  let heartbeat: NodeJS.Timeout | null = null;

  if (heartbeatIntervalMs > 0) {
    heartbeat = setInterval(() => {
      for (const client of activeClients) {
        if (!client.isAlive) {
          client.socket.terminate();
          continue;
        }
        client.isAlive = false;
        try {
          client.socket.ping();
        } catch {
          client.socket.terminate();
        }
      }
    }, heartbeatIntervalMs);
    // Ne pas maintenir le process (ni Jest) en vie pour ce timer.
    heartbeat.unref?.();
  }

  fastify.addHook('onClose', async () => {
    if (heartbeat) clearInterval(heartbeat);
    activeClients.clear();
    hub.closeAll();
  });

  // ------------------------------------------------------------------
  // Route WS
  // ------------------------------------------------------------------
  fastify.get<{ Querystring: { token?: string } }>(
    path,
    {
      websocket: true,
      // Limite les tempêtes de reconnexion (mobile qui bat de l'aile).
      config: { rateLimit: { max: 60, timeWindow: '1m' } },
    },
    (socket: WsSocket, request: FastifyRequest<{ Querystring: { token?: string } }>) => {
      // ---------------- Authentification ----------------
      const token = request.query?.token;

      if (!token || typeof token !== 'string') {
        send(socket, { type: 'ERROR', code: 'UNAUTHORIZED', message: 'Token requis' });
        socket.close(4001, 'UNAUTHORIZED');
        return;
      }

      let principal: { userId: string; roles: string[] } | null = null;
      try {
        const payload = fastify.jwt.verify<WsAccessTokenPayload>(token);
        principal = principalFromPayload(payload);
      } catch {
        principal = null;
      }

      if (!principal) {
        send(socket, {
          type: 'ERROR',
          code: 'UNAUTHORIZED',
          message: 'Token invalide ou expiré',
        });
        socket.close(4001, 'UNAUTHORIZED');
        return;
      }

      const client: WsClient = {
        id: crypto.randomUUID(),
        userId: principal.userId,
        roles: principal.roles,
        socket,
        channels: new Set<string>(),
        isAlive: true,
        connectedAt: Date.now(),
      };

      hub.addClient(client);
      activeClients.add(client);

      socket.on('pong', () => {
        client.isAlive = true;
      });

      send(socket, { type: 'CONNECTED', userId: client.userId, roles: client.roles });

      // ---------------- Messages entrants ----------------
      // Les messages d'une même connexion sont traités STRICTEMENT en série.
      // `handleClientMessage` est asynchrone (l'autorisation d'un canal
      // `cooperative:` / `driver:` interroge PostgreSQL) : sans cette file,
      // trois `subscribe` envoyés d'affilée franchissent tous le contrôle de
      // quota avant que le premier n'ait été enregistré dans le hub — un
      // client peut alors forcer l'instance à s'abonner à un nombre illimité
      // de canaux Redis. Sérialiser rétablit l'atomicité lecture/écriture du
      // compteur `client.channels`.
      let queue: Promise<void> = Promise.resolve();
      let pending = 0;

      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        if (pending >= MAX_PENDING_MESSAGES) {
          sendError(socket, 'TOO_MANY_MESSAGES', 'Trop de messages en attente');
          socket.close(4029, 'FLOOD');
          return;
        }
        pending += 1;
        queue = queue
          .then(() => handleClientMessage(raw))
          .catch((err: Error) => {
            request.log.error({ err, clientId: client.id }, 'ws: message non traité');
          })
          .finally(() => {
            pending -= 1;
          });
      });

      async function handleClientMessage(
        raw: Buffer | ArrayBuffer | Buffer[],
      ): Promise<void> {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          sendError(socket, 'INVALID_MESSAGE', 'JSON invalide');
          return;
        }

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          sendError(socket, 'INVALID_MESSAGE', 'Objet JSON attendu');
          return;
        }

        const message = parsed as { action?: unknown; channel?: unknown };

        if (message.action === 'ping') {
          send(socket, { type: 'PONG' });
          return;
        }

        if (message.action !== 'subscribe' && message.action !== 'unsubscribe') {
          sendError(socket, 'INVALID_ACTION', 'Action inconnue');
          return;
        }

        const parsedChannel = parseChannel(message.channel);
        if (!parsedChannel) {
          sendError(socket, 'INVALID_CHANNEL', 'Nom de canal invalide');
          return;
        }

        // -------- unsubscribe --------
        if (message.action === 'unsubscribe') {
          hub.unsubscribe(client, parsedChannel.channel);
          send(socket, { type: 'UNSUBSCRIBED', channel: parsedChannel.channel });
          return;
        }

        // -------- subscribe --------
        if (
          !client.channels.has(parsedChannel.channel) &&
          client.channels.size >= maxChannelsPerClient
        ) {
          sendError(
            socket,
            'TOO_MANY_CHANNELS',
            `Maximum ${maxChannelsPerClient} canaux par connexion`,
            parsedChannel.channel,
          );
          return;
        }

        let decision;
        try {
          decision = await authorizeChannel(client, parsedChannel, authorizer);
        } catch (err) {
          request.log.error(
            { err, channel: parsedChannel.channel },
            'ws: échec de la vérification d\'autorisation',
          );
          // On refuse par défaut : jamais d'ouverture de canal sur une erreur.
          sendError(
            socket,
            'FORBIDDEN_CHANNEL',
            'Vérification impossible',
            parsedChannel.channel,
          );
          return;
        }

        // L'autorisation est asynchrone (accès base) : le client a pu se
        // déconnecter entre-temps. Sans ce garde, on réinsérerait un client
        // mort dans le hub -> fuite mémoire et abonnement Redis orphelin.
        if (!hub.hasClient(client) || socket.readyState !== OPEN_STATE) {
          return;
        }

        if (!decision.ok) {
          sendError(socket, decision.code, decision.message, parsedChannel.channel);
          return;
        }

        hub.subscribe(client, parsedChannel.channel);
        send(socket, { type: 'SUBSCRIBED', channel: parsedChannel.channel });
      }

      // ---------------- Fermeture ----------------
      const cleanup = (): void => {
        activeClients.delete(client);
        hub.removeClient(client);
      };

      socket.on('close', cleanup);
      socket.on('error', (err: Error) => {
        request.log.warn({ err, clientId: client.id }, 'ws: erreur socket');
        cleanup();
      });
    },
  );

  return hub;
}

// ---------------------------------------------------------------------
// Diffusion locale directe (utile aux tests et au monitoring)
// ---------------------------------------------------------------------

/**
 * Pousse un événement aux clients WS locaux SANS passer par Redis.
 * À n'utiliser que pour du diagnostic : en production, tout événement doit
 * transiter par `publishToChannel` afin d'atteindre TOUTES les instances.
 */
export function broadcastLocalOnly(channel: string, event: WsEvent): number {
  return getWsHub().broadcastLocal(channel, event);
}
