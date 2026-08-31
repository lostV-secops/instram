// =====================================================================
// InsTRAM — Canaux WebSocket
// Source : docs/architecture.md §2.3
//
// Un canal WS porte exactement le même nom que le canal Redis Pub/Sub
// correspondant. C'est volontaire : cela rend le fan-out inter-instances
// trivial (une instance backend s'abonne au canal Redis <=> au moins un
// de ses clients WS est abonné à ce canal).
//
// RÈGLE : aucun nom de canal ne doit jamais être construit à la main
// ailleurs dans le code. On passe toujours par ces helpers, sinon un
// simple écart de casse ou de séparateur casse silencieusement le temps
// réel (et donc la règle « zéro double réservation », qui repose sur la
// diffusion immédiate de SEAT_HELD / SEAT_SOLD).
// =====================================================================

export const CHANNEL_SEPARATOR = ':';

/** Canal de la carte des sièges d'un trajet — architecture §5.1. */
export const tripChannel = (id: string): string => `trip${CHANNEL_SEPARATOR}${id}`;

/** Canal privé d'un voyageur (paiement confirmé / échoué). */
export const bookingChannel = (userId: string): string =>
  `booking${CHANNEL_SEPARATOR}${userId}`;

/** Canal du tableau de bord temps réel d'une coopérative. */
export const coopChannel = (coopId: string): string =>
  `cooperative${CHANNEL_SEPARATOR}${coopId}`;

/** Canal de l'application conducteur pour un trajet donné. */
export const driverChannel = (tripId: string): string =>
  `driver${CHANNEL_SEPARATOR}${tripId}`;

// ---------------------------------------------------------------------
// Analyse / validation d'un nom de canal envoyé par un client
// ---------------------------------------------------------------------

export type WsChannelKind = 'trip' | 'booking' | 'cooperative' | 'driver';

export interface ParsedChannel {
  kind: WsChannelKind;
  /** Identifiant porté par le canal (tripInstanceId, userId, cooperativeId). */
  id: string;
  /** Nom canonique reconstruit — à utiliser comme clé, jamais l'entrée brute. */
  channel: string;
}

const KINDS: readonly WsChannelKind[] = ['trip', 'booking', 'cooperative', 'driver'];

/**
 * UUID v1-v8 (le schéma Prisma utilise `gen_random_uuid()` → v4).
 * On valide strictement l'identifiant : un client ne doit pas pouvoir
 * faire souscrire l'instance backend à un nom de canal Redis arbitraire
 * (surface d'attaque + explosion mémoire de la map d'abonnements).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidChannelId(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * Retourne null si le canal est inconnu, mal formé, ou si l'identifiant
 * n'est pas un UUID. Le serveur répond alors INVALID_CHANNEL sans jamais
 * toucher à Redis.
 */
export function parseChannel(raw: unknown): ParsedChannel | null {
  if (typeof raw !== 'string') return null;
  if (raw.length > 128) return null;

  const sepIndex = raw.indexOf(CHANNEL_SEPARATOR);
  if (sepIndex <= 0) return null;

  const kind = raw.slice(0, sepIndex);
  const id = raw.slice(sepIndex + 1);

  if (!KINDS.includes(kind as WsChannelKind)) return null;
  if (!isValidChannelId(id)) return null;

  return {
    kind: kind as WsChannelKind,
    id,
    channel: `${kind}${CHANNEL_SEPARATOR}${id}`,
  };
}
