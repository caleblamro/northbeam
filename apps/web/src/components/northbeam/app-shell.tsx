'use client';

// The authed app shell: Salesforce Lightning-style single-row top nav (App
// Launcher + org switcher + pinned tabs + global search + actions). Auth is
// resolved client-side via trpc.me.bootstrap (the session cookie lives on the
// API origin, so RSC can't read it) — no session → /sign-in, session but no
// org → /create-org.

import { type RouterOutputs, trpc } from '@/lib/api';
import type { CmdItem } from '@/lib/cmd-data';
import { pageMetaFor } from '@/lib/nav';
import { MotionConfig, motion } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  AiComposerDrawer,
  AiComposerScope,
  AiComposerSurface,
  COMPOSER_WIDTH,
  useAiComposer,
} from './ai-composer';
import { AppTopbar } from './app-topbar';
import { CommandPalette } from './command-legacy';
import { Spinner } from './primitives';
import { useRecordVisitTracker } from './use-record-visit';

// Lets a page inject action buttons into the layout-owned page header without
// re-declaring the header. Actions are static per page, so we register on mount.
const PageActionsContext = createContext<(n: ReactNode) => void>(() => {});

export function PageActions({ children }: { children: ReactNode }) {
  const set = useContext(PageActionsContext);
  const ref = useRef<ReactNode>(children);
  ref.current = children;
  useLayoutEffect(() => {
    set(ref.current);
    return () => set(null);
  }, [set]);
  return null;
}

// Lets a page (e.g. a record detail page that brings its own highlight header)
// suppress the layout-owned page-head and render full-bleed.
const HideHeadContext = createContext<(v: boolean) => void>(() => {});

export function HidePageHead() {
  const set = useContext(HideHeadContext);
  useLayoutEffect(() => {
    set(true);
    return () => set(false);
  }, [set]);
  return null;
}

function FullScreenSpinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <Spinner style={{ color: 'var(--ink-muted)' }} />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const boot = trpc.me.bootstrap.useQuery();

  useEffect(() => {
    if (!boot.data) return;
    if (!boot.data.session) router.replace('/sign-in');
    else if (!boot.data.activeOrg) router.replace('/create-org');
  }, [boot.data, router]);

  if (boot.isLoading || !boot.data || !boot.data.session || !boot.data.activeOrg) {
    return <FullScreenSpinner />;
  }
  const { session, activeOrg } = boot.data;

  return (
    <MotionConfig reducedMotion="user">
      <AiComposerScope>
        <ShellFrame session={session} activeOrg={activeOrg}>
          {children}
        </ShellFrame>
      </AiComposerScope>
    </MotionConfig>
  );
}

/** The chrome + content frame. Separate from AppShell so it can read the AI
 *  composer context (the content column shifts left while the drawer is
 *  docked, and the page body swaps for the live preview). */
type Boot = RouterOutputs['me']['bootstrap'];

function ShellFrame({
  session,
  activeOrg,
  children,
}: {
  session: NonNullable<Boot['session']>;
  activeOrg: NonNullable<Boot['activeOrg']>;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [palette, setPalette] = useState(false);
  const [actions, setActions] = useState<ReactNode>(null);
  const [hideHead, setHideHead] = useState(false);
  const meta = pageMetaFor(pathname);
  const composer = useAiComposer();
  // Record-page visits register in the recents list (nav tab menus, palette).
  useRecordVisitTracker();

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const onSelect = (item: CmdItem) => {
    if (item.id === 'ai-generate') {
      composer.open();
      return;
    }
    if (item.href) router.push(item.href);
  };

  return (
    <div
      className="app transition-[padding-right] duration-200"
      style={{ paddingRight: composer.isOpen ? COMPOSER_WIDTH : 0 }}
    >
      <div className="app-chrome">
        <AppTopbar
          orgName={activeOrg.name}
          userName={session.name}
          userEmail={session.email}
          onOpenSearch={() => setPalette(true)}
        />
      </div>
      <div className="app-content">
        <div className="app-wrap app-wrap--wide">
          {/* The AI preview brings its own PageHeader — suppress the layout's
              page-head while one is active so titles don't stack. */}
          {!hideHead && !composer.preview && (
            <div className="page-head">
              <div className="page-head__text" style={{ minWidth: 0 }}>
                <h1>{meta.title}</h1>
                {meta.subtitle && <p>{meta.subtitle}</p>}
              </div>
              {actions && <div className="page-head__actions">{actions}</div>}
            </div>
          )}
          <HideHeadContext.Provider value={setHideHead}>
            <PageActionsContext.Provider value={setActions as (n: ReactNode) => void}>
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <AiComposerSurface>{children}</AiComposerSurface>
              </motion.div>
            </PageActionsContext.Provider>
          </HideHeadContext.Provider>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} onSelect={onSelect} />
      <AiComposerDrawer />
    </div>
  );
}
