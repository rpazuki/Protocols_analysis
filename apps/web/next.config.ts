import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Loads the monorepo-root .env.
 *
 * Next only reads .env from the app directory, but this repo keeps one .env at
 * the root so the web app, the operational scripts, and docker compose all
 * read the same values. Deliberately dependency-free and duplicated from
 * scripts/db/env.ts, because that copy has to run on the VM during recovery
 * without installing anything.
 */
function loadRootEnv(): void {
  const file = path.resolve(process.cwd(), '..', '..', '.env');
  if (!existsSync(file)) return;

  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    // Real environment variables always win over the file.
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadRootEnv();

const isDev = process.env.NODE_ENV !== 'production';

/**
 * React's development build uses eval() for debugging features, so the dev CSP
 * has to allow it. Production keeps script-src without 'unsafe-eval'.
 */
const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'";
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || process.env.APP_BASE_PATH || '/protocols').replace(/\/$/, '') || '/';

// Both resolution and standalone tracing must include hoisted dependencies and
// sibling packages, regardless of lockfile-based root detection on the VM.
const workspaceRoot = path.resolve(__dirname, '../..');

const config: NextConfig = {
  basePath,
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  // Emits a self-contained server bundle so the production image on the
  // Imperial VM does not need node_modules or a package manager.
  output: 'standalone',
  // The workspace packages ship TypeScript source rather than build output.
  transpilePackages: [
    '@protocols/domain',
    '@protocols/db',
    '@protocols/auth-core',
    '@protocols/auth-mock',
    '@protocols/auth-entra-oidc',
    '@protocols/auth-shibboleth-saml',
  ],
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Server actions are same-origin checked by Next; this keeps the allowed
    // origin list explicit when the app sits behind the VM reverse proxy.
    serverActions: {
      allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "img-src 'self' data:",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              // ws: is the dev hot-reload socket; harmless in production where it is unused.
              isDev ? "connect-src 'self' ws:" : "connect-src 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
      {
        // Report pages and exports must never be cached by an intermediary.
        source: '/(reports|admin|auth)/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
};

export default config;
