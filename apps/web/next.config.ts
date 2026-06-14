import path from 'node:path';
import type { NextConfig } from 'next';

// Host redirects. Mirrors BRAND.url / BRAND.redirectFrom — inlined because
// next.config.ts compiles in an isolated step that doesn't honor
// `transpilePackages`, so workspace imports here fail at build time.
const CANONICAL_ORIGIN = 'https://northbeam.app';
const REDIRECT_FROM_HOSTS = ['www.northbeam.app'];

const config: NextConfig = {
  reactStrictMode: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error'] } : false,
  },
  // @northbeam/db is in here so client components can transitively reach the
  // `/roles` subpath (re-exported through @northbeam/core's PERMISSION_GROUPS
  // / ROLE_LABELS). That subpath is a tiny pure-TS file with no drizzle / pg
  // dependencies, so adding the package here doesn't drag the ORM into the
  // browser bundle — tree-shaking drops anything not actually imported.
  transpilePackages: ['@northbeam/config', '@northbeam/core', '@northbeam/db'],
  typedRoutes: false,
  // Workspace packages use NodeNext-style `.js` imports against `.ts` source.
  turbopack: {
    // Pin the workspace root — a stray lockfile in a parent dir otherwise makes
    // Next infer the wrong root for file tracing.
    root: path.join(import.meta.dirname, '..', '..'),
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.mts', '.cjs', '.json'],
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    return config;
  },
  async redirects() {
    return REDIRECT_FROM_HOSTS.map((host) => ({
      source: '/:path*',
      has: [{ type: 'host', value: host }],
      destination: `${CANONICAL_ORIGIN}/:path*`,
      permanent: true,
    }));
  },
};

export default config;
