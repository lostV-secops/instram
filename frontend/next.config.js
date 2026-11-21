// URLs publiques du backend (injectées au build — cf. Dockerfile ARG).
// Ajoutées à la CSP pour les déploiements sur IP / domaine personnalisé.
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const PUBLIC_WS_URL = process.env.NEXT_PUBLIC_WS_URL || '';
const toOrigin = (url) => {
  try {
    return new URL(url).origin; // ex. http://1.2.3.4:4000 / ws://1.2.3.4:4000
  } catch {
    return null;
  }
};
const extraApiOrigins = [toOrigin(PUBLIC_API_URL)].filter(Boolean);
const extraWsOrigins = [toOrigin(PUBLIC_WS_URL)].filter(Boolean);
const apiRemotePattern = (() => {
  try {
    const u = new URL(PUBLIC_API_URL);
    return [{ protocol: u.protocol.replace(':', ''), hostname: u.hostname, port: u.port }];
  } catch {
    return [];
  }
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Expose le flag sandbox aux composants client via process.env
  env: {
    NEXT_PUBLIC_GOALPAY_SANDBOX:
      process.env.GOALPAY_SANDBOX === 'true' ||
      process.env.NEXT_PUBLIC_GOALPAY_SANDBOX === 'true'
        ? 'true'
        : 'false',
  },
  // Image Docker (Dokploy) : sortie standalone. Vercel ne définit pas cette
  // variable et garde son build par défaut (standalone incompatible).
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  webpack: (config) => {
    config.watchOptions = { poll: 1000, aggregateTimeout: 300 };
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '4000' },
      { protocol: 'https', hostname: 'api.instram.mg' },
      { protocol: 'https', hostname: 'staging.api.instram.mg' },
      { protocol: 'https', hostname: 'instram-backend.fly.dev' },
      ...apiRemotePattern,
    ],
    formats: ['image/webp'],
  },
  async headers() {
    const isDev = process.env.NODE_ENV === 'development';

    // Next.js App Router injecte des scripts inline pour l'hydratation en dev ET en prod.
    // unsafe-inline est requis dans les deux cas ; unsafe-eval est réservé au dev (HMR).
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://api.instram.mg https://staging.api.instram.mg https://instram-backend.fly.dev http://localhost:4000" +
                (extraApiOrigins.length ? ` ${extraApiOrigins.join(' ')}` : ''),
              [
                "connect-src 'self'",
                "http://localhost:4000",
                "https://api.instram.mg",
                "https://staging.api.instram.mg",
                "https://instram-backend.fly.dev",
                "ws://localhost:4000",
                "wss://api.instram.mg",
                "wss://staging.api.instram.mg",
                "wss://instram-backend.fly.dev",
                ...extraApiOrigins,
                ...extraWsOrigins,
              ].join(' '),
              "font-src 'self'",
              "frame-src 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
