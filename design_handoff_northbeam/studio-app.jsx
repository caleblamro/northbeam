/* studio-app.jsx — Studio shell: nav, routing, copilot, ⌘K, theme */

const NAV = [
  { sec: 'Data model' },
  { id: 'objects', label: 'Objects', icon: 'stack' },
  { id: 'schema', label: 'Schema', icon: 'tree-structure' },
  { sec: 'Experience' },
  { id: 'layouts', label: 'Record layouts', icon: 'layout' },
  { sec: 'Intelligence' },
  { id: 'reports', label: 'Reports & AI', icon: 'chart-line-up' },
  { sec: 'Setup' },
  { id: 'migration', label: 'Salesforce migration', icon: 'arrows-clockwise' },
];
const SCREEN_OF = {
  objects: 'objects',
  object: 'detail',
  schema: 'schema',
  layouts: 'layouts',
  reports: 'reports',
  migration: 'migration',
};
const CRUMB = {
  objects: 'Objects',
  schema: 'Schema',
  layouts: 'Record layouts',
  reports: 'Reports & AI',
  migration: 'Salesforce migration',
};

function StudioApp() {
  const [route, setRoute] = useState({ screen: 'objects' });
  const [cpOpen, setCpOpen] = useState(false);
  const [pending, setPending] = useState(null);
  const [editor, setEditor] = useState({ open: false });
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('studio-theme') || 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('studio-theme', theme);
    if (window.applyTheme) window.applyTheme(theme, 'Cool gray', 'Slate');
  }, [theme]);

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setCpOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const ask = (text) => {
    setCpOpen(true);
    setPending(text);
  };
  const go = (id) => setRoute({ screen: id });
  const cpScreen = SCREEN_OF[route.screen] || 'objects';

  const openField = (f) => setEditor({ open: true, intent: 'edit', seed: f });
  const newField = (intent, seed) =>
    setEditor({
      open: true,
      intent: typeof intent === 'string' ? intent : 'new',
      seed: seed || null,
    });

  return (
    <div className="st-app">
      <aside className="st-side sb">
        <div className="sb__brand">
          <span className="sb__logo">N</span>
          <div>
            <div className="sb__brand-name">Northbeam</div>
            <div className="sb__brand-sub">Studio · Admin</div>
          </div>
        </div>
        <button className="sb__search" onClick={() => setPalette(true)}>
          <i className="ph ph-magnifying-glass" />
          Search & commands<span className="kbd">⌘K</span>
        </button>
        <nav className="sb__nav">
          {NAV.map((n, i) =>
            n.sec ? (
              <div className="sb__group-label" key={'s' + i}>
                {n.sec}
              </div>
            ) : (
              <button
                key={n.id}
                className="sb__item"
                data-active={
                  route.screen === n.id || (route.screen === 'object' && n.id === 'objects')
                    ? 'true'
                    : undefined
                }
                onClick={() => go(n.id)}
              >
                <i className={`ph ph-${n.icon}`} />
                {n.label}
                {n.id === 'migration' && (
                  <span className="sb__badge">
                    <span className="badge badge--warning" style={{ height: 18 }}>
                      2
                    </span>
                  </span>
                )}
              </button>
            ),
          )}
        </nav>
        <div style={{ padding: '0 10px 8px' }}>
          <button
            className="sb__item"
            onClick={() => {
              setCpOpen(true);
            }}
          >
            <i className="ph ph-sparkle" style={{ color: 'var(--ai)' }} />
            Copilot
            <span className="kbd" style={{ marginLeft: 'auto' }}>
              ⌘J
            </span>
          </button>
        </div>
        <div className="sb__footer">
          <Avatar name="Jordan Mills" className="sb__avatar" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, lineHeight: 1.2 }}>
              Jordan Mills
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
              Admin · Acme Corp
            </div>
          </div>
          <i className="ph ph-dots-three" />
        </div>
      </aside>

      <div className="st-main">
        <header className="st-top">
          <div className="st-crumb">
            <a onClick={() => go('objects')}>Studio</a>
            <span className="sep">/</span>
            {route.screen === 'object' ? (
              <React.Fragment>
                <a onClick={() => go('objects')}>Objects</a>
                <span className="sep">/</span>
                <b>{route.obj.name}</b>
              </React.Fragment>
            ) : (
              <b>{CRUMB[route.screen]}</b>
            )}
          </div>
          <div className="st-top__spacer" />
          <div className="st-search" onClick={() => setPalette(true)}>
            <i className="ph ph-magnifying-glass" />
            Search…<span className="kbd">⌘K</span>
          </div>
          <button className={`chip-ai ${cpOpen ? '' : ''}`} onClick={() => setCpOpen((o) => !o)}>
            <i className="ph ph-sparkle" />
            Copilot
          </button>
          <div className="theme-toggle" role="group" aria-label="Theme">
            <button
              data-active={theme === 'light' ? 'true' : undefined}
              onClick={() => setTheme('light')}
              aria-label="Light"
            >
              <i className="ph ph-sun" />
            </button>
            <button
              data-active={theme === 'dark' ? 'true' : undefined}
              onClick={() => setTheme('dark')}
              aria-label="Dark"
            >
              <i className="ph ph-moon" />
            </button>
          </div>
        </header>

        <div className="st-content ds-scroll">
          {route.screen === 'objects' && (
            <ObjectManager onOpen={(o) => setRoute({ screen: 'object', obj: o })} onAsk={ask} />
          )}
          {route.screen === 'object' && (
            <ObjectDetail
              obj={route.obj}
              onOpenField={openField}
              onNewField={newField}
              onAsk={ask}
            />
          )}
          {route.screen === 'schema' && (
            <SchemaBuilder onOpen={(o) => setRoute({ screen: 'object', obj: o })} onAsk={ask} />
          )}
          {route.screen === 'layouts' && <LayoutBuilder onAsk={ask} />}
          {route.screen === 'reports' && <ReportsAI onAsk={ask} />}
          {route.screen === 'migration' && (
            <MigrationReview onOpen={(o) => setRoute({ screen: 'object', obj: o })} onAsk={ask} />
          )}
        </div>
      </div>

      <Copilot
        open={cpOpen}
        screen={cpScreen}
        pending={pending}
        onConsumed={() => setPending(null)}
        onClose={() => setCpOpen(false)}
      />

      <FieldEditor
        open={editor.open}
        intent={editor.intent}
        seed={editor.seed}
        onClose={() => setEditor({ open: false })}
      />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<StudioApp />);
