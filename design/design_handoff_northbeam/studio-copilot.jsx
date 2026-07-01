/* studio-copilot.jsx — right-side AI Copilot drawer */

const CP_SEED = {
  objects: [
    'Which objects have the most unused fields?',
    'Suggest a new object from my Activity data',
    'What changed in my schema this week?',
  ],
  detail: [
    'Add a renewal date and a health score to Deal',
    'Write a validation rule: Amount required when Stage is Negotiation',
    'Which Deal fields are never filled in?',
  ],
  schema: [
    'Find objects with no relationships',
    'How should Renewal connect to Account?',
    'Visualize the path from Contact to revenue',
  ],
  reports: [
    'Show me deals slipping this quarter',
    'Why did win rate change vs last quarter?',
    'Forecast Q3 by rep',
  ],
  migration: [
    "What didn't map cleanly from Salesforce?",
    'Why merge Task and Event into Activity?',
    'Re-run mapping with higher confidence',
  ],
  layouts: [
    'Group these fields into sensible sections',
    'What fields do reps actually use on Deal?',
    'Hide system fields from this layout',
  ],
};

function cpReply(text) {
  const t = text.toLowerCase();
  if (t.includes('renewal') || t.includes('health') || t.includes('add')) {
    return {
      text: "Here's what I'd add to **Deal** — review and apply:",
      card: {
        h: 'Proposed fields',
        items: [
          ['calendar-blank', 'Renewal Date', 'Date'],
          ['sparkle', 'Health Score', 'AI field · 0–100'],
        ],
      },
      actions: ['Apply both', 'Edit first'],
    };
  }
  if (t.includes('validation') || t.includes('rule') || t.includes('formula')) {
    return {
      text: 'Generated rule from your description:',
      card: {
        h: 'Validation rule',
        code: 'ISBLANK(Amount) && ISPICKVAL(Stage, "Negotiation")',
        sub: 'Blocks save with: “Amount is required once a deal reaches Negotiation.”',
      },
      actions: ['Add rule', 'Tweak'],
    };
  }
  if (t.includes('slip') || t.includes('forecast') || t.includes('deal')) {
    return {
      text: '**8 deals** ($1.2M) pushed their close date this week. The biggest movers are Vertex ($320K) and Lumen ($210K), both stuck in Negotiation 18+ days. Want me to build a *Slipping deals* report and pin it to your dashboard?',
      actions: ['Build report', 'Notify owners'],
    };
  }
  if (t.includes('map') || t.includes('salesforce')) {
    return {
      text: 'Everything mapped except **Campaign** (no native target — I routed it to Journeys) and **Contract**, which I matched to *Renewal* at 72% confidence. Two Opportunity fields need your eyes.',
      actions: ['Review 2 items', 'Accept all'],
    };
  }
  if (t.includes('unused') || t.includes('never') || t.includes('changed')) {
    return {
      text: 'On **Deal**, 6 fields are filled <5% of the time — *Next Step*, *Forecast Category*, and 4 legacy Salesforce fields. I can archive them so they stop cluttering layouts.',
      actions: ['Show all 6', 'Archive unused'],
    };
  }
  return {
    text: "Got it — I can build that. I'll use your live schema and the records migrated from Salesforce. Want me to draft it first so you can review before anything changes?",
    actions: ['Draft it', 'Just do it'],
  };
}

function Copilot({ open, screen, pending, onConsumed, onClose }) {
  const [msgs, setMsgs] = useState([
    {
      who: 'ai',
      text: "Hi — I'm your Studio Copilot. I can build objects and fields, write formulas and validation rules, explain your migration, and answer questions about your data in plain English.",
    },
  ]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef(null);
  const prompts = CP_SEED[screen] || CP_SEED.objects;

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, typing, open]);

  const send = (text) => {
    const q = (text || draft).trim();
    if (!q) return;
    setMsgs((m) => [...m, { who: 'me', text: q }]);
    setDraft('');
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMsgs((m) => [...m, Object.assign({ who: 'ai' }, cpReply(q))]);
    }, 1100);
  };

  useEffect(() => {
    if (pending) {
      send(pending);
      onConsumed && onConsumed();
    } /* eslint-disable-next-line */
  }, [pending]);

  return (
    <aside className="st-copilot" data-open={open ? 'true' : undefined} aria-hidden={!open}>
      <div className="st-copilot__inner">
        <div className="cp-head">
          <span className="cp-logo">
            <i className="ph ph-sparkle" />
          </span>
          <div style={{ flex: 1 }}>
            <h3>Copilot</h3>
            <small>
              Context:{' '}
              {{
                objects: 'Object Manager',
                detail: 'Deal · fields',
                schema: 'Schema',
                reports: 'Reports',
                migration: 'Migration',
                layouts: 'Layout builder',
              }[screen] || 'Studio'}
            </small>
          </div>
          <IconButton icon="x" label="Close copilot" onClick={onClose} />
        </div>
        <div className="cp-body ds-scroll" ref={bodyRef}>
          {msgs.map((m, i) => (
            <div key={i} className={`cp-msg ${m.who === 'me' ? 'cp-msg--me' : ''}`}>
              {m.who === 'ai' ? (
                <span className="cp-msg__av cp-msg__av--ai">
                  <i className="ph ph-sparkle" />
                </span>
              ) : (
                <Avatar
                  name="Jordan Mills"
                  className="cp-msg__av"
                  style={{ background: 'var(--brand)' }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <div className="cp-bubble">
                  <CpText text={m.text} />
                </div>
                {m.card && <CpCard card={m.card} />}
                {m.actions && (
                  <div className="cp-actions">
                    {m.actions.map((a, j) => (
                      <Button key={a} size="sm" variant={j === 0 ? 'primary' : 'secondary'}>
                        {a}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {typing && (
            <div className="cp-msg">
              <span className="cp-msg__av cp-msg__av--ai">
                <i className="ph ph-sparkle" />
              </span>
              <div className="cp-bubble">
                <div className="cp-typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
          {msgs.length <= 1 && (
            <div className="cp-suggest">
              {prompts.map((p) => (
                <button key={p} className="cp-prompt" onClick={() => send(p)}>
                  <i className="ph ph-arrow-up-right" />
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="cp-foot">
          <div className="cp-input">
            <textarea
              rows={1}
              placeholder="Ask Copilot or describe what to build…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="cp-send" disabled={!draft.trim()} onClick={() => send()}>
              <i className="ph ph-arrow-up" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* tiny **bold** / *em* renderer */
function CpText({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <p>
      {parts.map((p, i) =>
        p.startsWith('**') ? (
          <b key={i}>{p.slice(2, -2)}</b>
        ) : p.startsWith('*') ? (
          <em key={i}>{p.slice(1, -1)}</em>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </p>
  );
}

function CpCard({ card }) {
  return (
    <div className="cp-card">
      <div className="cp-card__h">
        <i className="ph ph-sparkle ai-spark" />
        {card.h}
      </div>
      <div style={{ padding: card.code ? '12px' : '6px' }}>
        {card.items &&
          card.items.map(([ic, label, sub], i) => (
            <div className="menu__item" key={i} style={{ cursor: 'default' }}>
              <i className={`ph ph-${ic}`} />
              <span className="menu__two-line">
                {label}
                <small>{sub}</small>
              </span>
            </div>
          ))}
        {card.code && (
          <div>
            <code
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 12.5,
                background: 'var(--surface-sunken)',
                padding: '10px 12px',
                borderRadius: 8,
                color: 'var(--ink)',
              }}
            >
              {card.code}
            </code>
            <p
              style={{ margin: '8px 2px 0', fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}
            >
              {card.sub}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { Copilot });
