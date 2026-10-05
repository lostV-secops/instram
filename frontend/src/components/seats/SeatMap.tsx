'use client';

/**
 * Carte des sièges en temps réel — Client Component.
 *
 * Fonctionnement :
 * 1. L'état initial est reçu en props (chargé côté serveur via REST).
 * 2. Le hook useWebSocket maintient une connexion WS sur `trip:{tripId}`.
 * 3. Les événements SEAT_HELD / SEAT_SOLD / SEAT_RELEASED mettent à jour
 *    l'état local < 200 ms.
 * 4. L'utilisateur peut sélectionner jusqu'à 6 sièges AVAILABLE.
 * 5. "Continuer" (VERT #9CC43D) déclenche le hold via /api/proxy, puis
 *    redirige vers la page de réservation.
 * 6. Bandeau rouge bloquant si WS déconnecté.
 * 7. Compte à rebours 2 min sur les holds de l'utilisateur.
 *
 * RÈGLE : pas de polling. Aucun setInterval ne consomme un endpoint REST.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type MouseEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { useWebSocket } from '@/lib/ws';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import Button from '@/components/ui/Button';
import { SeatLegend } from './SeatLegend';
import type { Seat, SeatHoldResponse, SeatConflictResponse, WsEvent } from '@/lib/types';
import type { Translations } from '@/lib/i18n';

const HOLD_DURATION_SECONDS = 2 * 60; // 2 minutes

interface SeatMapProps {
  tripId: string;
  initialSeats: Seat[];
  /** Ticket JWT court (60s) obtenu côté serveur — null si non authentifié */
  wsToken: string | null;
  /** Nombre de sièges demandés lors de la recherche (défaut 6) */
  maxSeats?: number;
}

// ─── Styles par statut ────────────────────────────────────────────────────────
function getSeatClasses(
  displayStatus: string,
  isSelected: boolean,
  isDisabled: boolean,
): string {
  const base =
    'w-10 h-10 text-xs font-medium border-2 rounded transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1';

  if (displayStatus === 'SOLD') {
    return `${base} bg-red-500 border-red-600 text-white cursor-not-allowed`;
  }
  if (displayStatus === 'HELD') {
    return `${base} bg-gray-200 border-gray-300 text-gray-400 cursor-not-allowed`;
  }
  if (displayStatus === 'HELD_BY_ME') {
    return `${base} bg-brand-light border-brand text-white focus:ring-brand`;
  }
  // AVAILABLE
  if (isSelected) {
    return `${base} bg-brand-light border-brand text-white focus:ring-brand`;
  }
  return [
    base,
    'bg-white border-brand text-brand focus:ring-brand',
    isDisabled
      ? 'cursor-not-allowed opacity-50'
      : 'cursor-pointer hover:bg-brand hover:text-white',
  ].join(' ');
}

export function SeatMap({ tripId, initialSeats, wsToken, maxSeats = 6 }: SeatMapProps) {
  const t = useTranslations();
  const lang = useLang();
  const router = useRouter();

  // ─── État des sièges ────────────────────────────────────────────────────────
  // Les sièges HELD_BY_ME (retour d'un tunnel abandonné) sont traités comme
  // AVAILABLE et pré-sélectionnés : le hold en cours sera libéré par PaymentForm.
  const [seats, setSeats] = useState<Seat[]>(() =>
    initialSeats.map((s) =>
      s.status === 'HELD_BY_ME' ? { ...s, status: 'AVAILABLE' as const } : s,
    ),
  );
  /** IDs de sièges sélectionnés par l'utilisateur (avant hold) */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () =>
      new Set(
        initialSeats
          .filter((s) => s.status === 'HELD_BY_ME')
          .map((s) => s.seatDefinitionId),
      ),
  );
  /** IDs de sièges que l'utilisateur a réussi à hold */
  const [heldByMeIds, setHeldByMeIds] = useState<Set<string>>(new Set());

  // ─── Hold ───────────────────────────────────────────────────────────────────
  const [holdId, setHoldId] = useState<string | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<Date | null>(null);
  const [holdCountdown, setHoldCountdown] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── WebSocket ──────────────────────────────────────────────────────────────
  const { lastEvent, isConnected, isReconnecting } = useWebSocket(
    `trip:${tripId}`,
    wsToken,
  );

  // ─── Traitement des événements WS ───────────────────────────────────────────
  useEffect(() => {
    if (!lastEvent) return;
    const { event, payload } = lastEvent as WsEvent & {
      payload: { seatDefinitionId?: string };
    };
    const sid = payload?.seatDefinitionId;
    if (!sid) return;

    setSeats((prev) =>
      prev.map((seat) => {
        if (seat.seatDefinitionId !== sid) return seat;
        switch (event) {
          case 'SEAT_HELD':
            // Ne pas écraser nos propres holds
            if (heldByMeIds.has(sid)) return seat;
            return { ...seat, status: 'HELD' };
          case 'SEAT_SOLD':
            return { ...seat, status: 'SOLD' };
          case 'SEAT_RELEASED':
            return { ...seat, status: 'AVAILABLE' };
          default:
            return seat;
        }
      }),
    );
  }, [lastEvent, heldByMeIds]);

  // ─── Compte à rebours hold ──────────────────────────────────────────────────
  useEffect(() => {
    if (!holdExpiresAt) return;

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.floor((holdExpiresAt.getTime() - Date.now()) / 1000),
      );
      setHoldCountdown(remaining);

      if (remaining === 0) {
        // Hold expiré : libérer la sélection
        setHoldId(null);
        setHoldExpiresAt(null);
        setHeldByMeIds(new Set());
        setSelectedIds(new Set());
        setHoldError(t.seats.holdExpired);
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
      }
    };

    tick(); // Calcul immédiat
    countdownIntervalRef.current = setInterval(tick, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [holdExpiresAt, t.seats.holdExpired]);

  // ─── Sélection d'un siège ───────────────────────────────────────────────────
  const toggleSeat = useCallback(
    (seat: Seat) => {
      // Blocage si WS déconnecté OU si utilisateur non authentifié
      if (isReconnecting || !isConnected) return;
      if (!wsToken) return; // Pas authentifié

      // Seuls les sièges AVAILABLE sont sélectionnables
      if (seat.status !== 'AVAILABLE') return;
      // Si un hold est déjà actif, ne pas modifier la sélection
      if (holdId) return;

      setHoldError(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(seat.seatDefinitionId)) {
          next.delete(seat.seatDefinitionId);
        } else if (next.size < maxSeats) {
          next.add(seat.seatDefinitionId);
        }
        return next;
      });
    },
    [isReconnecting, isConnected, wsToken, holdId],
  );

  // ─── Poser un hold puis rediriger ───────────────────────────────────────────
  const handleContinue = useCallback(
    async (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (selectedIds.size === 0 || isHolding) return;

      setIsHolding(true);
      setHoldError(null);

      try {
        const response = await fetch(
          `/api/proxy/v1/trips/${tripId}/seats/hold`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              seatDefinitionIds: Array.from(selectedIds),
            }),
          },
        );

        if (response.status === 409) {
          const conflict = (await response.json()) as SeatConflictResponse;
          // Désactiver les sièges en conflit
          if (conflict.conflictingSeats?.length) {
            const conflictIds = new Set(
              conflict.conflictingSeats.map((s) => s.seatDefinitionId),
            );
            setSeats((prev) =>
              prev.map((seat) =>
                conflictIds.has(seat.seatDefinitionId)
                  ? { ...seat, status: 'HELD' }
                  : seat,
              ),
            );
            setSelectedIds((prev) => {
              const next = new Set(prev);
              conflictIds.forEach((id) => next.delete(id));
              return next;
            });
          }
          setHoldError(t.seats.seatUnavailable);
          return;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const holdData = (await response.json()) as SeatHoldResponse;

        setHoldId(holdData.holdId);
        setHoldExpiresAt(new Date(holdData.expiresAt));
        setHeldByMeIds(new Set(selectedIds));

        // Redirection vers la page de réservation
        const params = new URLSearchParams({
          holdId: holdData.holdId,
          tripId,
          expiresAt: holdData.expiresAt,
        });
        router.push(`/${lang}/bookings/new?${params.toString()}`);
      } catch (err) {
        if (err instanceof Error && err.message.includes('fetch')) {
          setHoldError(t.common.errorNetwork);
        } else {
          setHoldError(t.common.errorServer);
        }
      } finally {
        setIsHolding(false);
      }
    },
    [selectedIds, isHolding, tripId, lang, router, t],
  );

  // ─── Grouper les sièges par rangée ──────────────────────────────────────────
  const seatsByRow = seats.reduce<Map<number, Seat[]>>((acc, seat) => {
    const row = seat.row ?? 0;
    if (!acc.has(row)) acc.set(row, []);
    acc.get(row)!.push(seat);
    return acc;
  }, new Map());

  const sortedRows = Array.from(seatsByRow.entries()).sort(
    ([a], [b]) => a - b,
  );

  const formatCountdown = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <section aria-label={t.seats.title}>
      {/* Bandeau de reconnexion — bloque la sélection */}
      {isReconnecting && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-yellow-50 border border-yellow-400 text-yellow-800 rounded-lg px-4 py-3 mb-4 text-sm font-medium"
        >
          {t.seats.reconnecting}
        </div>
      )}

      {/* Bandeau connexion perdue (WS jamais établi mais token absent) */}
      {!wsToken && (
        <div className="bg-gray-50 border border-gray-300 text-gray-600 rounded-lg px-4 py-3 mb-4 text-sm">
          {t.seats.seatViewOnly} —{' '}
          <a
            href={`/${lang}/auth/login?redirect=/${lang}/trips/${tripId}`}
            className="text-brand underline font-medium"
          >
            {t.auth.loginButton}
          </a>
        </div>
      )}

      {/* Erreur de hold */}
      {holdError && (
        <div
          role="alert"
          aria-live="polite"
          className="bg-red-50 border border-red-400 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm"
        >
          {holdError}
        </div>
      )}

      {/* Compte à rebours du hold */}
      {holdId && holdCountdown > 0 && (
        <div
          aria-live="polite"
          aria-label={`${t.seats.holdExpiry} ${formatCountdown(holdCountdown)}`}
          className="bg-brand/10 border border-brand text-brand rounded-lg px-4 py-3 mb-4 text-sm flex items-center gap-2"
        >
          <span className="font-bold tabular-nums text-base">
            {formatCountdown(holdCountdown)}
          </span>
          <span>{t.seats.holdExpiry}</span>
        </div>
      )}

      {/* Info sélection */}
      <p className="text-sm text-gray-600 mb-3">
        {t.seats.selected.replace('{count}', String(selectedIds.size))}
        {' — '}
        {t.seats.maxSeats.replace('{max}', String(maxSeats))}
      </p>

      {/* Grille de sièges */}
      <div className="overflow-x-auto -mx-1 px-1" aria-label="Plan de sièges">
        <div className="min-w-max space-y-2">
          {sortedRows.map(([row, rowSeats]) => (
            <div key={row} className="flex items-center gap-2">
              {/* Numéro de rangée */}
              <span className="text-xs text-gray-400 w-5 text-right select-none shrink-0">
                {row > 0 ? row : ''}
              </span>

              {/* Sièges de la rangée */}
              <div className="flex gap-1.5">
                {[...rowSeats]
                  .sort((a, b) => (a.column ?? 0) - (b.column ?? 0))
                  .map((seat) => {
                    const isSelected = selectedIds.has(seat.seatDefinitionId);
                    const isMine = heldByMeIds.has(seat.seatDefinitionId);
                    const displayStatus = isMine
                      ? 'HELD_BY_ME'
                      : seat.status;

                    const isInteractive =
                      seat.status === 'AVAILABLE' &&
                      !isReconnecting &&
                      !!wsToken &&
                      !holdId;

                    return (
                      <button
                        key={seat.seatDefinitionId}
                        type="button"
                        onClick={() => toggleSeat(seat)}
                        disabled={!isInteractive}
                        aria-pressed={isSelected || isMine}
                        aria-label={[
                          `${t.seats.title} ${seat.code}`,
                          `(${seat.priceMga.toLocaleString('fr-MG')} ${t.common.ariary})`,
                          `— ${t.seats.legend[
                            displayStatus === 'HELD_BY_ME'
                              ? 'heldByMe'
                              : displayStatus === 'HELD'
                              ? 'held'
                              : displayStatus === 'SOLD'
                              ? 'sold'
                              : 'available'
                          ]}`,
                        ].join(' ')}
                        title={`${seat.code} — ${seat.priceMga.toLocaleString('fr-MG')} Ar`}
                        className={getSeatClasses(
                          displayStatus,
                          isSelected,
                          !isInteractive,
                        )}
                      >
                        {seat.code}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Légende */}
      <SeatLegend t={t} />

      {/* Bouton "Continuer vers la réservation" — VERT TRANSACTIONNEL */}
      <div className="mt-6">
        <Button
          variant="action"
          size="lg"
          fullWidth
          onClick={handleContinue}
          isLoading={isHolding}
          disabled={
            selectedIds.size === 0 ||
            selectedIds.size > maxSeats ||
            isHolding ||
            isReconnecting ||
            (!isConnected && !!wsToken) ||
            !!holdId
          }
          aria-label={
            selectedIds.size > 0
              ? `${t.seats.continueToBooking} (${selectedIds.size} siège${selectedIds.size > 1 ? 's' : ''})`
              : t.seats.continueToBooking
          }
        >
          {isHolding
            ? t.common.loading
            : selectedIds.size > 0
            ? `${t.seats.continueToBooking} (${selectedIds.size})`
            : t.seats.continueToBooking}
        </Button>
      </div>
    </section>
  );
}

export default SeatMap;
