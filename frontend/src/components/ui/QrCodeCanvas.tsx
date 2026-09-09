'use client';

import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface Props {
  payload: string;
  size?: number;
  alt?: string;
}

export function QrCodeCanvas({ payload, size = 200, alt }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !payload) return;
    QRCode.toCanvas(canvasRef.current, payload, {
      width: size,
      margin: 2,
      color: { dark: '#162E49', light: '#ffffff' },
    }).catch(console.error);
  }, [payload, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      aria-label={alt ?? 'QR code'}
      className="rounded-lg"
    />
  );
}
