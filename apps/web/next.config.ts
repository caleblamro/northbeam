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
  transpilePackages: ['@northbeam/config', '@northbeam/core'],
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
