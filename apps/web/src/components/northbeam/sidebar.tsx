// Sidebar showcase (classic / bar / rail). Direct port of
// design_handoff_northbeam/lib-sidebar.jsx — used by the /system gallery with
// mock data. The real app navigation rail lives in northbeam/app-sidebar.tsx.

'use client';

import { Icon, type IconName } from './icons';
import { Avatar, BrandChip, Kbd } from './primitives';

type Item = { icon: IconName; label: string; count?: string };

const NAV_MAIN: Item[] = [
  { icon: 'house', label: 'Home' },
  { icon: 'users-three', label: 'Contacts', count: '2.4k' },
  { icon: 'buildings', label: 'Accounts', count: '318' },
  { icon: 'currency-circle-dollar', label: 'Deals', count: '47' },
  { icon: 'lightning', label: 'Activities' },
];
const NAV_INSIGHTS: Item[] = [
  { icon: 'chart-line-up', label: 'Reports' },
  { icon: 'funnel', label: 'Pipeline' },
];

export function Sidebar({
  variant = 'classic',
  active = 'Contacts',
  onPalette,
}: {
  variant?: 'classic' | 'bar' | 'rail';
  active?: string;
  onPalette?: () => void;
}) {
  if (variant === 'rail') {
    const all = [...NAV_MAIN, ...NAV_INSIGHTS];
    return (
      <aside className="sb sb--rail">
        <div className="sb__brand">
          <BrandChip />
        </div>
        <nav className="sb__nav">
          {all.map((it) => (
            <button
              type="button"
              key={it.label}
              className="sb-rail__item"
              data-active={it.label === active ? 'true' : undefined}
              data-tip={it.label}
            >
              <Icon name={it.icon} size={20} />
            </button>
          ))}
          <div className="sb__rail-sep" />
          <button type="button" className="sb-rail__item" data-tip="Settings">
            <Icon name="gear-six" size={20} />
          </button>
        </nav>
        <div className="sb__footer">
          <Avatar name="Jordan Mills" className="sb__avatar" />
        </div>
      </aside>
    );
  }

  const barClass = variant === 'bar' ? 'sb sb--bar' : 'sb';
  return (
    <aside className={barClass}>
      <div className="sb__brand">
        <BrandChip />
        <div>
          <div className="sb__brand-name">Northbeam</div>
          <div className="sb__brand-sub">CRM Platform</div>
        </div>
      </div>
      <button type="button" className="sb__ws">
        <Avatar
          name="Acme Corp"
          className="sb__avatar"
          style={{ width: 24, height: 24, borderRadius: 6, fontSize: 10 }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, lineHeight: 1.2 }}>
            Acme Corp
          </div>
        </div>
        <Icon name="caret-up-down" size={16} />
      </button>
      <button type="button" className="sb__search" onClick={onPalette}>
        <Icon name="magnifying-glass" size={15} />
        Search…
        <Kbd>⌘K</Kbd>
      </button>
      <nav className="sb__nav">
        {NAV_MAIN.map((it) => (
          <button
            type="button"
            key={it.label}
            className="sb__item"
            data-active={it.label === active ? 'true' : undefined}
          >
            <Icon name={it.icon} size={18} />
            {it.label}
            {it.count && <span className="sb__item-count">{it.count}</span>}
          </button>
        ))}
        <div className="sb__group-label">Insights</div>
        {NAV_INSIGHTS.map((it) => (
          <button
            type="button"
            key={it.label}
            className="sb__item"
            data-active={it.label === active ? 'true' : undefined}
          >
            <Icon name={it.icon} size={18} />
            {it.label}
          </button>
        ))}
      </nav>
      <div style={{ padding: '0 10px 8px' }}>
        <button type="button" className="sb__item">
          <Icon name="gear-six" size={18} />
          Settings
        </button>
      </div>
      <div className="sb__footer">
        <Avatar name="Jordan Mills" className="sb__avatar" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, lineHeight: 1.2 }}>
            Jordan Mills
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
            jordan@acme.com
          </div>
        </div>
        <Icon name="dots-three" size={18} />
      </div>
    </aside>
  );
}
