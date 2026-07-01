/* lib-command.jsx — Command palette (⌘K) */

const CMD_ITEMS = [
  {
    id: 'a1',
    group: 'Quick actions',
    icon: 'user-plus',
    label: 'Create contact',
    sub: 'Add a new person',
    kbd: 'C then P',
  },
  {
    id: 'a2',
    group: 'Quick actions',
    icon: 'currency-circle-dollar',
    label: 'Create deal',
    sub: 'Open a new opportunity',
    kbd: 'C then D',
  },
  {
    id: 'a3',
    group: 'Quick actions',
    icon: 'arrows-clockwise',
    label: 'Run Salesforce migration',
    sub: 'Sync historical records',
  },
  { id: 'a4', group: 'Quick actions', icon: 'upload-simple', label: 'Import from CSV' },
  { id: 'a5', group: 'Quick actions', icon: 'note-pencil', label: 'Log an activity' },
  { id: 'n1', group: 'Go to', icon: 'users-three', label: 'Contacts' },
  { id: 'n2', group: 'Go to', icon: 'buildings', label: 'Accounts' },
  { id: 'n3', group: 'Go to', icon: 'currency-circle-dollar', label: 'Deals' },
  { id: 'n4', group: 'Go to', icon: 'chart-line-up', label: 'Reports' },
  { id: 'n5', group: 'Go to', icon: 'gear-six', label: 'Settings' },
  {
    id: 'r1',
    group: 'Records',
    avatar: true,
    label: 'Marcus Chen',
    sub: 'VP Sales · Vertex Industries',
    meta: 'Contact',
  },
  {
    id: 'r2',
    group: 'Records',
    avatar: true,
    label: 'Priya Anand',
    sub: 'CTO · Lumen Labs',
    meta: 'Contact',
  },
  {
    id: 'r3',
    group: 'Records',
    icon: 'buildings',
    label: 'Vertex Industries',
    sub: 'Enterprise · $2.4M ARR',
    meta: 'Account',
  },
  {
    id: 'r4',
    group: 'Records',
    icon: 'buildings',
    label: 'Lumen Labs',
    sub: 'Mid-market · $480K ARR',
    meta: 'Account',
  },
];
const GROUP_ORDER = ['Quick actions', 'Go to', 'Records'];

function CommandPalette({ open, onClose, contained }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return CMD_ITEMS;
    return CMD_ITEMS.filter((it) => (it.label + ' ' + (it.sub || '')).toLowerCase().includes(s));
  }, [q]);

  const grouped = useMemo(() => {
    const m = {};
    filtered.forEach((it) => {
      (m[it.group] = m[it.group] || []).push(it);
    });
    const flat = [];
    const blocks = GROUP_ORDER.filter((g) => m[g]).map((g) => ({ group: g, items: m[g] }));
    blocks.forEach((b) => b.items.forEach((it) => flat.push(it)));
    return { blocks, flat };
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, grouped.flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onClose?.();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, grouped.flat.length, onClose]);

  const ref = useDismiss(open, () => onClose?.());
  if (!open) return null;
  let running = -1;
  return (
    <div
      className="cmdk-overlay"
      style={contained ? { position: 'absolute' } : { position: 'fixed' }}
    >
      <div className="cmdk" ref={ref}>
        <div className="cmdk__input">
          <i className="ph ph-magnifying-glass" />
          <input
            autoFocus
            value={q}
            placeholder="Search or jump to…"
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="cmdk__scroll">
          {grouped.flat.length === 0 ? (
            <div className="cmdk__empty">
              <i className="ph ph-magnifying-glass" />
              No results for “{q}”
            </div>
          ) : (
            grouped.blocks.map((b) => (
              <div key={b.group}>
                <div className="cmdk__group-label">{b.group}</div>
                {b.items.map((it) => {
                  running++;
                  const here = running;
                  return (
                    <div
                      key={it.id}
                      className="cmdk__item"
                      data-active={idx === here ? 'true' : undefined}
                      onMouseEnter={() => setIdx(here)}
                      onClick={() => onClose?.()}
                    >
                      {it.avatar ? (
                        <Avatar name={it.label} className="cmdk__avatar" />
                      ) : (
                        <span className="cmdk__icon">
                          <i className={`ph ph-${it.icon}`} />
                        </span>
                      )}
                      <div className="cmdk__item-body">
                        {it.label}
                        {it.sub && <small>{it.sub}</small>}
                      </div>
                      <div className="cmdk__item-meta">
                        {it.meta && <span className="badge">{it.meta}</span>}
                        {it.kbd && <span style={{ fontSize: 'var(--text-sm)' }}>{it.kbd}</span>}
                        {idx === here && <i className="ph ph-arrow-elbow-down-left" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="cmdk__footer">
          <span className="cmdk__footer-hint">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> navigate
          </span>
          <span className="cmdk__footer-hint">
            <span className="kbd">↵</span> select
          </span>
          <span className="cmdk__footer-hint">
            <span className="kbd">esc</span> close
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="ph ph-command" />
            Command palette
          </span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CommandPalette, CMD_ITEMS });
