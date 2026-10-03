import type { WebSocket as WsSocket } from 'ws';
import {
  subscribeToChannel,
  unsubscribeFromChannel,
  localHandlerCount,
  type WsEvent,
} from './pubsub';

// =====================================================================
// InsTRAM — Hub de fan-out WebSocket (registre local d'une instance)
//
// Rôle : faire le pont entre les canaux Redis Pub/Sub (inter-instances) et
// les sockets ouverts sur CETTE instance.
//
// Invariants tenus par ce hub — ce sont eux qui empêchent les fuites
// mémoire et les diffusions fantômes :
//   I1. `channels[c]` n'existe que si elle contient au moins un client.
//   I2. Un handler Redis est enregistré pour `c` si et seulement si
//       `channels[c]` existe.
//   I3. `client.channels` est toujours le miroir exact de l'appartenance
//       du client dans `channels`.
// La méthode `stats()` sert d'assertion de ces invariants dans les tests.
// =====================================================================

/** Au-delà, on considère le socket bloqué (téléphone 3G figé) et on le coupe. */
const MAX_BUFFERED_BYTES = 1_000_000;

export interface WsClient {
  /** Identifiant de connexion (pas d'utilisateur) — une personne peut avoir n onglets. */
  id: string;
  userId: string;
  roles: string[];
  socket: WsSocket;
  channels: Set<string>;
  /** Heartbeat : passé à false avant chaque ping, remis à true au pong. */
  isAlive: boolean;
  connectedAt: number;
}

export interface WsHubStats {
  clients: number;
  channels: number;
  /** Détail canal -> nombre de clients locaux. */
  byChannel: Record<string, number>;
}

const OPEN_STATE = 1; // ws.WebSocket.OPEN

export class WsHub {
  private readonly clients = new Set<WsClient>();
  private readonly channels = new Map<string, Set<WsClient>>();
  private readonly redisHandlers = new Map<string, (event: WsEvent) => void>();

  addClient(client: WsClient): void {
    this.clients.add(client);
  }

  hasClient(client: WsClient): boolean {
    return this.clients.has(client);
  }

  /**
   * Abonne un client à un canal. Le premier client d'un canal déclenche la
   * souscription Redis ; les suivants sont gratuits.
   * Retourne false si le client était déjà abonné (subscribe idempotent).
   */
  subscribe(client: WsClient, channel: string): boolean {
    if (client.channels.has(channel)) return false;

    let set = this.channels.get(channel);
    if (!set) {
      set = new Set<WsClient>();
      this.channels.set(channel, set);

      // I2 : un handler Redis par canal, pas un par client.
      const handler = (event: WsEvent): void => {
        this.broadcastLocal(channel, event);
      };
      this.redisHandlers.set(channel, handler);
      subscribeToChannel(channel, handler);
    }

    set.add(client);
    client.channels.add(channel);
    return true;
  }

  /**
   * Désabonne un client. Le UNSUBSCRIBE Redis n'a lieu que si plus aucun
   * client local n'écoute — sinon on couperait le temps réel des autres
   * voyageurs sur le même trajet (violation directe du « zéro double
   * réservation » côté UI).
   */
  unsubscribe(client: WsClient, channel: string): boolean {
    if (!client.channels.delete(channel)) return false;

    const set = this.channels.get(channel);
    if (!set) return true;

    set.delete(client);
    if (set.size === 0) {
      this.channels.delete(channel); // I1
      const handler = this.redisHandlers.get(channel);
      if (handler) {
        this.redisHandlers.delete(channel);
        unsubscribeFromChannel(channel, handler);
      }
    }
    return true;
  }

  /** Déconnexion : retire le client de TOUS ses canaux, puis du registre. */
  removeClient(client: WsClient): void {
    for (const channel of [...client.channels]) {
      this.unsubscribe(client, channel);
    }
    client.channels.clear();
    this.clients.delete(client);
  }

  /** Diffuse un événement à tous les clients locaux d'un canal. */
  broadcastLocal(channel: string, event: WsEvent): number {
    const set = this.channels.get(channel);
    if (!set || set.size === 0) return 0;

    // Transformation vers le format attendu par le frontend :
    // { event, channel, payload: { ...champs }, at }
    const { type, at, payload: existingPayload, ...directFields } = event;
    const frame = JSON.stringify({
      event: type,
      channel,
      payload: { ...existingPayload, ...directFields },
      at,
    });
    let sent = 0;

    for (const client of [...set]) {
      if (client.socket.readyState !== OPEN_STATE) continue;

      // Anti-backpressure : un client trop lent ne doit pas faire gonfler la
      // mémoire du serveur. On le coupe, il se reconnectera et refetchera
      // l'état complet en REST (architecture §5.1, bandeau « reconnexion... »).
      if (client.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        try {
          client.socket.close(4008, 'SLOW_CONSUMER');
        } catch {
          /* socket déjà mort */
        }
        continue;
      }

      try {
        client.socket.send(frame);
        sent += 1;
      } catch {
        /* envoi impossible : le handler 'close' fera le ménage */
      }
    }
    return sent;
  }

  clientCount(): number {
    return this.clients.size;
  }

  channelCount(): number {
    return this.channels.size;
  }

  clientsOn(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }

  /** Nombre de handlers Redis locaux — doit toujours égaler `channelCount()`. */
  redisHandlerCount(): number {
    return this.redisHandlers.size;
  }

  /** Vue de contrôle des invariants I1/I2/I3 (tests de fuite mémoire). */
  stats(): WsHubStats {
    const byChannel: Record<string, number> = {};
    for (const [channel, set] of this.channels) {
      byChannel[channel] = set.size;
    }
    return {
      clients: this.clients.size,
      channels: this.channels.size,
      byChannel,
    };
  }

  /**
   * Vérifie les invariants du hub, y compris la cohérence avec le registre
   * Pub/Sub. Retourne la liste des violations (vide = tout va bien).
   */
  assertInvariants(): string[] {
    const problems: string[] = [];

    if (this.redisHandlers.size !== this.channels.size) {
      problems.push(
        `I2 violé: ${this.redisHandlers.size} handlers Redis pour ${this.channels.size} canaux`,
      );
    }

    for (const [channel, set] of this.channels) {
      if (set.size === 0) problems.push(`I1 violé: canal vide non purgé (${channel})`);
      if (localHandlerCount(channel) === 0) {
        problems.push(`I2 violé: aucun handler pubsub pour ${channel}`);
      }
      for (const client of set) {
        if (!client.channels.has(channel)) {
          problems.push(`I3 violé: ${client.id} listé sur ${channel} sans le savoir`);
        }
        if (!this.clients.has(client)) {
          problems.push(`I3 violé: ${client.id} abonné mais absent du registre`);
        }
      }
    }

    for (const client of this.clients) {
      for (const channel of client.channels) {
        if (!this.channels.get(channel)?.has(client)) {
          problems.push(`I3 violé: ${client.id} croit être sur ${channel}`);
        }
      }
    }

    return problems;
  }

  /** Ferme tous les sockets et vide le registre (arrêt du serveur / teardown). */
  closeAll(code = 1001, reason = 'SERVER_SHUTDOWN'): void {
    for (const client of [...this.clients]) {
      try {
        client.socket.close(code, reason);
      } catch {
        /* déjà fermé */
      }
      this.removeClient(client);
    }
  }
}
