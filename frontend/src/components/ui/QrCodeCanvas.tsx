'use client';

import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface Props {
  payload: string;
  size?: number;
  alt?: string;
  downloadFilename?: string;
  downloadLabel?: string;
}

export function QrCodeCanvas({ payload, size = 200, alt, downloadFilename, downloadLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !payload) return;
    QRCode.toCanvas(canvasRef.current, payload, {
      width: size,
      margin: 2,
      color: { dark: '#162E49', light: '#ffffff' },
    }).catch(console.error);
  }, [payload, size]);

  function handleDownloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = downloadFilename ? `${downloadFilename}.png` : 'qr-code.png';
    a.click();
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        aria-label={alt ?? 'QR code'}
        className="rounded-lg"
      />
      {downloadFilename && (
        <button
          type="button"
          onClick={handleDownloadPng}
          className="text-xs text-brand underline hover:text-brand-dark transition-colors"
        >
          {downloadLabel ?? 'Télécharger PNG'}
        </button>
      )}
    </div>
  );
}
