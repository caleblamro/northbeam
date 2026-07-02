import { BRAND } from '@northbeam/config';
import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/northbeam/toaster';
import { ApiProvider } from '@/lib/api';
import { NO_FLASH_SCRIPT } from '@/lib/theme';
import { NuqsAdapter } from 'nuqs/adapters/next/app';

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  // 300 Light for refined hero numbers, 400 for tables, 500 for emphasis.
  weight: ['300', '400', '500'],
  display: 'swap',
});

const title = `${BRAND.name} — ${BRAND.tagline}`;

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title: { default: title, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Compact form fields render at 12.5–14px; pin scale so iOS Safari doesn't
  // auto-zoom on focus.
  maximumScale: 1,
  userScalable: false,
  // Mirrors --bg-page (light default).
  themeColor: '#f5f7fb',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        {/* Set data-theme/accent/density before paint to avoid FOUC. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static first-party no-FOUC theme script — no user input */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        {/* NuqsAdapter enables useQueryState URL params (e.g. ?tab= on setup pages). */}
        <NuqsAdapter>
          <ApiProvider>
            {children}
            <Toaster />
          </ApiProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
