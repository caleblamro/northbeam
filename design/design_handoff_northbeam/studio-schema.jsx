/* studio-schema.jsx — visual data-model canvas */

function SchemaBuilder({ onOpen, onAsk }) {
  const O = window.STUDIO.OBJECTS,
    REL = window.STUDIO.REL;
  const byId = Object.fromEntries(O.map((o) => [o.id, o]));
  const [pos, setPos] = useState(() => JSON.parse(JSON.stringify(window.STUDIO.SCHEMA_POS)));
  const [hot, setHot] = useState(null);
  const drag = useRef(null);
  const NW = 184;

  const rowsFor = (id) => {
    const rels = REL.filter((r) => r.from === id);
    const rows = [{ ic: 'text-t', label: 'Name', key: false }];
    rels
      .slice(0, 3)
      .forEach((r) =>
        rows.push({
          ic: r.kind === 'masterdetail' ? 'tree-structure' : 'arrow-bend-up-right',
          label: byId[r.to] ? byId[r.to].name : r.to,
          key: true,
        }),
      );
    return rows;
  };
  const nodeH = (id) => 42 + rowsFor(id).length * 26 + 22;

  const onDown = (e, id) => {
    const p = pos[id];
    drag.current = { id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y };
    const move = (ev) => {
      if (!drag.current) return;
      setPos((cur) => ({
        ...cur,
        [drag.current.id]: {
          x: drag.current.ox + (ev.clientX - drag.current.sx),
          y: drag.current.oy + (ev.clientY - drag.current.sy),
        },
      }));
    };
    const up = () => {
      drag.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const edgePath = (a, b, ai, bi) => {
    const ca = { x: pos[a].x + NW / 2, y: pos[a].y + nodeH(a) / 2 };
    const cb = { x: pos[b].x + NW / 2, y: pos[b].y + nodeH(b) / 2 };
    const mx = (ca.x + cb.x) / 2;
    return {
      d: `M ${ca.x} ${ca.y} C ${mx} ${ca.y}, ${mx} ${cb.y}, ${cb.x} ${cb.y}`,
      mid: { x: mx, y: (ca.y + cb.y) / 2 },
    };
  };

  return (
    <div className="sc-stage ds-scroll">
      <div className="sc-toolbar">
        <span
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            padding: '0 6px',
            color: 'var(--ink-secondary)',
          }}
        >
          {O.length} objects · {REL.length} relationships
        </span>
        <span
          style={{ width: 1, alignSelf: 'stretch', background: 'var(--divider)', margin: '2px 0' }}
        />
        <Button size="sm" variant="ghost" icon="arrows-out">
          Auto-arrange
        </Button>
        <button className="chip-ai" onClick={() => onAsk('Find objects with no relationships')}>
          <i className="ph ph-sparkle" />
          Ask about schema
        </button>
      </div>

      <div className="sc-canvas">
        <svg className="sc-edges">
          <defs>
            <marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
              <path
                d="M0,0 L7,3 L0,6"
                fill="none"
                stroke="var(--border-strong)"
                strokeWidth="1.4"
              />
            </marker>
            <marker id="arrowHot" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6" fill="none" stroke="var(--brand)" strokeWidth="1.6" />
            </marker>
          </defs>
          {REL.map((r, i) => {
            if (!pos[r.from] || !pos[r.to]) return null;
            const isHot = hot === r.from || hot === r.to;
            const p = edgePath(r.from, r.to);
            return (
              <g key={i}>
                <path
                  d={p.d}
                  className={isHot ? 'hot' : ''}
                  markerEnd={`url(#${isHot ? 'arrowHot' : 'arrow'})`}
                />
                {isHot && (
                  <text className="sc-edge-label" x={p.mid.x} y={p.mid.y - 4} textAnchor="middle">
                    {r.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {O.map((o) => (
          <div
            key={o.id}
            className="sc-node"
            data-active={hot === o.id ? 'true' : undefined}
            style={{ left: pos[o.id].x, top: pos[o.id].y }}
            onMouseEnter={() => setHot(o.id)}
            onMouseLeave={() => setHot(null)}
          >
            <div
              className="sc-node__h"
              style={{ cursor: 'grab' }}
              onMouseDown={(e) => onDown(e, o.id)}
              onDoubleClick={() => onOpen(o)}
            >
              <span className="sc-node__ic" style={{ background: o.color }}>
                <i className={`ph ph-${o.icon}`} />
              </span>
              <b>{o.name}</b>
              <Prov source={o.source} mini />
            </div>
            <div className="sc-node__rows">
              {rowsFor(o.id).map((row, i) => (
                <div className="sc-node__row" key={i}>
                  <i className={`ph ph-${row.ic}`} />
                  {row.label}
                  {row.key && <i className="ph ph-link key" style={{ color: 'var(--brand)' }} />}
                </div>
              ))}
              <div
                className="sc-node__more"
                onClick={() => onOpen(o)}
                style={{ cursor: 'pointer' }}
              >
                +{o.fields - rowsFor(o.id).length} more fields
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { SchemaBuilder });
