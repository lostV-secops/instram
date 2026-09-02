'use client';

/**
 * Composant scanner QR code via getUserMedia + canvas natif + jsQR.
 *
 * Stratégie :
 * 1. useEffect : getUserMedia({ video: { facingMode: 'environment' } })
 * 2. Flux vidéo affiché en plein écran (fond noir)
 * 3. requestAnimationFrame dessine chaque frame sur un canvas caché
 * 4. getImageData() → jsQR() → si trouvé, onScan(result.data) est appelé
 * 5. Cleanup : track.stop() + cancelAnimationFrame à la destruction
 *
 * Pas de bibliothèque externe lourde — jsQR fait ~24 KB gzip.
 * jsQR est importé dynamiquement dans useEffect pour éviter les problèmes SSR.
 *
 * Erreur accès caméra → message explicite avec bouton réessayer.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

interface QRScannerProps {
  /** Appelé avec le payload brut du QR code décodé */
  onScan: (payload: string) => void;
  /** Si true, le scanner est actif */
  active?: boolean;
}

type CameraState =
  | { status: 'requesting' }
  | { status: 'active' }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string };

export function QRScanner({ onScan, active = true }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number | null>(null);
  const onScanRef = useRef(onScan);
  const scanningRef = useRef(false); // évite les appels multiples entre deux frames

  const [cameraState, setCameraState] = useState<CameraState>({ status: 'requesting' });
  const [retryCount, setRetryCount] = useState(0);

  // Mettre à jour le ref si onScan change
  onScanRef.current = onScan;

  const stopCamera = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    scanningRef.current = false;
  }, []);

  const startScanning = useCallback(async () => {
    if (!active) return;

    setCameraState({ status: 'requesting' });
    scanningRef.current = false;

    try {
      // Accès caméra arrière (environment)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) { stopCamera(); return; }

      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();

      setCameraState({ status: 'active' });

      // Import dynamique de jsQR pour éviter les erreurs SSR
      const jsQRModule = await import('jsqr');
      const jsQR = jsQRModule.default;

      const canvas = canvasRef.current;
      if (!canvas) { stopCamera(); return; }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { stopCamera(); return; }

      const tick = () => {
        if (!videoRef.current || videoRef.current.readyState !== 4) {
          animRef.current = requestAnimationFrame(tick);
          return;
        }

        const v = videoRef.current;
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

        if (!scanningRef.current) {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });

          if (code) {
            scanningRef.current = true; // bloquer jusqu'à reset explicite
            onScanRef.current(code.data);
            return; // arrêter la boucle après un scan réussi
          }
        }

        animRef.current = requestAnimationFrame(tick);
      };

      animRef.current = requestAnimationFrame(tick);

    } catch (err) {
      const error = err as Error;
      if (
        error.name === 'NotAllowedError' ||
        error.name === 'PermissionDeniedError'
      ) {
        setCameraState({
          status: 'denied',
          message: 'Autorisez l\'accès à la caméra dans les paramètres de votre téléphone',
        });
      } else if (
        error.name === 'NotFoundError' ||
        error.name === 'DevicesNotFoundError'
      ) {
        setCameraState({
          status: 'error',
          message: 'Aucune caméra détectée sur cet appareil',
        });
      } else if (error.name === 'NotSupportedError') {
        setCameraState({
          status: 'error',
          message: 'Le scanner n\'est pas pris en charge par ce navigateur',
        });
      } else {
        setCameraState({
          status: 'error',
          message: 'Impossible d\'accéder à la caméra. Réessayez.',
        });
      }
    }
  }, [active, stopCamera]);

  // Lancer/arrêter le scanner selon le prop `active`
  useEffect(() => {
    if (active) {
      startScanning();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [active, startScanning, stopCamera, retryCount]);

  const handleRetry = () => {
    stopCamera();
    setRetryCount((n) => n + 1);
  };

  // ─── États d'erreur d'accès caméra ──────────────────────────────────────────

  if (cameraState.status === 'denied') {
    return (
      <div className="flex flex-col items-center justify-center bg-black min-h-[60vh] p-6 text-center gap-4">
        <svg
          className="w-16 h-16 text-gray-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
        <p className="text-white text-base font-medium">
          {cameraState.message}
        </p>
        <p className="text-gray-400 text-sm">
          Rendez-vous dans Paramètres &gt; Applications &gt; Navigateur &gt; Autorisations &gt; Caméra
        </p>
        <button
          type="button"
          onClick={handleRetry}
          className="mt-2 px-6 py-3 bg-brand text-white rounded-lg font-medium text-sm min-h-[48px] min-w-[140px]"
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (cameraState.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center bg-black min-h-[60vh] p-6 text-center gap-4">
        <svg
          className="w-12 h-12 text-red-400"
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
        <p className="text-white text-base font-medium">{cameraState.message}</p>
        <button
          type="button"
          onClick={handleRetry}
          className="mt-2 px-6 py-3 bg-brand text-white rounded-lg font-medium text-sm min-h-[48px] min-w-[140px]"
        >
          Réessayer
        </button>
      </div>
    );
  }

  // ─── Viewfinder caméra ────────────────────────────────────────────────────────

  return (
    <div className="relative w-full bg-black overflow-hidden" style={{ minHeight: '60vh' }}>
      {/* Canvas caché pour analyse des frames */}
      <canvas
        ref={canvasRef}
        className="hidden"
        aria-hidden="true"
      />

      {/* Flux vidéo */}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
        autoPlay
        aria-label="Flux caméra pour scanner QR code"
      />

      {/* Overlay avec cadre de visée */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {/* Fond semi-transparent autour du cadre */}
        <div className="absolute inset-0 bg-black/40" aria-hidden="true" />

        {/* Cadre de visée */}
        <div
          className="relative w-56 h-56 z-10"
          role="img"
          aria-label="Cadre de visée QR code"
        >
          {/* Coins du cadre */}
          {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map((pos, i) => (
            <div
              key={i}
              className={`absolute ${pos} w-8 h-8`}
              aria-hidden="true"
            >
              <div
                className={[
                  'absolute w-full h-1 bg-white',
                  i < 2 ? 'top-0' : 'bottom-0',
                ].join(' ')}
              />
              <div
                className={[
                  'absolute h-full w-1 bg-white',
                  i % 2 === 0 ? 'left-0' : 'right-0',
                ].join(' ')}
              />
            </div>
          ))}

          {/* Ligne de scan animée */}
          <div
            className="absolute left-2 right-2 h-0.5 bg-brand/80 top-1/2 animate-pulse"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Indicateur de chargement (état requesting) */}
      {cameraState.status === 'requesting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-20">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-white text-sm">Activation de la caméra...</p>
          </div>
        </div>
      )}

      {/* Instruction de scan */}
      {cameraState.status === 'active' && (
        <div className="absolute bottom-6 left-0 right-0 flex justify-center z-10 pointer-events-none">
          <p className="text-white text-sm bg-black/50 px-4 py-2 rounded-full">
            Pointez vers le QR code du billet
          </p>
        </div>
      )}
    </div>
  );
}

export default QRScanner;
