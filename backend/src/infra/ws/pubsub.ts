import Redis from 'ioredis';
import mainRedis from '../cache/redis';

// =====================================================================
// InsTRAM — Redis Pub/Sub dédié au temps réel WebSocket
// Source : docs/architecture.md §2.3 (canaux) et §2.5 (rôles Redis)
//
// POURQUOI UNE CONNEXION SÉPARÉE ?
// Une connexion Redis passée en mode SUBSCRIBE entre dans un état
// restreint : elle n'accepte plus que (P)SUBSCRIBE / (P)UNSUBSCRIBE /
// PING / QUIT. Réutiliser le client principal casserait immédiatement le
// cache recherche, les verrous de siège (SET NX PX) et BullMQ.
//   -> `redisSub` : connexion dédiée, en mode subscribe uniquement.
//   -> `redisPub` : le client principal (PUBLISH est une commande normale,
//      aucune raison d'ouvrir une 3e connexion).
//
// SCALE HORIZONTAL
// Chaque instance backend s'abonne aux canaux dont elle a au moins un
// client WS local. Redis diffuse chaque PUBLISH à toutes les instances
// abonnées : un siège tenu sur l'instance A disparaît chez les clients
// de l'instance B sans aucun polling.
// =====================================================================

// ---------------------------------------------------------------------
// Contrat d'événement
// ---------------------------------------------------------------------

export type WsEventType =
  | 'SEAT_HELD'
  | 'SEAT_SOLD'
  | 'SEAT_RELEASED'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_PAYMENT_FAILED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_FAILED'
  | 'COOP_DASHBOARD_UPDATE'
  | 'DRIVER_BOARDING_UPDATE';

export interface WsEvent {
  type: WsEventType;
  tripInstanceId?: string;
  seatDefinitionId?: string;
  seatCode?: string;
  bookingId?: string;
  userId?: string;
  cooperativeId?: string;
  payload?: Record<string, unknown>;
  /** Horodatage ISO 8601 UTC de production de l'événement. */
  at: string;
}

const WS_EVENT_TYPES: readonly string[] = [
  'SEAT_HELD',
  'SEAT_SOLD',
  'SEAT_RELEASED',
  'BOOKING_CONFIRMED',
  'BOOKING_PAYMENT_FAILED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_FAILED',
  'COOP_DASHBOARD_UPDATE',
  'DRIVER_BOARDING_UPDATE',
];

export function isWsEventType(value: unknown): value is WsEventType {
  return typeof value === 'string' && WS_EVENT_TYPES.includes(value);
}

// ---------------------------------------------------------------------
// Connexions
// ---------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __redisSub: Redis | undefined;
}

function createSubscriberClient(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

  const client = new Redis(url, {
    // Une connexion subscribe ne doit jamais abandonner une commande :
    // si on perd la souscription, l'UI cesse silencieusement d'être à jour,
    // ce qui est exactement le scénario de double réservation qu'on interdit.
    maxRetriesPerRequest: null,
    retryStrategy(times: number): number {
      return Math.min(50 * Math.pow(2, times - 1), 3000);
    },
    reconnectOnError(err: Error): boolean {
      return err.message.includes('READONLY');
    },
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 10_000,
  });

  client.on('error', (err: Error) => {
    process.stderr.write(`[ws:pubsub] Subscriber error: ${err.message}\n`);
  });

  client.on('end', () => {
    process.stdout.write('[ws:pubsub] Subscriber connection ended\n');
  });

  // Après une reconnexion, ioredis ne restaure pas toujours l'état applicatif
  // attendu : on re-souscrit explicitement à tous les canaux encore utilisés.
  client.on('ready', () => {
    const channels = [...handlers.keys()];
    if (channels.length === 0) return;
    client.subscribe(...channels).catch((err: Error) => {
      process.stderr.write(`[ws:pubsub] Re-subscribe failed: ${err.message}\n`);
    });
  });

  return client;
}

/** Connexion Redis en mode SUBSCRIBE — isolée du pool principal. */
export const redisSub: Redis = globalThis.__redisSub ?? createSubscriberClient();

/** Connexion Redis utilisée pour PUBLISH — le client principal suffit. */
export const redisPub: Redis = mainRedis;

if (process.env.NODE_ENV !== 'production') {
  globalThis.__redisSub = redisSub;
}

// ---------------------------------------------------------------------
// Registre local des handlers (un seul listener 'message' pour tout le process)
// ---------------------------------------------------------------------

export type WsEventHandler = (event: WsEvent, channel: string) => void;

const handlers = new Map<string, Set<WsEventHandler>>();
let messageListenerAttached = false;

function attachMessageListener(): void {
  if (messageListenerAttached) return;
  messageListenerAttached = true;

  redisSub.on('message', (channel: string, raw: string) => {
    const set = handlers.get(channel);
    if (!set || set.size === 0) return;

    const event = parseWsEvent(raw);
    if (!event) {
      process.stderr.write(
        `[ws:pubsub] Message illisible sur ${channel}, ignoré\n`,
      );
      return;
    }

    // Copie défensive : un handler peut se désabonner pendant l'itération.
    for (const handler of [...set]) {
      try {
        handler(event, channel);
      } catch (err) {
        process.stderr.write(
          `[ws:pubsub] Handler en erreur sur ${channel}: ${(err as Error).message}\n`,
        );
      }
    }
  });
}

/**
 * Normalise un message Redis brut en WsEvent.
 *
 * Tolère deux formes :
 *  - la forme canonique `{ type, ... , at }` (publishToChannel) ;
 *  - la forme héritée `{ event: 'SEAT_HELD', seatDefinitionIds: [...] }`
 *    encore produite par `modules/seats/seats.service.ts`. Cette tolérance
 *    est délibérée : elle évite un temps réel muet pendant la migration du
 *    module seats vers `publishToChannel`. À supprimer une fois la
 *    migration faite.
 */
export function parseWsEvent(raw: string): WsEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const type = obj.type ?? obj.event; // `event` = forme héritée

  if (!isWsEventType(type)) return null;

  const event: WsEvent = {
    type,
    at: typeof obj.at === 'string' ? obj.at : new Date().toISOString(),
  };

  if (typeof obj.tripInstanceId === 'string') event.tripInstanceId = obj.tripInstanceId;
  if (typeof obj.seatDefinitionId === 'string') event.seatDefinitionId = obj.seatDefinitionId;
  if (typeof obj.seatCode === 'string') event.seatCode = obj.seatCode;
  if (typeof obj.bookingId === 'string') event.bookingId = obj.bookingId;
  if (typeof obj.userId === 'string') event.userId = obj.userId;
  if (typeof obj.cooperativeId === 'string') event.cooperativeId = obj.cooperativeId;

  const payload: Record<string, unknown> =
    typeof obj.payload === 'object' && obj.payload !== null && !Array.isArray(obj.payload)
      ? { ...(obj.payload as Record<string, unknown>) }
      : {};

  // Forme héritée : le module seats envoie un tableau d'identifiants de sièges.
  if (Array.isArray(obj.seatDefinitionIds)) {
    payload.seatDefinitionIds = obj.seatDefinitionIds;
  }
  if (typeof obj.expiresAt === 'string') {
    payload.expiresAt = obj.expiresAt;
  }

  if (Object.keys(payload).length > 0) {
    event.payload = payload;
  }

  return event;
}

// ---------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------

/**
 * Publie un événement sur un canal Redis. Tous les backends abonnés le
 * relaieront à leurs clients WebSocket.
 *
 * Ne jette jamais : une panne Redis ne doit pas faire échouer la
 * transaction métier qui vient de réussir (le siège est déjà verrouillé en
 * base — la contrainte d'unicité PostgreSQL reste la source de vérité).
 * L'erreur est journalisée ; l'UI se resynchronise via REST à la
 * reconnexion WS.
 */
export async function publishToChannel(channel: string, event: WsEvent): Promise<void> {
  const enriched: WsEvent = { ...event, at: event.at ?? new Date().toISOString() };
  try {
    await redisPub.publish(channel, JSON.stringify(enriched));
  } catch (err) {
    process.stderr.write(
      `[ws:pubsub] PUBLISH ${channel} échoué: ${(err as Error).message}\n`,
    );
  }
}

/**
 * Abonne un handler local à un canal. La souscription Redis effective n'est
 * émise que pour le premier handler du canal (idempotence côté Redis, mais
 * on évite le trafic inutile).
 *
 * Signature volontairement synchrone : l'appelant (serveur WS) ne doit pas
 * attendre Redis pour acquitter un `subscribe` client. Les messages publiés
 * pendant la fenêtre d'établissement sont perdus — c'est acceptable car le
 * client refetch l'état complet via `GET /v1/trips/{id}/seats` juste après
 * l'abonnement (architecture §5.1).
 */
export function subscribeToChannel(channel: string, handler: WsEventHandler): void {
  attachMessageListener();

  let set = handlers.get(channel);
  const isFirst = set === undefined;

  if (!set) {
    set = new Set<WsEventHandler>();
    handlers.set(channel, set);
  }
  set.add(handler);

  if (isFirst) {
    redisSub.subscribe(channel).catch((err: Error) => {
      process.stderr.write(
        `[ws:pubsub] SUBSCRIBE ${channel} échoué: ${err.message}\n`,
      );
    });
  }
}

/**
 * Retire un handler local. Le UNSUBSCRIBE Redis n'est émis que lorsque plus
 * aucun client de cette instance n'écoute le canal — sinon on couperait le
 * temps réel des autres clients connectés au même trajet.
 */
export function unsubscribeFromChannel(channel: string, handler: WsEventHandler): void {
  const set = handlers.get(channel);
  if (!set) return;

  set.delete(handler);
  if (set.size > 0) return;

  handlers.delete(channel);
  redisSub.unsubscribe(channel).catch((err: Error) => {
    process.stderr.write(
      `[ws:pubsub] UNSUBSCRIBE ${channel} échoué: ${err.message}\n`,
    );
  });
}

/** Nombre de handlers locaux sur un canal — utilisé par les tests de fuite. */
export function localHandlerCount(channel: string): number {
  return handlers.get(channel)?.size ?? 0;
}

/** Canaux Redis actuellement souscrits par cette instance. */
export function subscribedChannels(): string[] {
  return [...handlers.keys()];
}

/** Fermeture propre (arrêt du process, teardown de tests). */
export async function closePubSub(): Promise<void> {
  const channels = [...handlers.keys()];
  handlers.clear();
  if (channels.length > 0) {
    try {
      await redisSub.unsubscribe(...channels);
    } catch {
      // Connexion déjà tombée — rien à faire.
    }
  }
  try {
    await redisSub.quit();
  } catch {
    redisSub.disconnect();
  }
}
