/* lib-sidebar.jsx — Sidebar (classic / bar / rail variants) */

const NAV_MAIN = [
  { icon: 'house', label: 'Home' },
  { icon: 'users-three', label: 'Contacts', count: '2.4k' },
  { icon: 'buildings', label: 'Accounts', count: '318' },
  { icon: 'currency-circle-dollar', label: 'Deals', count: '47' },
  { icon: 'lightning', label: 'Activities' },
];
const NAV_INSIGHTS = [
  { icon: 'chart-line-up', label: 'Reports' },
  { icon: 'funnel', label: 'Pipeline' },
];
const NAV_FOOT = [{ icon: 'gear-six', label: 'Settings' }];

function Sidebar({ variant = 'classic', active = 'Contacts', onPalette }) {
  if (variant === 'rail') {
    const all = [...NAV_MAIN, ...NAV_INSIGHTS];
    return (
      <aside className="sb sb--rail">
        <div className="sb__brand">
          <span className="sb__logo">N</span>
        </div>
        <nav className="sb__nav">
          {all.map((it) => (
            <button
              key={it.label}
              className="sb-rail__item"
              data-active={it.label === active ? 'true' : undefined}
              data-tip={it.label}
            >
              <i className={`ph ph-${it.icon}`} />
            </button>
          ))}
          <div className="sb__rail-sep" />
          <button className="sb-rail__item" data-tip="Settings">
            <i className="ph ph-gear-six" />
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
        <span className="sb__logo">N</span>
        <div>
          <div className="sb__brand-name">Northbeam</div>
          <div className="sb__brand-sub">CRM Platform</div>
        </div>
      </div>
      <div className="sb__ws">
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
        <i className="ph ph-caret-up-down" />
      </div>
      <button className="sb__search" onClick={onPalette}>
        <i className="ph ph-magnifying-glass" />
        Search…
        <span className="kbd">⌘K</span>
      </button>
      <nav className="sb__nav">
        {NAV_MAIN.map((it) => (
          <button
            key={it.label}
            className="sb__item"
            data-active={it.label === active ? 'true' : undefined}
          >
            <i className={`ph ph-${it.icon}`} />
            {it.label}
            {it.count && <span className="sb__item-count">{it.count}</span>}
          </button>
        ))}
        <div className="sb__group-label">Insights</div>
        {NAV_INSIGHTS.map((it) => (
          <button
            key={it.label}
            className="sb__item"
            data-active={it.label === active ? 'true' : undefined}
          >
            <i className={`ph ph-${it.icon}`} />
            {it.label}
          </button>
        ))}
      </nav>
      <div style={{ padding: '0 10px 8px' }}>
        <button className="sb__item">
          <i className="ph ph-gear-six" />
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
        <i className="ph ph-dots-three" />
      </div>
    </aside>
  );
}

Object.assign(window, { Sidebar, NAV_MAIN });
