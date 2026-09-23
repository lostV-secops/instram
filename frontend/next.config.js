/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  webpack: (config) => {
    config.watchOptions = { poll: 1000, aggregateTimeout: 300 };
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '4000' },
      { protocol: 'https', hostname: 'api.instram.mg' },
      { protocol: 'https', hostname: 'staging.api.instram.mg' },
    ],
    formats: ['image/webp'],
  },
  async headers() {
    const isDev = process.env.NODE_ENV === 'development';

    // En dev, Next.js App Router injecte des scripts inline pour l'hydratation
    // et le HMR — unsafe-inline est requis, sinon React ne s'active pas.
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self'";

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
              "img-src 'self' data: blob: https://api.instram.mg https://staging.api.instram.mg http://localhost:4000",
              [
                "connect-src 'self'",
                "http://localhost:4000",
                "https://api.instram.mg",
                "https://staging.api.instram.mg",
                "ws://localhost:4000",
                "wss://api.instram.mg",
                "wss://staging.api.instram.mg",
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
