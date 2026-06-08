'use client';

// The authed app shell: fixed sidebar + one topbar + scrolling content, with a
// global ⌘K palette and a mobile drawer < 1024px. Auth is resolved client-side
// via trpc.me.bootstrap (the session cookie lives on the API origin, so RSC
// can't read it) — no session → /sign-in, session but no org → /create-org.

import { trpc } from '@/lib/api';
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
import { CommandPalette } from '../ui/command';
import { AppSidebar, useSidebarCollapsed } from './app-sidebar';
import { AppTopbar } from './app-topbar';
import { Icon } from './icons';
import { MobileDrawer } from './mobile-drawer';
import { Spinner } from './primitives';

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

function FullScreenSpinner() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg-page)',
      }}
    >
      <Spinner style={{ color: 'var(--brand)' }} />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const boot = trpc.me.bootstrap.useQuery();
  const { collapsed, toggle: toggleCollapsed } = useSidebarCollapsed();
  const [actions, setActions] = useState<ReactNode>(null);
  const meta = pageMetaFor(pathname);

  useEffect(() => {
    if (!boot.data) return;
    if (!boot.data.session) router.replace('/sign-in');
    else if (!boot.data.activeOrg) router.replace('/create-org');
  }, [boot.data, router]);

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

  if (boot.isLoading || !boot.data || !boot.data.session || !boot.data.activeOrg) {
    return <FullScreenSpinner />;
  }
  const { session, activeOrg } = boot.data;
  const onSelect = (item: CmdItem) => {
    if (item.href) router.push(item.href);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <div className="app-side" data-collapsed={collapsed ? 'true' : undefined}>
          <AppSidebar
            orgName={activeOrg.name}
            userName={session.name}
            userEmail={session.email}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapsed}
          />
        </div>
        <MobileDrawer
          open={menu}
          onClose={() => setMenu(false)}
          orgName={activeOrg.name}
          userName={session.name}
          userEmail={session.email}
        />
        <div className="app-main">
          <AppTopbar
            crumbs={[{ label: meta.title }]}
            onOpenSearch={() => setPalette(true)}
            onOpenMenu={() => setMenu(true)}
          />
          <div className="app-content">
            <div className="app-wrap app-wrap--wide">
              <div className="page-head">
                {meta.icon && (
                  <div className="page-head__icon">
                    <Icon name={meta.icon} size={24} />
                  </div>
                )}
                <div className="page-head__text" style={{ minWidth: 0 }}>
                  <h1>{meta.title}</h1>
                  {meta.subtitle && <p>{meta.subtitle}</p>}
                </div>
                {actions && <div className="page-head__actions">{actions}</div>}
              </div>
              <PageActionsContext.Provider value={setActions as (n: ReactNode) => void}>
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                >
                  {children}
                </motion.div>
              </PageActionsContext.Provider>
            </div>
          </div>
        </div>
        <CommandPalette open={palette} onClose={() => setPalette(false)} onSelect={onSelect} />
      </div>
    </MotionConfig>
  );
}
