'use client';

import { NAV_SECTIONS, isNavActive } from '@/lib/nav';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';

const COLLAPSE_KEY = 'nb.sidebar-collapsed';

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true);
    } catch {}
  }, []);
  const toggle = () =>
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  return { collapsed, toggle };
}

// Navigation rail. Fills its frame (the desktop `.app-side` column or the
// mobile drawer); width/borders are owned by the parent.
export function AppSidebar({
  orgName,
  userName,
  userEmail,
  collapsed = false,
  onToggleCollapse,
  onNavigate,
}: {
  orgName: string;
  userName: string | null;
  userEmail: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <aside
      className="sb"
      data-collapsed={collapsed ? 'true' : undefined}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        borderRadius: 0,
        background: 'transparent',
      }}
    >
      <OrgSwitcher activeName={orgName} compact={collapsed} />

      <nav className="sb__nav">
        {NAV_SECTIONS.map((section, si) => (
          <div key={section.label} className="sb__group">
            {collapsed ? (
              si > 0 && <div className="sb__rail-sep" />
            ) : (
              <div className="sb__group-label">{section.label}</div>
            )}
            {section.items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                onClick={onNavigate}
                title={collapsed ? it.label : undefined}
                className={`sb__item ${it.accent ? 'sb__item--accent' : ''}`}
                data-active={isNavActive(it, pathname) ? 'true' : undefined}
              >
                <Icon name={it.icon} size={18} />
                {!collapsed && (
                  <>
                    <span className="sb__item-label">{it.label}</span>
                    {it.count && <span className="sb__item-count">{it.count}</span>}
                    {it.badge && <span className="sb__item-badge">{it.badge}</span>}
                  </>
                )}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="sb__below">
        <Link
          href="/system"
          onClick={onNavigate}
          title={collapsed ? 'Design system' : undefined}
          className="sb__item"
        >
          <Icon name="palette" size={18} />
          {!collapsed && <span className="sb__item-label">Design system</span>}
        </Link>
      </div>

      {!collapsed && (
        <div className="sb__upsell">
          <p>You've used 86% of your free records.</p>
          <div className="sb__upsell-bar">
            <span style={{ width: '86%' }} />
          </div>
          <a href="/settings">
            Upgrade plan
            <Icon name="arrow-square-out" size={13} />
          </a>
        </div>
      )}

      <div className="sb__footrow" data-collapsed={collapsed ? 'true' : undefined}>
        <UserMenu name={userName} email={userEmail} compact={collapsed} />
        {onToggleCollapse && (
          <button
            type="button"
            className="sb__collapse"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={onToggleCollapse}
          >
            <Icon name={collapsed ? 'caret-right' : 'sidebar-simple'} size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}
