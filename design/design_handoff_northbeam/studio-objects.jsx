/* studio-objects.jsx — Object Manager, Object Detail, Field Editor drawer */

function Prov({ source, mini }) {
  if (source === 'salesforce')
    return (
      <span className="pv pv--sf">
        <i className="ph ph-cloud" />
        {mini ? 'SF' : 'Salesforce'}
      </span>
    );
  if (source === 'ai')
    return (
      <span className="pv pv--ai">
        <i className="ph ph-sparkle" />
        AI
      </span>
    );
  return (
    <span className="pv pv--native">
      <i className="ph ph-cube" />
      Native
    </span>
  );
}
function typeMeta(id) {
  return window.STUDIO.FIELD_TYPES.find((t) => t.id === id) || { label: id, icon: 'circle' };
}

/* ---------------- OBJECT MANAGER ---------------- */
function ObjectManager({ onOpen, onAsk }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('table');
  const objs = window.STUDIO.OBJECTS.filter(
    (o) =>
      (filter === 'all' || o.source === filter) &&
      (o.name.toLowerCase().includes(q.toLowerCase()) ||
        o.api.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="st-wrap">
      <div className="st-page-head">
        <div className="st-page-head__icon" style={{ background: 'var(--brand)' }}>
          <i className="ph ph-stack" />
        </div>
        <div>
          <h1>Objects</h1>
          <p>
            Every object in your workspace — standard, custom, and AI-derived.{' '}
            {window.STUDIO.OBJECTS.length} objects,{' '}
            {window.STUDIO.OBJECTS.reduce((a, o) => a + o.fields, 0)} fields.
          </p>
        </div>
        <div className="st-page-head__actions">
          <button
            className="chip-ai"
            onClick={() => onAsk('Suggest a new object from my Activity data')}
          >
            <i className="ph ph-sparkle" />
            Suggest objects
          </button>
          <SplitButton
            variant="primary"
            icon="plus"
            items={[
              {
                icon: 'sparkle',
                label: 'Describe to build…',
                onSelect: () => onAsk('Create a new object: '),
              },
              { icon: 'upload-simple', label: 'Import from CSV' },
              { icon: 'cloud', label: 'Pull more from Salesforce' },
            ]}
          >
            New object
          </SplitButton>
        </div>
      </div>

      <div className="st-toolbar">
        <div className="input-wrap" style={{ width: 280 }}>
          <span className="input-wrap__icon">
            <i className="ph ph-magnifying-glass" />
          </span>
          <input placeholder="Search objects…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="tabs">
          {[
            ['all', 'All'],
            ['salesforce', 'Salesforce'],
            ['native', 'Native'],
            ['ai', 'AI'],
          ].map(([id, label]) => (
            <button
              key={id}
              className="tab"
              data-active={filter === id ? 'true' : undefined}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="st-toolbar__spacer" />
        <div className="viewtog">
          <button
            data-active={view === 'table' ? 'true' : undefined}
            onClick={() => setView('table')}
            aria-label="Table view"
          >
            <i className="ph ph-rows" />
          </button>
          <button
            data-active={view === 'grid' ? 'true' : undefined}
            onClick={() => setView('grid')}
            aria-label="Grid view"
          >
            <i className="ph ph-squares-four" />
          </button>
        </div>
      </div>

      {view === 'table' ? (
        <div className="tbl-card">
          <table className="tbl">
            <thead>
              <tr>
                <th>Object</th>
                <th>Records</th>
                <th>Fields</th>
                <th>Source</th>
                <th>Health</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {objs.map((o) => (
                <tr key={o.id} onClick={() => onOpen(o)}>
                  <td>
                    <div className="tbl__name">
                      <span className="tbl__oicon" style={{ background: o.color }}>
                        <i className={`ph ph-${o.icon}`} />
                      </span>
                      <div>
                        <b>{o.plural}</b>
                        <div className="tbl__sub">{o.api}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{o.records.toLocaleString()}</td>
                  <td className="num">{o.fields}</td>
                  <td>
                    <Prov source={o.source} />
                  </td>
                  <td>
                    <span className={`hdot hdot--${o.health}`} />{' '}
                    <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}>
                      {o.health === 'good' ? 'Healthy' : 'Review'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}>
                    {o.updated}
                  </td>
                  <td className="shrink" onClick={(e) => e.stopPropagation()}>
                    <MenuButton
                      iconBtn="dots-three"
                      align="right"
                      items={[
                        { icon: 'pencil-simple', label: 'Edit object' },
                        { icon: 'eye', label: 'View records' },
                        { icon: 'copy', label: 'Duplicate' },
                        { separator: true },
                        { icon: 'trash', label: 'Delete', danger: true },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="obj-grid">
          {objs.map((o) => (
            <div className="obj-card" key={o.id} onClick={() => onOpen(o)}>
              <div className="obj-card__top">
                <span className="obj-card__icon" style={{ background: o.color }}>
                  <i className={`ph ph-${o.icon}`} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3>{o.plural}</h3>
                  <div className="obj-card__api">{o.api}</div>
                </div>
                <Prov source={o.source} mini />
              </div>
              <p>{o.desc}</p>
              <div className="obj-card__meta">
                <span>
                  <b>{o.records.toLocaleString()}</b> records
                </span>
                <span>
                  <b>{o.fields}</b> fields
                </span>
                <span style={{ marginLeft: 'auto' }}>
                  <span className={`hdot hdot--${o.health}`} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- OBJECT DETAIL ---------------- */
function ObjectDetail({ obj, onOpenField, onNewField, onAsk }) {
  const [tab, setTab] = useState('fields');
  const [desc, setDesc] = useState('');
  const fields = window.STUDIO.DEAL_FIELDS;
  return (
    <div className="st-wrap">
      <div className="st-page-head">
        <div className="st-page-head__icon" style={{ background: obj.color }}>
          <i className={`ph ph-${obj.icon}`} />
        </div>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {obj.name} <Prov source={obj.source} />
          </h1>
          <p>
            {obj.desc} ·{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
              {obj.api}
            </span>
          </p>
        </div>
        <div className="st-page-head__actions">
          <button
            className="chip-ai"
            onClick={() => onAsk('Which Deal fields are never filled in?')}
          >
            <i className="ph ph-sparkle" />
            Analyze fields
          </button>
          <SplitButton
            variant="primary"
            icon="plus"
            onClick={onNewField}
            items={[
              {
                icon: 'sparkle',
                label: 'Describe to build…',
                onSelect: () => onNewField('describe'),
              },
              {
                icon: 'function',
                label: 'New formula field',
                onSelect: () => onNewField('formula'),
              },
            ]}
          >
            New field
          </SplitButton>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 20 }}>
        {[
          ['fields', 'list-checks', `Fields · ${fields.length}`],
          ['relationships', 'tree-structure', 'Relationships'],
          ['layouts', 'layout', 'Layouts'],
          ['automation', 'lightning', 'Automation'],
        ].map(([id, ic, label]) => (
          <button
            key={id}
            className="tab"
            data-active={tab === id ? 'true' : undefined}
            onClick={() => setTab(id)}
          >
            <i className={`ph ph-${ic}`} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'fields' && (
        <React.Fragment>
          <div className="ai-panel" style={{ marginBottom: 18 }}>
            <div className="ai-panel__head">
              <i className="ph ph-sparkle" />
              <h3>Suggested from your data</h3>
              <span className="pv pv--ai">3 ideas</span>
            </div>
            {window.STUDIO.SUGGESTED_FIELDS.map((s) => (
              <div className="ai-sugg" key={s.label}>
                <span className="ai-sugg__ic">
                  <i className={`ph ph-${typeMeta(s.type).icon}`} />
                </span>
                <div className="ai-sugg__body">
                  <b>{s.label}</b>{' '}
                  <span style={{ color: 'var(--ink-subtle)', fontSize: 'var(--text-sm)' }}>
                    · {typeMeta(s.type).label}
                  </span>
                  <p>{s.reason}</p>
                </div>
                <div className="ai-sugg__act">
                  <Button size="sm" variant="secondary" onClick={() => onNewField('suggest', s)}>
                    Add
                  </Button>
                  <IconButton icon="x" size="sm" label="Dismiss" />
                </div>
              </div>
            ))}
          </div>

          <div className="input-wrap" style={{ marginBottom: 16, borderColor: 'var(--ai-border)' }}>
            <span className="input-wrap__icon">
              <i className="ph ph-sparkle ai-spark" />
            </span>
            <input
              placeholder="Describe a field to add — e.g. “contract end date” or “upsell ARR in dollars”"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && desc.trim()) {
                  onNewField('describe', { label: desc });
                  setDesc('');
                }
              }}
            />
            {desc.trim() && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onNewField('describe', { label: desc });
                  setDesc('');
                }}
              >
                Build
              </Button>
            )}
          </div>

          <div className="tbl-card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Field label</th>
                  <th>API name</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id} onClick={() => onOpenField(f)}>
                    <td>
                      <b style={{ color: 'var(--ink)' }}>{f.label}</b>
                    </td>
                    <td className="tbl__sub">{f.api}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 7,
                          color: f.type === 'ai' ? 'var(--ai)' : 'var(--ink-secondary)',
                        }}
                      >
                        <i className={`ph ph-${typeMeta(f.type).icon}`} />
                        {typeMeta(f.type).label}
                      </span>
                    </td>
                    <td>
                      {f.required ? (
                        <span style={{ color: 'var(--ink-secondary)' }}>Required</span>
                      ) : (
                        <span style={{ color: 'var(--ink-subtle)' }}>Optional</span>
                      )}
                    </td>
                    <td>
                      <Prov source={f.source} />
                    </td>
                    <td className="shrink" onClick={(e) => e.stopPropagation()}>
                      <MenuButton
                        iconBtn="dots-three"
                        align="right"
                        items={[
                          { icon: 'pencil-simple', label: 'Edit field' },
                          { icon: 'copy', label: 'Duplicate' },
                          { icon: 'eye-slash', label: 'Hide from layouts' },
                          { separator: true },
                          { icon: 'trash', label: 'Delete', danger: true },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </React.Fragment>
      )}

      {tab !== 'fields' && (
        <div
          className="tbl-card"
          style={{ padding: 48, textAlign: 'center', color: 'var(--ink-muted)' }}
        >
          <i
            className={`ph ph-${tab === 'relationships' ? 'tree-structure' : tab === 'layouts' ? 'layout' : 'lightning'}`}
            style={{ fontSize: 34, color: 'var(--ink-subtle)' }}
          />
          <p style={{ marginTop: 10 }}>
            The <b style={{ color: 'var(--ink)' }}>{tab}</b> tab for {obj.name} lives here — open
            the {tab === 'layouts' ? 'Layout builder' : 'relevant builder'} from the sidebar to
            explore it in this prototype.
          </p>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { Prov, typeMeta, ObjectManager, ObjectDetail });
