'use client';

/**
 * Page de scan QR code — embarquement passager.
 *
 * Flux :
 *  1. QRScanner scanne le QR code → payload brut
 *  2. POST /api/proxy/v1/driver/trips/:tripId/board avec { qrPayload }
 *  3. Succès  → affiche nom + siège + badge "Embarqué"
 *  4. Erreurs → bandeaux colorés selon le code d'erreur API
 *     - INVALID_QR (403)   → rouge "QR invalide"
 *     - WRONG_TRIP (409)   → orange "Ce billet n'est pas pour ce trajet"
 *     - ALREADY_BOARDED (409) → bleu "Déjà embarqué"
 *  5. "Scanner suivant" → remet à zéro
 *
 * Fallback saisie manuelle disponible si le scan échoue.
 */

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { QRScanner } from '@/components/driver/QRScanner';
import { Button } from '@/components/ui/Button';
import type { BoardingEvent } from '@/lib/types';

type ScanState =
  | { status: 'idle' }          // caméra active, en attente de scan
  | { status: 'processing' }    // appel API en cours
  | { status: 'success'; event: BoardingEvent; passengerName?: string; seatCode?: string }
  | { status: 'error'; errorCode: string; message: string };

const ERROR_CONFIG: Record<string, { label: string; bgClass: string; textClass: string; borderClass: string }> = {
  INVALID_QR: {
    label: 'QR invalide — Ce billet n\'est pas reconnu',
    bgClass: 'bg-red-50',
    textClass: 'text-red-800',
    borderClass: 'border-red-200',
  },
  WRONG_TRIP: {
    label: 'Ce billet n\'est pas pour ce trajet',
    bgClass: 'bg-orange-50',
    textClass: 'text-orange-800',
    borderClass: 'border-orange-200',
  },
  ALREADY_BOARDED: {
    label: 'Ce passager est déjà embarqué',
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-800',
    borderClass: 'border-blue-200',
  },
  NOT_FOUND: {
    label: 'Billet introuvable',
    bgClass: 'bg-red-50',
    textClass: 'text-red-800',
    borderClass: 'border-red-200',
  },
  NETWORK: {
    label: 'Erreur réseau. Vérifiez votre connexion.',
    bgClass: 'bg-gray-100',
    textClass: 'text-gray-800',
    borderClass: 'border-gray-200',
  },
  GENERIC: {
    label: 'Une erreur est survenue. Réessayez.',
    bgClass: 'bg-gray-100',
    textClass: 'text-gray-800',
    borderClass: 'border-gray-200',
  },
};

const IconChevronLeft = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const IconCheck = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function ScanPage() {
  const params = useParams();
  const tripId = params.tripId as string;

  const [scanState, setScanState] = useState<ScanState>({ status: 'idle' });
  const [manualRef, setManualRef] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  const processPayload = useCallback(
    async (payload: { qrPayload?: string; bookingReference?: string }) => {
      setScanState({ status: 'processing' });

      try {
        const response = await fetch(
          `/api/proxy/v1/driver/trips/${tripId}/board`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            cache: 'no-store',
          },
        );

        if (response.ok) {
          const event = await response.json() as BoardingEvent;
          setScanState({
            status: 'success',
            event,
            passengerName: `${event.passenger.firstName} ${event.passenger.lastName}`.trim(),
            seatCode: event.seatCode,
          });
          return;
        }

        // Gestion des erreurs API
        let errorCode = 'GENERIC';
        let errorMessage = 'Une erreur est survenue. Réessayez.';

        try {
          const errorBody = await response.json() as { code?: string; message?: string };
          errorCode = errorBody.code ?? 'GENERIC';
          errorMessage = errorBody.message ?? errorMessage;
        } catch { /* ignorer les erreurs de parsing */ }

        // Normaliser le code d'erreur
        if (response.status === 403 || errorCode === 'INVALID_QR') {
          errorCode = 'INVALID_QR';
        } else if (response.status === 409) {
          if (errorCode === 'WRONG_TRIP') {
            errorCode = 'WRONG_TRIP';
          } else if (errorCode === 'ALREADY_BOARDED') {
            errorCode = 'ALREADY_BOARDED';
          }
        } else if (response.status === 404) {
          errorCode = 'NOT_FOUND';
        }

        const config = ERROR_CONFIG[errorCode] ?? ERROR_CONFIG.GENERIC;
        setScanState({
          status: 'error',
          errorCode,
          message: config.label,
        });

      } catch {
        setScanState({
          status: 'error',
          errorCode: 'NETWORK',
          message: ERROR_CONFIG.NETWORK.label,
        });
      }
    },
    [tripId],
  );

  const handleQRScan = useCallback(
    (payload: string) => {
      processPayload({ qrPayload: payload });
    },
    [processPayload],
  );

  const handleManualSubmit = async () => {
    const ref = manualRef.trim();
    if (!ref) return;
    setIsSubmittingManual(true);
    await processPayload({ bookingReference: ref });
    setIsSubmittingManual(false);
  };

  const handleReset = () => {
    setScanState({ status: 'idle' });
    setManualRef('');
    setShowManual(false);
  };

  const isScanning = scanState.status === 'idle';
  const isProcessing = scanState.status === 'processing';

  return (
    <div className="flex flex-col min-h-[calc(100vh-7rem)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-100">
        <Link
          href={`/fr/driver/trips/${tripId}`}
          className="flex items-center justify-center w-10 h-10 -ml-2 rounded-lg text-gray-600 hover:bg-gray-100"
          aria-label="Retour au détail du trajet"
        >
          <IconChevronLeft />
        </Link>
        <h1 className="text-base font-bold text-gray-900">Scanner un billet</h1>
      </div>

      {/* Zone scanner QR */}
      <div className="flex-1 bg-black relative">
        {/* Spinner de traitement superposé */}
        {isProcessing && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70 gap-4">
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
            <p className="text-white font-medium">Vérification du billet...</p>
          </div>
        )}

        {/* Scanner — actif uniquement en état idle */}
        <QRScanner onScan={handleQRScan} active={isScanning} />
      </div>

      {/* Zone de résultat / erreur / succès */}
      <div className="bg-white">
        {/* Succès */}
        {scanState.status === 'success' && (
          <div className="p-4 space-y-4" role="alert" aria-live="polite">
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                <IconCheck />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-gray-900">Embarquement validé</p>
                {scanState.passengerName && (
                  <p className="text-base font-semibold text-gray-800 mt-0.5">{scanState.passengerName}</p>
                )}
                {scanState.seatCode && (
                  <p className="text-sm text-gray-600 mt-0.5">
                    Siège <span className="font-semibold font-mono">{scanState.seatCode}</span>
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleReset}
              className="min-h-[52px]"
            >
              Scanner suivant
            </Button>
          </div>
        )}

        {/* Erreur */}
        {scanState.status === 'error' && (() => {
          const config = ERROR_CONFIG[scanState.errorCode] ?? ERROR_CONFIG.GENERIC;
          return (
            <div className="p-4 space-y-3" role="alert" aria-live="assertive">
              <div
                className={[
                  'flex items-start gap-3 p-3 rounded-lg border',
                  config.bgClass,
                  config.borderClass,
                ].join(' ')}
              >
                <svg
                  className={`w-5 h-5 flex-shrink-0 mt-0.5 ${config.textClass}`}
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
                <p className={`text-sm font-medium ${config.textClass}`}>
                  {scanState.message}
                </p>
              </div>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={handleReset}
                className="min-h-[52px]"
              >
                Scanner suivant
              </Button>
            </div>
          );
        })()}

        {/* Saisie manuelle — fallback si scan impossible */}
        {(scanState.status === 'idle' || scanState.status === 'error') && (
          <div className="border-t border-gray-100">
            {!showManual ? (
              <button
                type="button"
                onClick={() => setShowManual(true)}
                className="w-full py-3 text-sm text-brand font-medium text-center hover:bg-gray-50 active:bg-gray-100 min-h-[48px]"
              >
                Saisie manuelle de la référence
              </button>
            ) : (
              <div className="p-4 space-y-3">
                <p className="text-sm font-medium text-gray-700">Référence du billet</p>
                <input
                  type="text"
                  value={manualRef}
                  onChange={(e) => setManualRef(e.target.value.toUpperCase())}
                  placeholder="INST-XXXX"
                  className={[
                    'w-full px-4 py-3 border-2 border-gray-200 rounded-lg',
                    'text-base font-mono text-gray-900 placeholder-gray-400',
                    'focus:outline-none focus:border-brand',
                    'min-h-[48px]',
                  ].join(' ')}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="Référence du billet"
                />
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() => { setShowManual(false); setManualRef(''); }}
                    className="flex-1"
                  >
                    Annuler
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleManualSubmit}
                    isLoading={isSubmittingManual}
                    disabled={!manualRef.trim()}
                    className="flex-1"
                  >
                    {isSubmittingManual ? 'Validation...' : 'Valider'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
