/* studio-migration.jsx — one-click migration mapping review */

function confColor(c) {
  return c >= 90 ? 'var(--success)' : c >= 75 ? 'var(--warning)' : 'var(--danger)';
}
function StatusBadge({ s }) {
  const m = {
    mapped: ['success', 'check-circle', 'Mapped'],
    merged: ['brand', 'arrows-merge', 'Merged'],
    review: ['warning', 'warning', 'Needs review'],
    skip: ['', 'minus-circle', 'Skipped'],
  }[s];
  return (
    <span className={`badge ${m[0] ? 'badge--' + m[0] : ''}`}>
      <i className={`ph ph-${m[1]}`} />
      {m[2]}
    </span>
  );
}

function MigrationReview({ onOpen, onAsk }) {
  const M = window.STUDIO.MIGRATION;
  const byId = Object.fromEntries(window.STUDIO.OBJECTS.map((o) => [o.id, o]));
  const [tab, setTab] = useState('objects');

  return (
    <div className="st-wrap">
      <div className="st-page-head" style={{ marginBottom: 16 }}>
        <div className="st-page-head__icon" style={{ background: 'var(--ai-grad)' }}>
          <i className="ph ph-arrows-clockwise" />
        </div>
        <div>
          <h1>Salesforce migration</h1>
          <p>
            One-click import mapped your org into Northbeam. Review what the AI auto-mapper proposed
            before you finalize.
          </p>
        </div>
        <div className="st-page-head__actions">
          <Button
            variant="secondary"
            icon="arrow-clockwise"
            onClick={() => onAsk('Re-run mapping with higher confidence')}
          >
            Re-run
          </Button>
          <Button variant="primary" icon="check">
            Finalize import
          </Button>
        </div>
      </div>

      <div className="mig-banner">
        <span className="mig-banner__ic">
          <i className="ph ph-sparkle" />
        </span>
        <div style={{ flex: 1 }}>
          <h2>Auto-mapper finished with {M.summary.confidence}% average confidence</h2>
          <p>
            8 objects mapped directly · 1 merged (Task + Event → Activity) · 1 needs your review · 1
            skipped. 2 fields need a decision.
          </p>
        </div>
        <button
          className="chip-ai"
          onClick={() => onAsk("What didn't map cleanly from Salesforce?")}
        >
          <i className="ph ph-sparkle" />
          Explain mapping
        </button>
      </div>

      <div className="mig-stats">
        {[
          ['Objects', M.summary.objects, ''],
          ['Fields', M.summary.fields, ''],
          ['Records', M.summary.records, ''],
          ['Avg confidence', M.summary.confidence + '%', 'ai'],
        ].map(([l, v, m]) => (
          <div className={`mig-stat ${m ? 'mig-stat--' + m : ''}`} key={l}>
            <b>{v}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button
          className="tab"
          data-active={tab === 'objects' ? 'true' : undefined}
          onClick={() => setTab('objects')}
        >
          <i className="ph ph-stack" />
          Objects
        </button>
        <button
          className="tab"
          data-active={tab === 'fields' ? 'true' : undefined}
          onClick={() => setTab('fields')}
        >
          <i className="ph ph-list-checks" />
          Fields · Opportunity → Deal
        </button>
      </div>

      <div className="tbl-card">
        <div className="map-head">
          <span>From Salesforce</span>
          <span></span>
          <span>To Northbeam</span>
          <span>Confidence</span>
          <span style={{ textAlign: 'right' }}>Status</span>
        </div>
        {tab === 'objects'
          ? M.objects.map((r, i) => {
              const t = r.to ? byId[r.to] : null;
              return (
                <div className="map-row" key={i}>
                  <div className="map-side">
                    <span className="map-sf-ic">
                      <i className="ph ph-cloud" />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <b>{r.sf}</b>
                      <small>{r.fields} fields</small>
                    </div>
                  </div>
                  <div className="map-arrow">
                    <i className="ph ph-arrow-right" />
                  </div>
                  <div className="map-side">
                    {t ? (
                      <React.Fragment>
                        <span
                          className="tbl__oicon"
                          style={{ background: t.color, width: 28, height: 28 }}
                        >
                          <i className={`ph ph-${t.icon}`} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <b>{t.name}</b>
                          <small>{t.api}</small>
                        </div>
                      </React.Fragment>
                    ) : (
                      <span style={{ color: 'var(--ink-subtle)' }}>
                        <i className="ph ph-prohibit" style={{ marginRight: 6 }} />
                        No target
                      </span>
                    )}
                  </div>
                  <div className="map-conf">
                    {r.conf > 0 ? (
                      <React.Fragment>
                        <div className="map-bar">
                          <span style={{ width: r.conf + '%', background: confColor(r.conf) }} />
                        </div>
                        <b>{r.conf}</b>
                      </React.Fragment>
                    ) : (
                      <span style={{ color: 'var(--ink-subtle)', fontSize: 'var(--text-sm)' }}>
                        —
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    {r.status === 'review' ? (
                      <Button size="sm" variant="primary">
                        Review
                      </Button>
                    ) : (
                      <StatusBadge s={r.status} />
                    )}
                  </div>
                  <div className="map-note">{r.note}</div>
                </div>
              );
            })
          : M.fields.map((r, i) => (
              <div className="map-row" key={i}>
                <div className="map-side">
                  <span className="map-sf-ic">
                    <i className="ph ph-cloud" />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <b
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-sm)',
                        fontWeight: 600,
                      }}
                    >
                      {r.sf}
                    </b>
                  </div>
                </div>
                <div className="map-arrow">
                  <i className="ph ph-arrow-right" />
                </div>
                <div className="map-side">
                  <b>{r.to}</b>
                </div>
                <div className="map-conf">
                  <div className="map-bar">
                    <span style={{ width: r.conf + '%', background: confColor(r.conf) }} />
                  </div>
                  <b>{r.conf}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {r.status === 'review' ? (
                    <Button size="sm" variant="secondary">
                      Decide
                    </Button>
                  ) : (
                    <StatusBadge s={r.status} />
                  )}
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}

Object.assign(window, { MigrationReview });
