'use client';

/**
 * Bouton "Signaler le départ" avec confirmation modale.
 *
 * Machine à états :
 *  idle       → bouton "Signaler le départ" (variant=action — vert UNIQUEMENT ici)
 *  confirming → modal de confirmation "Confirmer le départ ?"
 *  loading    → spinner, appel POST /v1/driver/trips/:tripId/depart
 *  done       → badge "Départ signalé à HH:MM" (non cliquable)
 *  error      → message d'erreur + bouton "Réessayer"
 *
 * Le vert #9CC43D (variant="action") est utilisé UNIQUEMENT ici
 * car "Signaler le départ" est une action transactionnelle.
 */

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import type { TripInstanceStatus } from '@/lib/types';

interface DepartureButtonProps {
  tripInstanceId: string;
  /** Si true, le bouton affiche l'état "déjà parti" au montage */
  alreadyDeparted?: boolean;
  /** Heure de départ si déjà parti (ISO string) */
  departedAt?: string;
  /** Callback optionnel appelé après succès */
  onDeparted?: (departedAt: string) => void;
}

type DepartureState =
  | { status: 'idle' }
  | { status: 'confirming' }
  | { status: 'loading' }
  | { status: 'done'; departedAt: string }
  | { status: 'error'; message: string };

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}h${d.getMinutes().toString().padStart(2, '0')}`;
}

export function DepartureButton({
  tripInstanceId,
  alreadyDeparted = false,
  departedAt,
  onDeparted,
}: DepartureButtonProps) {
  const [state, setState] = useState<DepartureState>(() => {
    if (alreadyDeparted && departedAt) {
      return { status: 'done', departedAt };
    }
    if (alreadyDeparted) {
      return { status: 'done', departedAt: new Date().toISOString() };
    }
    return { status: 'idle' };
  });

  const handleConfirm = useCallback(async () => {
    setState({ status: 'loading' });

    try {
      const response = await fetch(
        `/api/proxy/v1/driver/trips/${tripInstanceId}/depart`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          cache: 'no-store',
        },
      );

      if (!response.ok) {
        let errorMessage = 'Impossible d\'enregistrer le départ. Vérifiez votre connexion.';
        try {
          const body = await response.json() as { message?: string };
          if (body.message) errorMessage = body.message;
        } catch { /* ignorer */ }
        setState({ status: 'error', message: errorMessage });
        return;
      }

      const data = await response.json() as TripInstanceStatus;
      const now = new Date().toISOString();
      const doneDepartedAt = now;
      setState({ status: 'done', departedAt: doneDepartedAt });
      onDeparted?.(doneDepartedAt);

    } catch {
      setState({
        status: 'error',
        message: 'Erreur réseau. Vérifiez votre connexion et réessayez.',
      });
    }
  }, [tripInstanceId, onDeparted]);

  // ─── Rendu selon l'état ────────────────────────────────────────────────────

  if (state.status === 'done') {
    return (
      <div
        className="flex items-center justify-center gap-2 py-3 px-4 bg-gray-100 rounded-xl border border-gray-200"
        role="status"
        aria-live="polite"
      >
        <svg
          className="w-5 h-5 text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="text-sm font-medium text-gray-700">
          Départ signalé à {formatTime(state.departedAt)}
        </span>
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-4" aria-live="polite">
        <div
          className="w-6 h-6 border-4 border-brand border-t-transparent rounded-full animate-spin"
          role="status"
          aria-label="Enregistrement du départ en cours"
        />
        <span className="text-sm text-gray-600">Enregistrement du départ...</span>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="space-y-3" role="alert">
        <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
          <svg
            className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm text-red-700">{state.message}</p>
        </div>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => setState({ status: 'idle' })}
        >
          Réessayer
        </Button>
      </div>
    );
  }

  // ─── idle ou confirming ────────────────────────────────────────────────────

  return (
    <>
      {/* Bouton déclencheur — vert transactionnel (variant="action") */}
      <Button
        variant="action"
        size="lg"
        fullWidth
        onClick={() => setState({ status: 'confirming' })}
        className="min-h-[52px] text-base"
        aria-haspopup="dialog"
      >
        <svg
          className="w-5 h-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        Signaler le départ
      </Button>

      {/* Modal de confirmation */}
      {state.status === 'confirming' && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="departure-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setState({ status: 'idle' });
          }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden">
            {/* En-tête modal */}
            <div className="p-5 border-b border-gray-100">
              <h2
                id="departure-modal-title"
                className="text-lg font-bold text-gray-900 text-center"
              >
                Confirmer le départ ?
              </h2>
              <p className="text-sm text-gray-500 text-center mt-1">
                Cette action est irréversible. Le départ du véhicule sera enregistré à l&apos;heure actuelle.
              </p>
            </div>

            {/* Actions */}
            <div className="p-4 flex flex-col gap-3">
              {/* Confirmer — vert transactionnel */}
              <Button
                variant="action"
                size="lg"
                fullWidth
                onClick={handleConfirm}
                className="min-h-[52px] text-base"
              >
                Confirmer le départ
              </Button>

              {/* Annuler — secondaire */}
              <Button
                variant="ghost"
                size="lg"
                fullWidth
                onClick={() => setState({ status: 'idle' })}
                className="min-h-[52px] text-base"
              >
                Annuler
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default DepartureButton;
