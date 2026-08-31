/**
 * Tests d'intégration — Serveur WebSocket InsTRAM
 *
 * Ces tests montent un vrai serveur Fastify sur un port éphémère et s'y
 * connectent avec un vrai client `ws`. Seul Redis est simulé (bus Pub/Sub
 * en mémoire, cf. mock `ioredis` ci-dessous) : toute la logique de
 * `pubsub.ts`, `hub.ts`, `channels.ts`, `authorization.ts` et `server.ts`
 * est exécutée telle quelle.
 *
 * Couverture exigée par la spécification :
 *  - connexion sans token → fermeture 4001
 *  - connexion avec token valide → acceptée
 *  - subscribe `trip:{id}` → réception des SEAT_HELD publiés sur ce canal
 *  - subscribe `booking:{userId}` avec un mauvais userId → rejeté
 *  - subscribe `cooperative:{id}` sans rôle COOP_* → rejeté
 *  - déconnexion → aucune fuite sur les maps de clients / canaux
 */

import type { AddressInfo } from 'net';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import WebSocket from 'ws';

// =====================================================================
// Mock ioredis : bus Pub/Sub en mémoire, partagé par toutes les instances
// (le client principal `redisPub` et le client dédié `redisSub`).
// =====================================================================

jest.mock('ioredis', () => {
  const { EventEmitter: EE } = jest.requireActual('events');

  const bus = new Map<string, Set<FakeRedis>>();

  class FakeRedis extends EE {
    public status = 'ready';
    private readonly subscribed = new Set<string>();

    constructor() {
      super();
      setImmediate(() => {
        this.emit('connect');
        this.emit('ready');
      });
    }

    async subscribe(...channels: string[]): Promise<number> {
      for (const channel of channels) {
        this.subscribed.add(channel);
        let set = bus.get(channel);
        if (!set) {
          set = new Set<FakeRedis>();
          bus.set(channel, set);
        }
        set.add(this);
      }
      return this.subscribed.size;
    }

    async unsubscribe(...channels: string[]): Promise<number> {
      const targets = channels.length > 0 ? channels : [...this.subscribed];
      for (const channel of targets) {
        this.subscribed.delete(channel);
        const set = bus.get(channel);
        if (set) {
          set.delete(this);
          if (set.size === 0) bus.delete(channel);
        }
      }
      return this.subscribed.size;
    }

    async publish(channel: string, message: string): Promise<number> {
      const set = bus.get(channel);
      if (!set) return 0;
      const receivers = [...set];
      // Asynchrone, comme un vrai aller-retour réseau Redis.
      setImmediate(() => {
        for (const receiver of receivers) {
          receiver.emit('message', channel, message);
        }
      });
      return receivers.length;
    }

    async ping(): Promise<string> {
      return 'PONG';
    }

    async quit(): Promise<string> {
      await this.unsubscribe();
      this.status = 'end';
      return 'OK';
    }

    disconnect(): void {
      this.status = 'end';
    }

    /** Canaux Redis réellement souscrits — sert d'assertion côté transport. */
    static busChannels(): string[] {
      return [...bus.keys()];
    }
  }

  return { __esModule: true, default: FakeRedis, Redis: FakeRedis };
});

// Import APRÈS le mock : `pubsub` ouvre sa connexion dédiée au chargement.
import {
  publishToChannel,
  subscribedChannels,
  localHandlerCount,
  parseWsEvent,
} from '../pubsub';
import { registerWsServer } from '../server';
import { WsHub } from '../hub';
import { tripChannel, bookingChannel, coopChannel, driverChannel } from '../channels';
import type { WsAuthorizer } from '../authorization';

// =====================================================================
// Fixtures
// =====================================================================

const JWT_SECRET = 'test_ws_secret_do_not_use_in_prod';

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TRIP_ID = '11111111-1111-4111-8111-111111111112';
const TRAVELER_ID = '22222222-2222-4222-8222-222222222221';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const COOP_ID = '33333333-3333-4333-8333-333333333331';
const OTHER_COOP_ID = '33333333-3333-4333-8333-333333333332';
const SEAT_ID = '44444444-4444-4444-8444-444444444441';

interface ServerMessage {
  type: string;
  code?: string;
  channel?: string;
  [key: string]: unknown;
}

// =====================================================================
// Harnais de test
// =====================================================================

let app: FastifyInstance;
let hub: WsHub;
let port: number;
let authorizerCalls: { coop: string[][]; driver: string[][] };

/** Autorisateur simulé : COOP_ID appartient à l'utilisateur, pas OTHER_COOP_ID. */
function buildAuthorizer(): WsAuthorizer {
  return {
    async isCooperativeMember(userId: string, cooperativeId: string): Promise<boolean> {
      authorizerCalls.coop.push([userId, cooperativeId]);
      return cooperativeId === COOP_ID;
    },
    async isTripDriver(userId: string, tripInstanceId: string): Promise<boolean> {
      authorizerCalls.driver.push([userId, tripInstanceId]);
      return tripInstanceId === TRIP_ID;
    },
  };
}

function signToken(payload: object): string {
  return app.jwt.sign(payload);
}

class TestClient {
  readonly socket: WebSocket;
  readonly received: ServerMessage[] = [];
  closeCode: number | null = null;
  closeReason: string | null = null;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw: WebSocket.RawData) => {
      try {
        this.received.push(JSON.parse(raw.toString()) as ServerMessage);
      } catch {
        /* trame non JSON : ignorée */
      }
    });
    socket.on('close', (code: number, reason: Buffer) => {
      this.closeCode = code;
      this.closeReason = reason.toString();
    });
    socket.on('error', () => {
      /* fermeture brutale : capturée par 'close' */
    });
  }

  static open(query: string): TestClient {
    return new TestClient(new WebSocket(`ws://127.0.0.1:${port}/ws${query}`));
  }

  send(message: object): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Attend un message satisfaisant le prédicat (déjà reçu ou à venir). */
  async waitFor(
    predicate: (m: ServerMessage) => boolean,
    timeoutMs = 2000,
  ): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.received.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(
          `Timeout: message attendu jamais reçu. Reçus: ${JSON.stringify(this.received)}`,
        );
      }
      await delay(10);
    }
  }

  async waitForClose(timeoutMs = 2000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === null) {
      if (Date.now() > deadline) throw new Error('Timeout: fermeture jamais reçue');
      await delay(10);
    }
    return this.closeCode;
  }

  async close(): Promise<void> {
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }
    await this.waitForClose().catch(() => 0);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  condition: () => boolean,
  timeoutMs = 2000,
  label = 'condition',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${label} jamais satisfaite`);
    await delay(10);
  }
}

/** Connecte un client authentifié et attend l'accusé CONNECTED. */
async function connectAs(
  userId: string,
  roles: string[] = ['TRAVELER'],
): Promise<TestClient> {
  const token = signToken({ sub: userId, roles });
  const client = TestClient.open(`?token=${encodeURIComponent(token)}`);
  await client.waitFor((m) => m.type === 'CONNECTED');
  return client;
}

// =====================================================================
// Setup / teardown
// =====================================================================

beforeEach(async () => {
  authorizerCalls = { coop: [], driver: [] };
  hub = new WsHub();

  app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET, sign: { expiresIn: '15m' } });
  await registerWsServer(app, {
    hub,
    authorizer: buildAuthorizer(),
    heartbeatIntervalMs: 0, // le heartbeat n'est pas testé ici
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
});

afterEach(async () => {
  await app.close();
  // Le hook onClose du plugin doit avoir vidé le hub.
  await waitUntil(() => hub.clientCount() === 0, 2000, 'purge du hub');
});

// =====================================================================
// 1. Authentification
// =====================================================================

describe('Authentification à la connexion', () => {
  it('rejette une connexion sans token avec le code 4001', async () => {
    const client = TestClient.open('');
    await expect(client.waitForClose()).resolves.toBe(4001);
    expect(hub.clientCount()).toBe(0);
  });

  it('rejette un token signé avec une autre clé (code 4001)', async () => {
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiJhdHRhcXVhbnQiLCJyb2xlcyI6WyJTVVBFUl9BRE1JTiJdfQ.' +
      'signature_bidon';
    const client = TestClient.open(`?token=${forged}`);
    await expect(client.waitForClose()).resolves.toBe(4001);
    expect(hub.clientCount()).toBe(0);
  });

  it('rejette un token expiré (code 4001)', async () => {
    const expired = app.jwt.sign({
      sub: TRAVELER_ID,
      roles: ['TRAVELER'],
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const client = TestClient.open(`?token=${encodeURIComponent(expired)}`);
    await expect(client.waitForClose()).resolves.toBe(4001);
  });

  it('rejette un token valide mais sans `sub` exploitable (code 4001)', async () => {
    const token = signToken({ roles: ['TRAVELER'] });
    const client = TestClient.open(`?token=${encodeURIComponent(token)}`);
    await expect(client.waitForClose()).resolves.toBe(4001);
  });

  it('fonctionne enregistré dans un scope encapsulé, comme dans app.ts', async () => {
    await app.close();

    hub = new WsHub();
    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: JWT_SECRET, sign: { expiresIn: '15m' } });
    // Reproduit exactement `await app.register(wsRoutes)` de app.ts :
    // @fastify/websocket est enregistré dans un sous-scope, pas à la racine.
    await app.register(async (child) => {
      await registerWsServer(child, {
        hub,
        authorizer: buildAuthorizer(),
        heartbeatIntervalMs: 0,
      });
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;

    const client = await connectAs(TRAVELER_ID);
    client.send({ action: 'subscribe', channel: tripChannel(TRIP_ID) });
    await client.waitFor((m) => m.type === 'SUBSCRIBED');

    await publishToChannel(tripChannel(TRIP_ID), {
      type: 'SEAT_HELD',
      tripInstanceId: TRIP_ID,
      seatDefinitionId: SEAT_ID,
      at: new Date().toISOString(),
    });
    await client.waitFor((m) => m.type === 'SEAT_HELD');

    await client.close();
  });

  it('accepte une connexion avec un token valide et annonce CONNECTED', async () => {
    const client = await connectAs(TRAVELER_ID);
    const connected = await client.waitFor((m) => m.type === 'CONNECTED');

    expect(connected.userId).toBe(TRAVELER_ID);
    expect(connected.roles).toEqual(['TRAVELER']);
    expect(typeof connected.at).toBe('string');
    expect(hub.clientCount()).toBe(1);

    await client.close();
  });
});

// =====================================================================
// 2. Canal trip:{id} — cœur du « zéro double réservation »
// =====================================================================

describe('Canal trip:{tripInstanceId}', () => {
  it('accepte l\'abonnement de tout utilisateur authentifié', async () => {
    const client = await connectAs(TRAVELER_ID);
    client.send({ action: 'subscribe', channel: tripChannel(TRIP_ID) });

    const ack = await client.waitFor((m) => m.type === 'SUBSCRIBED');
    expect(ack.channel).toBe(tripChannel(TRIP_ID));
    expect(hub.clientsOn(tripChannel(TRIP_ID))).toBe(1);

    await client.close();
  });

  it('relaie un SEAT_HELD publié sur le canal Redis', async () => {
    const client = await connectAs(TRAVELER_ID);
    client.send({ action: 'subscribe', channel: tripChannel(TRIP_ID) });
    await client.waitFor((m) => m.type === 'SUBSCRIBED');

    await publishToChannel(tripChannel(TRIP_ID), {
      type: 'SEAT_HELD',
      tripInstanceId: TRIP_ID,
      seatDefinitionId: SEAT_ID,
      seatCode: '3B',
      at: new Date().toISOString(),
    });

    const event = await client.waitFor((m) => m.type === 'SEAT_HELD');
    expect(event.tripInstanceId).toBe(TRIP_ID);
    expect(event.seatDefinitionId).toBe(SEAT_ID);
    expect(event.seatCode).toBe('3B');

    await client.close();
  });

  it('diffuse le même SEAT_SOLD à TOUS les clients du trajet (règle zéro double réservation)', async () => {
    const acheteur = await connectAs(TRAVELER_ID);
    const temoin1 = await connectAs(OTHER_USER_ID);
    const temoin2 = await connectAs(OTHER_USER_ID);

    for (const c of [acheteur, temoin1, temoin2]) {
      c.send({ action: 'subscribe', channel: tripChannel(TRIP_ID) });
      await c.waitFor((m) => m.type === 'SUBSCRIBED');
    }
    expect(hub.clientsOn(tripChannel(TRIP_ID))).toBe(3);

    await publishToChannel(tripChannel(TRIP_ID), {
      type: 'SEAT_SOLD',
      tripInstanceId: TRIP_ID,
      seatDefinitionId: SEAT_ID,
      at: new Date().toISOString(),
    });

    for (const c of [acheteur, temoin1, temoin2]) {
      const event = await c.waitFor((m) => m.type === 'SEAT_SOLD');
      expect(event.seatDefinitionId).toBe(SEAT_ID);
    }

    await Promise.all([acheteur.close(), temoin1.close(), temoin2.close()]);
  });

  it('n\'envoie rien aux clients abonnés à un AUTRE trajet', async () => {
    const surTrajetA = await connectAs(TRAVELER_ID);
    const surTrajetB = await connectAs(OTHER_USER_ID);

    surTrajetA.send({ action: 'subscribe', channel: tripChannel(TRIP_ID) });
    await surTrajetA.waitFor((m) => m.type === 'SUBSCRIBED');
    surTrajetB.send({ action: 'subscribe', channel: tripChannel(OTHER_TRIP_ID) });
    await surTrajetB.waitFor((m) => m.type === 'SUBSCRIBED');

    await publishToChannel(tripChannel(TRIP_ID), {
      type: 'SEAT_HELD',
      tripInstanceId: TRIP_ID,
      seatDefinitionId: SEAT_ID,
      at: new Date().toISOString(),
    });

    await surTrajetA.waitFor((m) => m.type === 'SEAT_HELD');
    await delay(80); // laisse largement le temps à une fuite de se manifester
    expect(surTrajetB.received.some((m) => m.type === 'SEAT_HELD')).toBe(false);

    await Promise.all([surTrajetA.close(), surTrajetB.close()]);
  });

  it('relaie aussi la forme héritée publiée par modules/seats (`{ event: ... }`)', async () => {
    const client = await connectAs(TRAVELER_ID);
    client.send({ action: 'subscribe', channel: tripChannel(TRIP_ID) });
    await client.waitFor((m) => m.type === 'SUBSCRIBED');

    // Forme exacte émise aujourd'hui par SeatsService.holdSeats().
    const { redisPub } = await import('../pubsub');
    await redisPub.publish(
      tripChannel(TRIP_ID),
      JSON.stringify({
        event: 'SEAT_HELD',
        tripInstanceId: TRIP_ID,
        seatDefinitionIds: [SEAT_ID],
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    );

    const event = await client.waitFor((m) => m.type === 'SEAT_HELD');
    expect((event.payload as Record<string, unknown>).seatDefinitionIds).toEqual([SEAT_ID]);

    await client.close();
  });
});

// =====================================================================
// 3. Canal booking:{userId}
// =====================================================================

describe('Canal booking:{userId}', () => {
  it('accepte l\'abonnement au canal de son propre userId', async () => {
    const client = await connectAs(TRAVELER_ID);
    client.send({ action: 'subscribe', channel: bookingChannel(TRAVELER_ID) });

    const ack = await client.waitFor((m) => m.type === 'SUBSCRIBED');
    expect(ack.channel).toBe(bookingChannel(TRAVELER_ID));

    await client.close();
  });

  it('rejette l\'abonnement au canal booking d\'un autre utilisateur', async () => {
    const client = await connectAs(TRAVELER_ID);
    client.send({ action: 'subscribe', channel: bookingChannel(OTHER_USER_ID) });

    const err = await client.waitFor((m) => m.type === 'ERROR');
    expect(err.code).toBe('FORBIDDEN_CHANNEL');
    expect(err.channel).toBe(bookingChannel(OTHER_USER_ID));
    expect(hub.clientsOn(bookingChannel(OTHER_USER_ID))).toBe(0);
    expect(hub.channelCount()).toBe(0);

    await client.close();
  });

  it('ne fuit pas les BOOKING_CONFIRMED d\'autrui', async () => {
    const victime = await connectAs(TRAVELER_ID);
    victime.send({ action: 'subscribe', channel: bookingChannel(OTHER_USER_ID) });
    await victime.waitFor((m) => m.type === 'ERROR');

    await publishToChannel(bookingChannel(OTHER_USER_ID), {
      type: 'BOOKING_CONFIRMED',
      userId: OTHER_USER_ID,
      bookingId: '55555555-5555-4555-8555-555555555555',
      at: new Date().toISOString(),
    });

    await delay(80);
    expect(victime.received.some((m) => m.type === 'BOOKING_CONFIRMED')).toBe(false);

    await victime.close();
  });
});

// =====================================================================
// 4. Canaux cooperative:{id} et driver:{tripId}
// =====================================================================

describe('Canal cooperative:{cooperativeId}', () => {
  it('rejette un utilisateur sans rôle COOP_* sans même interroger la base', async () => {
    const client = await connectAs(TRAVELER_ID, ['TRAVELER']);
    client.send({ action: 'subscribe', channel: coopChannel(COOP_ID) });

    const err = await client.waitFor((m) => m.type === 'ERROR');
    expect(err.code).toBe('FORBIDDEN_CHANNEL');
    expect(err.channel).toBe(coopChannel(COOP_ID));
    // Filtre rapide sur les rôles : aucun accès PostgreSQL déclenché.
    expect(authorizerCalls.coop).toHaveLength(0);
    expect(hub.channelCount()).toBe(0);

    await client.close();
  });

  it('rejette un COOP_ADMIN qui vise une coopérative dont il n\'est pas membre', async () => {
    const client = await connectAs(TRAVELER_ID, ['TRAVELER', 'COOP_ADMIN']);
    client.send({ action: 'subscribe', channel: coopChannel(OTHER_COOP_ID) });

    const err = await client.waitFor((m) => m.type === 'ERROR');
    expect(err.code).toBe('FORBIDDEN_CHANNEL');
    // Le rôle seul ne suffit pas : l'appartenance est vérifiée en base.
    expect(authorizerCalls.coop).toEqual([[TRAVELER_ID, OTHER_COOP_ID]]);

    await client.close();
  });

  it('accepte un COOP_ADMIN membre de la coopérative visée', async () => {
    const client = await connectAs(TRAVELER_ID, ['TRAVELER', 'COOP_ADMIN']);
    client.send({ action: 'subscribe', channel: coopChannel(COOP_ID) });

    const ack = await client.waitFor((m) => m.type === 'SUBSCRIBED');
    expect(ack.channel).toBe(coopChannel(COOP_ID));

    await publishToChannel(coopChannel(COOP_ID), {
      type: 'COOP_DASHBOARD_UPDATE',
      cooperativeId: COOP_ID,
      payload: { seatsSold: 12 },
      at: new Date().toISOString(),
    });

    const event = await client.waitFor((m) => m.type === 'COOP_DASHBOARD_UPDATE');
    expect((event.payload as Record<string, unknown>).seatsSold).toBe(12);

    await client.close();
  });
});

describe('Canal driver:{tripInstanceId}', () => {
  it('rejette un COOP_ASSISTANT (rôle COOP_DRIVER requis)', async () => {
    const client = await connectAs(TRAVELER_ID, ['COOP_ASSISTANT']);
    client.send({ action: 'subscribe', channel: driverChannel(TRIP_ID) });

    const err = await client.waitFor((m) => m.type === 'ERROR');
    expect(err.code).toBe('FORBIDDEN_CHANNEL');
    expect(authorizerCalls.driver).toHaveLength(0);

    await client.close();
  });

  it('accepte un COOP_DRIVER rattaché au trajet', async () => {
    const client = await connectAs(TRAVELER_ID, ['COOP_DRIVER']);
    client.send({ action: 'subscribe', channel: driverChannel(TRIP_ID) });

    const ack = await client.waitFor((m) => m.type === 'SUBSCRIBED');
    expect(ack.channel).toBe(driverChannel(TRIP_ID));
    expect(authorizerCalls.driver).toEqual([[TRAVELER_ID, TRIP_ID]]);

    await client.close();
  });

  it('rejette un COOP_DRIVER sur un trajet d\'une autre coopérative', async () => {
    const client = await connectAs(TRAVELER_ID, ['COOP_DRIVER']);
    client.send({ action: 'subscribe', channel: driverChannel(OTHER_TRIP_ID) });

    const err = await client.waitFor((m) => m.type === 'ERROR');
    expect(err.code).toBe('FORBIDDEN_CHANNEL');

    await client.close();
  });
});

// =====================================================================
// 5. Protocole : messages invalides
// =====================================================================

describe('Robustesse du protocole', () => {
  it('répond INVALID_MESSAGE sur du JSON malformé sans couper la connexion', async () => {
    const client = await connectAs(TRAVELER_ID);
    client.socket.send('{ ceci n\'est pas du json');

    const err = await client.waitFor((m) => m.type === 'ERROR');
    expect(err.code).toBe('INVALID_MESSAGE');
    expect(client.socket.readyState).toBe(WebSocket.OPEN);

    await client.close();
  });

  it('répond INVALID_CHANNEL sur un canal inconnu ou un id non-UUID', async () => {
    const client = await connectAs(TRAVELER_ID);

    client.send({ action: 'subscribe', channel: 'admin:everything' });
    const err1 = await client.waitFor((m) => m.type === 'ERROR');
    expect(err1.code).toBe('INVALID_CHANNEL');

    client.received.length = 0;
    client.send({ action: 'subscribe', channel: 'trip:*' });
    const err2 = await client.waitFor((m) => m.type === 'ERROR');
    expect(err2.code).toBe('INVALID_CHANNEL');

    // Aucun canal Redis parasite n'a été créé.
    expect(hub.channelCount()).toBe(0);

    await client.close();
  });

  it('répond INVALID_ACTION sur une action inconnue', async () => {
    const client = await connectAs(TRAVELER_ID);
    client.send({ action: 'admin:shutdown', channel: tripChannel(TRIP_ID) });

    const err = await client.waitFor((m) => m.type === 'ERROR');
    expect(err.code).toBe('INVALID_ACTION');

    await client.close();
  });

  it('répond PONG à une action ping applicative', async () => {
    const client = await connectAs(TRAVELER_ID);
    client.send({ action: 'ping' });

    await client.waitFor((m) => m.type === 'PONG');
    await client.close();
  });

  it('traite un subscribe répété de façon idempotente', async () => {
    const client = await connectAs(TRAVELER_ID);
    client.send({ action: 'subscribe', channel: tripChannel(TRIP_ID) });
    await client.waitFor((m) => m.type === 'SUBSCRIBED');
    client.send({ action: 'subscribe', channel: tripChannel(TRIP_ID) });
    await delay(50);

    expect(hub.clientsOn(tripChannel(TRIP_ID))).toBe(1);
    expect(localHandlerCount(tripChannel(TRIP_ID))).toBe(1);
    expect(hub.assertInvariants()).toEqual([]);

    await client.close();
  });

  it('applique le quota de canaux par connexion', async () => {
    await app.close();

    hub = new WsHub();
    app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: JWT_SECRET, sign: { expiresIn: '15m' } });
    await registerWsServer(app, {
      hub,
      authorizer: buildAuthorizer(),
      heartbeatIntervalMs: 0,
      maxChannelsPerClient: 2,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;

    const client = await connectAs(TRAVELER_ID);
    const ids = [
      '66666666-6666-4666-8666-666666666661',
      '66666666-6666-4666-8666-666666666662',
      '66666666-6666-4666-8666-666666666663',
    ];
    for (const id of ids) {
      client.send({ action: 'subscribe', channel: tripChannel(id) });
    }

    const err = await client.waitFor((m) => m.type === 'ERROR');
    expect(err.code).toBe('TOO_MANY_CHANNELS');
    expect(hub.channelCount()).toBe(2);

    await client.close();
  });
});

// =====================================================================
// 6. Déconnexion : absence de fuite mémoire
// =====================================================================

describe('Déconnexion et absence de fuite', () => {
  it('purge le client de tous ses canaux et se désabonne de Redis', async () => {
    const client = await connectAs(TRAVELER_ID, ['COOP_ADMIN']);

    for (const channel of [
      tripChannel(TRIP_ID),
      tripChannel(OTHER_TRIP_ID),
      bookingChannel(TRAVELER_ID),
      coopChannel(COOP_ID),
    ]) {
      client.send({ action: 'subscribe', channel });
      await client.waitFor((m) => m.type === 'SUBSCRIBED' && m.channel === channel);
    }

    expect(hub.clientCount()).toBe(1);
    expect(hub.channelCount()).toBe(4);
    expect(hub.redisHandlerCount()).toBe(4);
    expect(subscribedChannels()).toHaveLength(4);
    expect(hub.assertInvariants()).toEqual([]);

    await client.close();

    await waitUntil(() => hub.clientCount() === 0, 2000, 'purge des clients');
    const stats = hub.stats();
    expect(stats.clients).toBe(0);
    expect(stats.channels).toBe(0);
    expect(stats.byChannel).toEqual({});
    expect(hub.redisHandlerCount()).toBe(0);
    // Plus aucun handler local : le UNSUBSCRIBE Redis a bien été émis.
    expect(subscribedChannels()).toEqual([]);
    expect(hub.assertInvariants()).toEqual([]);
  });

  it('ne coupe PAS le canal Redis tant qu\'un autre client l\'écoute', async () => {
    const partant = await connectAs(TRAVELER_ID);
    const restant = await connectAs(OTHER_USER_ID);

    for (const c of [partant, restant]) {
      c.send({ action: 'subscribe', channel: tripChannel(TRIP_ID) });
      await c.waitFor((m) => m.type === 'SUBSCRIBED');
    }
    expect(hub.clientsOn(tripChannel(TRIP_ID))).toBe(2);
    expect(localHandlerCount(tripChannel(TRIP_ID))).toBe(1); // 1 handler, N clients

    await partant.close();
    await waitUntil(() => hub.clientCount() === 1, 2000, 'départ du premier client');

    expect(hub.clientsOn(tripChannel(TRIP_ID))).toBe(1);
    expect(localHandlerCount(tripChannel(TRIP_ID))).toBe(1);

    // Le client restant continue de recevoir le temps réel.
    await publishToChannel(tripChannel(TRIP_ID), {
      type: 'SEAT_RELEASED',
      tripInstanceId: TRIP_ID,
      seatDefinitionId: SEAT_ID,
      at: new Date().toISOString(),
    });
    await restant.waitFor((m) => m.type === 'SEAT_RELEASED');

    await restant.close();
    await waitUntil(() => hub.channelCount() === 0, 2000, 'purge finale');
    expect(subscribedChannels()).toEqual([]);
  });

  it('libère proprement un unsubscribe explicite', async () => {
    const client = await connectAs(TRAVELER_ID);
    client.send({ action: 'subscribe', channel: tripChannel(TRIP_ID) });
    await client.waitFor((m) => m.type === 'SUBSCRIBED');

    client.send({ action: 'unsubscribe', channel: tripChannel(TRIP_ID) });
    await client.waitFor((m) => m.type === 'UNSUBSCRIBED');

    expect(hub.channelCount()).toBe(0);
    expect(localHandlerCount(tripChannel(TRIP_ID))).toBe(0);
    expect(hub.assertInvariants()).toEqual([]);

    await client.close();
  });

  it('ne laisse aucune trace après 40 connexions/déconnexions successives', async () => {
    for (let i = 0; i < 40; i++) {
      const client = await connectAs(TRAVELER_ID);
      client.send({ action: 'subscribe', channel: tripChannel(TRIP_ID) });
      await client.waitFor((m) => m.type === 'SUBSCRIBED');
      await client.close();
      await waitUntil(() => hub.clientCount() === 0, 2000, `purge itération ${i}`);
    }

    expect(hub.stats()).toEqual({ clients: 0, channels: 0, byChannel: {} });
    expect(subscribedChannels()).toEqual([]);
    expect(hub.assertInvariants()).toEqual([]);
  });
});

// =====================================================================
// 7. Normalisation des événements (pubsub)
// =====================================================================

describe('parseWsEvent', () => {
  it('rejette un JSON invalide, un tableau ou un type inconnu', () => {
    expect(parseWsEvent('pas du json')).toBeNull();
    expect(parseWsEvent('[1,2,3]')).toBeNull();
    expect(parseWsEvent(JSON.stringify({ type: 'DROP_TABLE' }))).toBeNull();
  });

  it('complète un horodatage manquant', () => {
    const event = parseWsEvent(JSON.stringify({ type: 'SEAT_SOLD' }));
    expect(event?.type).toBe('SEAT_SOLD');
    expect(Number.isNaN(Date.parse(event?.at ?? ''))).toBe(false);
  });
});
