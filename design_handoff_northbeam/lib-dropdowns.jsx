/* lib-dropdowns.jsx — NativeSelect, Select (custom), Combobox (async) */

/* ---- styled native select ---- */
function NativeSelect({ value, onChange, options, size, disabled, ...rest }) {
  return (
    <div className={`select-wrap ${size && size !== 'md' ? 'select-wrap--' + size : ''}`}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="select-wrap__chevron">
        <i className="ph ph-caret-down" />
      </span>
    </div>
  );
}

/* ---- custom Select with rich options + check state ---- */
function Select({ value, onChange, options, placeholder = 'Select…', size, disabled, leadIcon }) {
  const [open, setOpen] = useState(false);
  const ctrlRef = useRef(null);
  const current = options.find((o) => o.value === value);
  return (
    <div className="combo">
      <button
        type="button"
        ref={ctrlRef}
        className="combo__control"
        data-open={open ? 'true' : undefined}
        disabled={disabled}
        style={
          size === 'sm'
            ? { height: 'var(--h-sm)' }
            : size === 'lg'
              ? { height: 'var(--h-lg)' }
              : undefined
        }
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {leadIcon && <i className={`ph ph-${leadIcon}`} style={{ color: 'var(--ink-subtle)' }} />}
        {current?.color && (
          <span style={{ width: 8, height: 8, borderRadius: 99, background: current.color }} />
        )}
        <span className={`combo__value ${current ? '' : 'combo__value--empty'}`}>
          {current ? current.label : placeholder}
        </span>
        <i className="ph ph-caret-down combo__chev" />
      </button>
      <Popover anchorRef={ctrlRef} open={open} onClose={() => setOpen(false)} matchWidth>
        <div className="menu__scroll">
          {options.map((o) => (
            <button
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className="menu__item"
              data-active={o.value === value ? 'true' : undefined}
              onClick={() => {
                onChange?.(o.value);
                setOpen(false);
              }}
            >
              {o.icon && <i className={`ph ph-${o.icon}`} />}
              {o.color && (
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 99,
                    background: o.color,
                    flexShrink: 0,
                  }}
                />
              )}
              <span className="menu__two-line">
                {o.label}
                {o.sublabel && <small>{o.sublabel}</small>}
              </span>
              {o.value === value && <i className="ph ph-check menu__item-check" />}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/* ---- Async Combobox: debounced search via loadOptions(query) => Promise<opt[]> ---- */
function Combobox({
  value,
  onChange,
  loadOptions,
  placeholder = 'Search…',
  emptyText = 'No matches',
  minChars = 0,
  renderOption,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState([]);
  const [loading, setLoading] = useState(false);
  const ctrlRef = useRef(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) return;
    if (q.length < minChars) {
      setOpts([]);
      return;
    }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      const r = await loadOptions(q);
      if (id === reqId.current) {
        setOpts(r);
        setLoading(false);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [q, open]);

  const selected = value;
  return (
    <div className="combo">
      <div
        className="combo__control"
        ref={ctrlRef}
        data-open={open ? 'true' : undefined}
        onClick={() => setOpen(true)}
      >
        <i className="ph ph-magnifying-glass" style={{ color: 'var(--ink-subtle)' }} />
        {open ? (
          <input
            autoFocus
            value={q}
            placeholder={placeholder}
            onChange={(e) => setQ(e.target.value)}
          />
        ) : (
          <span className={`combo__value ${selected ? '' : 'combo__value--empty'}`}>
            {selected ? selected.label : placeholder}
          </span>
        )}
        {selected && !open && (
          <button
            type="button"
            className="input-wrap__icon"
            style={{
              border: 0,
              background: 'none',
              cursor: 'pointer',
              padding: 0,
              color: 'var(--ink-subtle)',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onChange?.(null);
            }}
          >
            <i className="ph ph-x" />
          </button>
        )}
        <i className="ph ph-caret-down combo__chev" />
      </div>
      <Popover
        anchorRef={ctrlRef}
        open={open}
        onClose={() => {
          setOpen(false);
          setQ('');
        }}
        matchWidth
      >
        <div className="menu__scroll">
          {loading ? (
            <div className="menu__loading">
              <Spinner />
              Searching…
            </div>
          ) : q.length < minChars ? (
            <div className="menu__empty">Type at least {minChars} characters</div>
          ) : opts.length === 0 ? (
            <div className="menu__empty">{emptyText}</div>
          ) : (
            opts.map((o) => (
              <button
                key={o.value}
                className="menu__item"
                data-active={selected?.value === o.value ? 'true' : undefined}
                onClick={() => {
                  onChange?.(o);
                  setOpen(false);
                  setQ('');
                }}
              >
                {renderOption ? (
                  renderOption(o)
                ) : (
                  <React.Fragment>
                    {o.avatar && <Avatar name={o.label} className="menu__avatar" />}
                    <span className="menu__two-line">
                      {o.label}
                      {o.sublabel && <small>{o.sublabel}</small>}
                    </span>
                  </React.Fragment>
                )}
                {selected?.value === o.value && <i className="ph ph-check menu__item-check" />}
              </button>
            ))
          )}
        </div>
      </Popover>
    </div>
  );
}

Object.assign(window, { NativeSelect, Select, Combobox });
