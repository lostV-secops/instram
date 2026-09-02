'use client';

/**
 * Hook React pour la connexion WebSocket InsTRAM.
 *
 * Architecture :
 *  - Le token (ticket court 60s) est obtenu côté serveur et passé en prop.
 *  - La connexion est établie sur wss://<NEXT_PUBLIC_WS_URL>?token=<ticket>
 *  - Après connexion, le hook envoie un message de subscription au canal.
 *  - Reconnexion automatique avec backoff exponentiel (1s → 2s → 4s … max 30s).
 *  - isReconnecting = true → l'UI doit afficher un bandeau bloquant.
 *
 * JAMAIS de polling (setInterval sur un endpoint REST).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { WsEvent } from './types';

const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000/ws';

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]; // ms
const MAX_RECONNECT_DELAY = 30000;

export interface UseWebSocketResult {
  lastEvent: WsEvent | null;
  isConnected: boolean;
  isReconnecting: boolean;
}

export function useWebSocket(
  channel: string,
  token: string | null,
): UseWebSocketResult {
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldConnectRef = useRef(true);
  const channelRef = useRef(channel);
  const tokenRef = useRef(token);

  // Mettre à jour les refs quand les props changent
  channelRef.current = channel;
  tokenRef.current = token;

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!shouldConnectRef.current) return;
    if (!tokenRef.current) {
      // Pas de token → pas de connexion WS (utilisateur non authentifié)
      return;
    }

    // Fermer toute connexion existante
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close();
    }

    try {
      const url = `${WS_BASE_URL}?token=${encodeURIComponent(tokenRef.current)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setIsReconnecting(false);
        reconnectAttemptRef.current = 0;

        // Envoyer le message de souscription au canal
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            channel: channelRef.current,
          }),
        );
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as WsEvent;
          if (data.event && data.channel) {
            setLastEvent(data);
          }
        } catch {
          // Message non-JSON ignoré silencieusement
        }
      };

      ws.onclose = (event: CloseEvent) => {
        setIsConnected(false);
        wsRef.current = null;

        if (!shouldConnectRef.current) return;

        // Reconnexion automatique sauf si fermeture volontaire (code 1000)
        if (event.code !== 1000) {
          setIsReconnecting(true);
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        // L'événement onclose sera déclenché juste après — pas besoin de logger ici
        setIsConnected(false);
      };
    } catch (err) {
      // Erreur lors de la création du WebSocket (ex. URL invalide)
      setIsConnected(false);
      if (shouldConnectRef.current) {
        setIsReconnecting(true);
        scheduleReconnect();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleReconnect = useCallback(() => {
    clearReconnectTimer();
    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(
      RECONNECT_DELAYS[attempt] ?? MAX_RECONNECT_DELAY,
      MAX_RECONNECT_DELAY,
    );
    reconnectAttemptRef.current = attempt + 1;

    reconnectTimerRef.current = setTimeout(() => {
      if (shouldConnectRef.current) {
        connect();
      }
    }, delay);
  }, [connect, clearReconnectTimer]);

  useEffect(() => {
    shouldConnectRef.current = true;

    if (token) {
      connect();
    }

    return () => {
      // Nettoyage à la destruction du composant
      shouldConnectRef.current = false;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
      setIsConnected(false);
      setIsReconnecting(false);
    };
    // On ne relance pas la connexion si channel/token changent dans le même
    // composant — c'est géré par les refs. On veut juste une connexion stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return { lastEvent, isConnected, isReconnecting };
}
