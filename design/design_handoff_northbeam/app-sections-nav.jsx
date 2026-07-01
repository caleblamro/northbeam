/* app-sections-nav.jsx — Sidebar variations + Command palette */

function SidebarSection({ onOpenPalette }) {
  return (
    <section className="section" id="sidebar">
      <div className="section__head">
        <div className="section__eyebrow">Components · variations to choose from</div>
        <h2 className="section__title">Sidebar</h2>
        <p className="section__desc">
          The primary navigation rail: workspace switcher, search trigger, grouped nav with counts,
          and a user footer. Three directions — pick the active-state treatment and width that fit.
        </p>
      </div>
      <div className="grid grid--3">
        <div>
          <div className="subhead" style={{ fontSize: 'var(--text-base)', margin: '0 0 12px' }}>
            Classic{' '}
            <span className="badge badge--brand" style={{ height: 20 }}>
              Recommended
            </span>
          </div>
          <p className="note">Tinted pill marks the active item.</p>
          <Sidebar variant="classic" active="Contacts" onPalette={onOpenPalette} />
        </div>
        <div>
          <div className="subhead" style={{ fontSize: 'var(--text-base)', margin: '0 0 12px' }}>
            Accent bar
          </div>
          <p className="note">A left accent bar instead of a fill.</p>
          <Sidebar variant="bar" active="Deals" onPalette={onOpenPalette} />
        </div>
        <div>
          <div className="subhead" style={{ fontSize: 'var(--text-base)', margin: '0 0 12px' }}>
            Icon rail
          </div>
          <p className="note">Collapsed to 64px with hover labels — maximizes canvas.</p>
          <Sidebar variant="rail" active="Contacts" />
        </div>
      </div>
    </section>
  );
}

function CommandSection({ onOpenPalette }) {
  const [localOpen, setLocalOpen] = useState(false);
  return (
    <section className="section" id="command">
      <div className="section__head">
        <div className="section__eyebrow">Components</div>
        <h2 className="section__title">Command palette</h2>
        <p className="section__desc">
          A keyboard-first launcher (<span className="kbd">⌘K</span>) that unifies quick actions,
          navigation, and search across records. Arrow keys move, Enter selects, Esc closes — try
          it.
        </p>
      </div>
      <div className="frame">
        <div className="frame__bar">
          <h4>Live preview</h4>
          <p>opens inside this frame</p>
          <span className="frame__tag">
            <Button variant="primary" icon="command" onClick={() => setLocalOpen(true)}>
              Open palette
            </Button>
          </span>
        </div>
        <div
          className="frame__body frame__body--center"
          style={{
            position: 'relative',
            minHeight: 460,
            padding: 0,
            overflow: 'hidden',
            background: 'var(--surface-sunken)',
          }}
        >
          {/* faux app backdrop */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              opacity: 0.5,
            }}
            aria-hidden="true"
          >
            <div
              style={{
                height: 40,
                background: 'var(--surface)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
              }}
            />
            <div className="grid grid--3" style={{ gap: 14 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 96,
                    background: 'var(--surface)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                  }}
                />
              ))}
            </div>
            <div
              style={{
                flex: 1,
                background: 'var(--surface)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
              }}
            />
          </div>
          {!localOpen && (
            <button
              className="btn btn--secondary"
              onClick={() => setLocalOpen(true)}
              style={{ position: 'relative', zIndex: 2 }}
            >
              <i className="ph ph-magnifying-glass" />
              Press to open ·{' '}
              <span className="kbd" style={{ marginLeft: 4 }}>
                ⌘K
              </span>
            </button>
          )}
          <CommandPalette open={localOpen} onClose={() => setLocalOpen(false)} contained />
        </div>
      </div>
      <div className="callout">
        <i className="ph ph-keyboard" />
        <span>
          Bound globally to <span className="kbd">⌘K</span> / <span className="kbd">Ctrl K</span> on
          this page too — press it anytime. Results group into <b>Quick actions</b>, <b>Go to</b>,
          and <b>Records</b>, and fuzzy-filter as you type.
        </span>
      </div>
    </section>
  );
}

Object.assign(window, { SidebarSection, CommandSection });
