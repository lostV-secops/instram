/**
 * Tests pour src/lib/ws.ts — hook useWebSocket.
 * Utilise un mock de WebSocket global pour simuler les événements serveur.
 */

import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '@/lib/ws';

// ─── Mock WebSocket ───────────────────────────────────────────────────────────

class MockWebSocket {
  static CLOSED = 3;
  static CONNECTING = 0;
  static OPEN = 1;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  static instances: MockWebSocket[] = [];
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: code ?? 1000, reason, wasClean: true } as CloseEvent);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  simulateError() {
    this.onerror?.(new Event('error'));
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1006, reason: '', wasClean: false } as CloseEvent);
  }
}

global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

jest.useFakeTimers();

beforeEach(() => {
  MockWebSocket.instances = [];
  jest.clearAllTimers();
});

afterEach(() => {
  jest.clearAllTimers();
});

describe('useWebSocket', () => {
  // ─── Pas de connexion sans token ──────────────────────────────────────────

  it('ne crée pas de WebSocket si token est null', () => {
    renderHook(() => useWebSocket('trip:t1', null));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('retourne isConnected=false et isReconnecting=false sans token', () => {
    const { result } = renderHook(() => useWebSocket('trip:t1', null));
    expect(result.current.isConnected).toBe(false);
    expect(result.current.isReconnecting).toBe(false);
    expect(result.current.lastEvent).toBeNull();
  });

  // ─── Connexion avec token ─────────────────────────────────────────────────

  it('crée un WebSocket avec le token dans l\'URL', () => {
    renderHook(() => useWebSocket('trip:t1', 'mytoken'));
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('token=mytoken');
  });

  it('passe isConnected=true à l\'ouverture', () => {
    const { result } = renderHook(() => useWebSocket('trip:t1', 'tok'));
    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });
    expect(result.current.isConnected).toBe(true);
    expect(result.current.isReconnecting).toBe(false);
  });

  it('envoie un message de souscription au canal à l\'ouverture', () => {
    renderHook(() => useWebSocket('trip:abc', 'tok'));
    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });
    const ws = MockWebSocket.instances[0];
    expect(ws.sentMessages).toHaveLength(1);
    const msg = JSON.parse(ws.sentMessages[0]);
    expect(msg).toEqual({ type: 'subscribe', channel: 'trip:abc' });
  });

  // ─── Réception d'événements ───────────────────────────────────────────────

  it('met à jour lastEvent sur réception d\'un événement valide', () => {
    const { result } = renderHook(() => useWebSocket('trip:t1', 'tok'));
    act(() => { MockWebSocket.instances[0].simulateOpen(); });

    const event = { event: 'SEAT_HELD', channel: 'trip:t1', data: { seatId: 's1' } };
    act(() => { MockWebSocket.instances[0].simulateMessage(event); });

    expect(result.current.lastEvent).toEqual(event);
  });

  it('ignore les messages sans champs event ou channel', () => {
    const { result } = renderHook(() => useWebSocket('trip:t1', 'tok'));
    act(() => { MockWebSocket.instances[0].simulateOpen(); });

    act(() => { MockWebSocket.instances[0].simulateMessage({ type: 'ping' }); });
    expect(result.current.lastEvent).toBeNull();
  });

  it('ignore les messages JSON invalides sans planter', () => {
    const { result } = renderHook(() => useWebSocket('trip:t1', 'tok'));
    act(() => { MockWebSocket.instances[0].simulateOpen(); });

    act(() => {
      MockWebSocket.instances[0].onmessage?.({ data: 'not-json' } as MessageEvent);
    });
    expect(result.current.lastEvent).toBeNull();
  });

  // ─── Reconnexion automatique ─────────────────────────────────────────────

  it('passe isReconnecting=true après déconnexion inattendue', () => {
    const { result } = renderHook(() => useWebSocket('trip:t1', 'tok'));
    act(() => { MockWebSocket.instances[0].simulateOpen(); });

    act(() => {
      MockWebSocket.instances[0].readyState = MockWebSocket.CLOSED;
      MockWebSocket.instances[0].onclose?.({ code: 1006, wasClean: false } as CloseEvent);
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.isReconnecting).toBe(true);
  });

  it('tente une reconnexion après le délai backoff (1s)', () => {
    const { result } = renderHook(() => useWebSocket('trip:t1', 'tok'));
    act(() => { MockWebSocket.instances[0].simulateOpen(); });
    act(() => {
      MockWebSocket.instances[0].onclose?.({ code: 1006, wasClean: false } as CloseEvent);
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(MockWebSocket.instances).toHaveLength(2); // nouvelle tentative
  });

  it('ne tente pas de reconnexion si fermeture volontaire (code 1000)', () => {
    const { result } = renderHook(() => useWebSocket('trip:t1', 'tok'));
    act(() => { MockWebSocket.instances[0].simulateOpen(); });

    act(() => {
      MockWebSocket.instances[0].close(1000); // fermeture propre
    });

    act(() => { jest.advanceTimersByTime(5000); });
    expect(MockWebSocket.instances).toHaveLength(1); // pas de reconnexion
    expect(result.current.isReconnecting).toBe(false);
  });

  // ─── Nettoyage ────────────────────────────────────────────────────────────

  it('ferme le WebSocket proprement au démontage', () => {
    const { unmount } = renderHook(() => useWebSocket('trip:t1', 'tok'));
    act(() => { MockWebSocket.instances[0].simulateOpen(); });

    unmount();

    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED);
  });
});
