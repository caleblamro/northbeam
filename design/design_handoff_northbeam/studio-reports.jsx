/* studio-reports.jsx — reports & dashboards with AI */

const NLQ_EXAMPLES = [
  'Deals slipping this quarter',
  'Win rate by lead source',
  'Renewals at risk in 90 days',
  'Pipeline coverage by rep',
];

function ReportsAI({ onAsk }) {
  const I = window.STUDIO.INSIGHTS,
    FC = window.STUDIO.FORECAST,
    REP = window.STUDIO.REPORTS;
  const [q, setQ] = useState('');
  const max = Math.max(...FC.map((f) => Math.max(f.actual || 0, f.fc || 0)));

  return (
    <div className="st-wrap">
      <div className="st-page-head">
        <div className="st-page-head__icon" style={{ background: 'var(--ai-grad)' }}>
          <i className="ph ph-chart-line-up" />
        </div>
        <div>
          <h1>Reports &amp; insights</h1>
          <p>
            Ask a question in plain English, or let AI surface what needs your attention across the
            data migrated from Salesforce.
          </p>
        </div>
        <div className="st-page-head__actions">
          <Button variant="secondary" icon="plus">
            New report
          </Button>
        </div>
      </div>

      <div className="nlq">
        <i className="ph ph-sparkle" />
        <input
          placeholder="Ask anything — “show me deals slipping this quarter by owner”"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q.trim()) onAsk(q);
          }}
        />
        <Button variant="primary" icon="arrow-right" onClick={() => q.trim() && onAsk(q)}>
          Build it
        </Button>
      </div>
      <div className="nlq-chips">
        {NLQ_EXAMPLES.map((c) => (
          <button key={c} className="nlq-chip" onClick={() => setQ(c)}>
            {c}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 12px' }}>
        <i className="ph ph-sparkle ai-spark" />
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0 }}>
          Needs your attention
        </h2>
        <span className="pv pv--ai">Auto-detected</span>
      </div>
      <div className="grid grid--3" style={{ marginBottom: 24 }}>
        {I.map((it, i) => (
          <div className="insight" key={i}>
            <span className={`insight__ic insight__ic--${it.tone}`}>
              <i className={`ph ph-${it.icon}`} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h4>{it.title}</h4>
              <p>{it.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rep-grid" style={{ marginBottom: 24 }}>
        <div className="panel">
          <div className="panel__h">
            <i className="ph ph-chart-bar" />
            <h3>Bookings vs. AI forecast</h3>
            <span className="right pv pv--ai">
              <i className="ph ph-sparkle" />
              Predicted
            </span>
          </div>
          <div className="panel__body">
            <div className="fc">
              {FC.map((f) => (
                <div className="fc-col" key={f.m}>
                  <div
                    className="fc-bar"
                    style={{
                      height: ((f.actual || 0) / max) * 100 + '%',
                      display: f.actual ? 'block' : 'none',
                    }}
                  />
                  {!f.actual && (
                    <div
                      className="fc-bar fc-bar--fc"
                      style={{ height: (f.fc / max) * 100 + '%' }}
                    />
                  )}
                  <small>{f.m}</small>
                </div>
              ))}
            </div>
            <div className="fc-legend">
              <span>
                <i style={{ background: 'var(--brand)' }} />
                Actual
              </span>
              <span>
                <i style={{ background: 'var(--ai)' }} />
                AI forecast
              </span>
              <span style={{ marginLeft: 'auto', color: 'var(--ink-secondary)' }}>
                Q3 projected: <b style={{ color: 'var(--ink)' }}>$3.25M</b> (+19%)
              </span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel__h">
            <i className="ph ph-newspaper" />
            <h3>What changed this week</h3>
            <span
              className="right"
              style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}
            >
              narrative
            </span>
          </div>
          <div className="panel__body">
            <p className="narr">
              Pipeline grew to <b>$8.4M</b> across 47 deals. New inbound from <b>Vertex</b> and{' '}
              <b>Lumen</b> added <span className="up">+$530K</span>, but{' '}
              <span className="down">8 deals slipped</span> their close date — concentrated in
              Negotiation. Win rate held at <b>38%</b>, and <b>3 renewals</b> entered the at-risk
              window.
            </p>
            <div className="cp-actions" style={{ marginTop: 14 }}>
              <Button
                size="sm"
                variant="secondary"
                icon="push-pin"
                onClick={() => onAsk('Pin the weekly narrative to my dashboard')}
              >
                Pin to dashboard
              </Button>
              <Button size="sm" variant="ghost" icon="paper-plane-tilt">
                Email to team
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel__h">
          <i className="ph ph-folder" />
          <h3>Saved reports</h3>
          <Button size="sm" variant="ghost" className="right" iconRight="caret-right">
            View all
          </Button>
        </div>
        <div className="panel__body" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {REP.map((r) => (
            <div className="rep-list-item" key={r.name}>
              <span
                className="rep-list-item__ic"
                style={
                  r.by === 'AI' ? { background: 'var(--ai-soft)', color: 'var(--ai)' } : undefined
                }
              >
                <i className={`ph ph-${r.icon}`} />
              </span>
              <div style={{ flex: 1 }}>
                <div className="rep-name">{r.name}</div>
                <div className="rep-meta">
                  Updated {r.updated} · {r.by === 'AI' ? 'Generated by AI' : 'by ' + r.by}
                </div>
              </div>
              {r.by === 'AI' && <span className="pv pv--ai">AI</span>}
              <IconButton icon="dots-three" label="More" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ReportsAI });
