'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations, useLang } from '@/components/TranslationsProvider';
import { QRScanner } from '@/components/driver/QRScanner';
import { Button } from '@/components/ui/Button';
import type { BoardingEvent } from '@/lib/types';

type ScanState =
  | { status: 'idle' }
  | { status: 'processing' }
  | { status: 'success'; event: BoardingEvent; passengerName?: string; seatCode?: string }
  | { status: 'error'; errorCode: string; message: string };

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
  const t = useTranslations();
  const lang = useLang();
  const td = t.driver;
  const tripId = params.tripId as string;

  const [scanState, setScanState] = useState<ScanState>({ status: 'idle' });
  const [manualRef, setManualRef] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  const ERROR_BG: Record<string, string> = {
    INVALID_QR: 'bg-red-50 border-red-200',
    WRONG_TRIP: 'bg-orange-50 border-orange-200',
    ALREADY_BOARDED: 'bg-blue-50 border-blue-200',
    NOT_FOUND: 'bg-red-50 border-red-200',
    NETWORK: 'bg-gray-100 border-gray-200',
    GENERIC: 'bg-gray-100 border-gray-200',
  };
  const ERROR_TEXT: Record<string, string> = {
    INVALID_QR: 'text-red-800',
    WRONG_TRIP: 'text-orange-800',
    ALREADY_BOARDED: 'text-blue-800',
    NOT_FOUND: 'text-red-800',
    NETWORK: 'text-gray-800',
    GENERIC: 'text-gray-800',
  };

  const processPayload = useCallback(async (payload: { qrPayload?: string; bookingReference?: string }) => {
    setScanState({ status: 'processing' });
    try {
      const response = await fetch(`/api/proxy/v1/driver/trips/${tripId}/board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });

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

      let errorCode = 'GENERIC';
      try {
        const errorBody = await response.json() as { code?: string; message?: string };
        errorCode = errorBody.code ?? 'GENERIC';
      } catch { /* ignorer */ }

      if (response.status === 403 || errorCode === 'INVALID_QR') errorCode = 'INVALID_QR';
      else if (response.status === 409 && errorCode !== 'WRONG_TRIP' && errorCode !== 'ALREADY_BOARDED') errorCode = 'GENERIC';
      else if (response.status === 404) errorCode = 'NOT_FOUND';

      const errors = td.scan.errors as Record<string, string>;
      setScanState({ status: 'error', errorCode, message: errors[errorCode] ?? errors.GENERIC });
    } catch {
      setScanState({ status: 'error', errorCode: 'NETWORK', message: (td.scan.errors as Record<string, string>).NETWORK });
    }
  }, [tripId, td]);

  const handleQRScan = useCallback((payload: string) => { processPayload({ qrPayload: payload }); }, [processPayload]);

  const handleManualSubmit = async () => {
    const ref = manualRef.trim();
    if (!ref) return;
    setIsSubmittingManual(true);
    await processPayload({ bookingReference: ref });
    setIsSubmittingManual(false);
  };

  const handleReset = () => { setScanState({ status: 'idle' }); setManualRef(''); setShowManual(false); };

  const isScanning = scanState.status === 'idle';
  const isProcessing = scanState.status === 'processing';

  return (
    <div className="flex flex-col min-h-[calc(100vh-7rem)]">
      <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-100">
        <Link href={`/${lang}/driver/trips/${tripId}`} className="flex items-center justify-center w-10 h-10 -ml-2 rounded-lg text-gray-600 hover:bg-gray-100" aria-label={t.common.back}>
          <IconChevronLeft />
        </Link>
        <h1 className="text-base font-bold text-gray-900">{td.scan.title}</h1>
      </div>

      <div className="flex-1 bg-black relative">
        {isProcessing && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70 gap-4">
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
            <p className="text-white font-medium">{td.scan.processing}</p>
          </div>
        )}
        <QRScanner onScan={handleQRScan} active={isScanning} />
      </div>

      <div className="bg-white">
        {scanState.status === 'success' && (
          <div className="p-4 space-y-4" role="alert" aria-live="polite">
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                <IconCheck />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-gray-900">{td.scan.successTitle}</p>
                {scanState.passengerName && <p className="text-base font-semibold text-gray-800 mt-0.5">{scanState.passengerName}</p>}
                {scanState.seatCode && (
                  <p className="text-sm text-gray-600 mt-0.5">{td.scan.successSeat} <span className="font-semibold font-mono">{scanState.seatCode}</span></p>
                )}
              </div>
            </div>
            <Button variant="primary" size="lg" fullWidth onClick={handleReset} className="min-h-[52px]">
              {td.scan.scanNext}
            </Button>
          </div>
        )}

        {scanState.status === 'error' && (() => {
          const bg = ERROR_BG[scanState.errorCode] ?? ERROR_BG.GENERIC;
          const text = ERROR_TEXT[scanState.errorCode] ?? ERROR_TEXT.GENERIC;
          return (
            <div className="p-4 space-y-3" role="alert" aria-live="assertive">
              <div className={`flex items-start gap-3 p-3 rounded-lg border ${bg}`}>
                <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${text}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className={`text-sm font-medium ${text}`}>{scanState.message}</p>
              </div>
              <Button variant="primary" size="lg" fullWidth onClick={handleReset} className="min-h-[52px]">{td.scan.scanNext}</Button>
            </div>
          );
        })()}

        {(scanState.status === 'idle' || scanState.status === 'error') && (
          <div className="border-t border-gray-100">
            {!showManual ? (
              <button type="button" onClick={() => setShowManual(true)} className="w-full py-3 text-sm text-brand font-medium text-center hover:bg-gray-50 active:bg-gray-100 min-h-[48px]">
                {td.scan.manualEntry}
              </button>
            ) : (
              <div className="p-4 space-y-3">
                <p className="text-sm font-medium text-gray-700">{td.scan.manualEntry}</p>
                <input
                  type="text"
                  value={manualRef}
                  onChange={(e) => setManualRef(e.target.value.toUpperCase())}
                  placeholder={td.scan.manualPlaceholder}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg text-base font-mono text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand min-h-[48px]"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label={td.scan.manualEntry}
                />
                <div className="flex gap-2">
                  <Button variant="ghost" size="md" onClick={() => { setShowManual(false); setManualRef(''); }} className="flex-1">
                    {t.common.cancel}
                  </Button>
                  <Button variant="primary" size="md" onClick={handleManualSubmit} isLoading={isSubmittingManual} disabled={!manualRef.trim()} className="flex-1">
                    {isSubmittingManual ? td.scan.manualSubmitting : td.scan.manualSubmit}
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
