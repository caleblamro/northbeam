/* studio-layouts.jsx — drag fields onto a record layout */

const LB_SECTIONS = [
  { id: 'key', label: 'Key details', icon: 'star' },
  { id: 'engage', label: 'Engagement & AI', icon: 'sparkle' },
  { id: 'system', label: 'System', icon: 'gear-six' },
];

function LayoutBuilder({ onAsk }) {
  const F = window.STUDIO.DEAL_FIELDS;
  const fById = Object.fromEntries(F.map((f) => [f.id, f]));
  const [layout, setLayout] = useState({
    key: ['f1', 'f2', 'f3', 'f4', 'f5', 'f7'],
    engage: ['f14', 'f13'],
    system: [],
  });
  const [over, setOver] = useState(null);
  const dragId = useRef(null);

  const placed = new Set([].concat(...Object.values(layout)));
  const palette = F.filter((f) => !placed.has(f.id));

  const drop = (sec) => {
    const id = dragId.current;
    dragId.current = null;
    setOver(null);
    if (!id) return;
    setLayout((L) => {
      const next = {};
      for (const k in L) next[k] = L[k].filter((x) => x !== id);
      next[sec] = [...next[sec], id];
      return next;
    });
  };
  const remove = (id) =>
    setLayout((L) => {
      const n = {};
      for (const k in L) n[k] = L[k].filter((x) => x !== id);
      return n;
    });
  const autoArrange = () =>
    setLayout({
      key: ['f1', 'f5', 'f7', 'f2', 'f3', 'f4'],
      engage: ['f14', 'f8', 'f13', 'f15'],
      system: ['f10'].filter((x) => fById[x]),
    });

  return (
    <div className="st-wrap">
      <div className="st-page-head">
        <div className="st-page-head__icon" style={{ background: '#10b981' }}>
          <i className="ph ph-layout" />
        </div>
        <div>
          <h1>Record layout · Deal</h1>
          <p>
            Drag fields onto the record to design what reps see. Group related fields into sections.
          </p>
        </div>
        <div className="st-page-head__actions">
          <button className="chip-ai" onClick={autoArrange}>
            <i className="ph ph-sparkle" />
            Auto-arrange
          </button>
          <Button variant="primary" icon="check">
            Save layout
          </Button>
        </div>
      </div>

      <div className="lb">
        <div className="lb-palette">
          <div className="lb-palette__h">
            <i className="ph ph-stack" />
            Available fields{' '}
            <span style={{ marginLeft: 'auto', color: 'var(--ink-subtle)', fontWeight: 400 }}>
              {palette.length}
            </span>
          </div>
          <div className="lb-palette__list ds-scroll">
            {palette.length === 0 && <div className="lb-empty">All fields placed 🎉</div>}
            {palette.map((f) => (
              <div
                key={f.id}
                className="lb-chip"
                data-ai={f.type === 'ai' ? 'true' : undefined}
                draggable
                onDragStart={() => {
                  dragId.current = f.id;
                }}
              >
                <i className={`ph ph-${typeMeta(f.type).icon}`} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {f.label}
                </span>
                {f.source === 'salesforce' && (
                  <i className="ph ph-cloud" style={{ color: 'var(--sf)', fontSize: 13 }} />
                )}
                <i className="ph ph-dots-six-vertical" style={{ color: 'var(--ink-subtle)' }} />
              </div>
            ))}
          </div>
        </div>

        <div className="lb-canvas">
          <div className="lb-record-head">
            <span className="lb-record-head__ic" style={{ background: '#10b981' }}>
              <i className="ph ph-currency-circle-dollar" />
            </span>
            <div style={{ flex: 1 }}>
              <h3>Vertex Industries — Platform Expansion</h3>
              <small>Stage: Negotiation · $320,000 · closes Aug 30</small>
            </div>
            <span className="badge badge--warning">
              <span className="dot" />
              At risk
            </span>
          </div>
          <div className="lb-sections">
            {LB_SECTIONS.map((s) => (
              <div className="lb-section" key={s.id}>
                <div className="lb-section__h">
                  <i className={`ph ph-${s.icon}`} />
                  {s.label}{' '}
                  <span
                    style={{
                      marginLeft: 'auto',
                      color: 'var(--ink-subtle)',
                      fontWeight: 400,
                      fontSize: 'var(--text-xs)',
                    }}
                  >
                    {layout[s.id].length} fields
                  </span>
                </div>
                <div
                  className="lb-drop"
                  data-over={over === s.id ? 'true' : undefined}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(s.id);
                  }}
                  onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
                  onDrop={() => drop(s.id)}
                >
                  {layout[s.id].length === 0 && <div className="lb-empty">Drag fields here</div>}
                  {layout[s.id].map((id) => {
                    const f = fById[id];
                    if (!f) return null;
                    return (
                      <div
                        className="lb-placed"
                        key={id}
                        draggable
                        onDragStart={() => {
                          dragId.current = id;
                        }}
                      >
                        <div className="lb-placed__label">
                          <i
                            className={`ph ph-${typeMeta(f.type).icon}`}
                            style={{ color: f.type === 'ai' ? 'var(--ai)' : undefined }}
                          />
                          {f.label}
                          {f.required && <span style={{ color: 'var(--danger)' }}>*</span>}
                          <i className="ph ph-x lb-placed__x" onClick={() => remove(id)} />
                        </div>
                        <div className="lb-placed__val" />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LayoutBuilder });
