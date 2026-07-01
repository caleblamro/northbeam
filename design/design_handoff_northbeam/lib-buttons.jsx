/* lib-buttons.jsx — Button, IconButton, SplitButton, MenuButton */

function Button({
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  icon,
  iconRight,
  block,
  children,
  className = '',
  ...rest
}) {
  const cls = [
    'btn',
    `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    block && 'btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      className={cls}
      data-loading={loading ? 'true' : undefined}
      disabled={disabled}
      {...rest}
    >
      {loading && (
        <span className="btn__spinner">
          <Spinner />
        </span>
      )}
      {icon && <i className={`ph ph-${icon}`} aria-hidden="true" />}
      {children != null && <span className="btn__label">{children}</span>}
      {iconRight && <i className={`ph ph-${iconRight}`} aria-hidden="true" />}
    </button>
  );
}

function IconButton({
  icon,
  size = 'md',
  variant = '',
  active,
  label,
  weight,
  className = '',
  ...rest
}) {
  const cls = [
    'icon-btn',
    size !== 'md' && `icon-btn--${size}`,
    variant && `icon-btn--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const base = weight ? `ph-${weight}` : 'ph';
  return (
    <button
      className={cls}
      data-active={active ? 'true' : undefined}
      aria-label={label}
      title={label}
      {...rest}
    >
      <i className={`${base} ph-${icon}`} aria-hidden="true" />
    </button>
  );
}

/* Menu: list of { icon, label, sublabel, shortcut, danger, checked, onSelect, separator, group } */
function Menu({ items, onClose, align = 'left', width, style }) {
  const real = items.filter((it) => !it.separator);
  const [idx, setIdx, onKey] = useRovingIndex(real.length, true);
  const select = (it) => {
    it.onSelect?.();
    onClose?.();
  };
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')
        onKey(e, (i) => select(real[i]));
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onKey, real]);
  let ri = -1;
  return (
    <React.Fragment>
      {items.map((it, i) => {
        if (it.separator) return <div className="menu__sep" key={`s${i}`} />;
        if (it.heading)
          return (
            <div className="menu__label" key={`h${i}`}>
              {it.heading}
            </div>
          );
        ri++;
        const here = ri;
        return (
          <button
            key={i}
            role="menuitem"
            className={`menu__item ${it.danger ? 'menu__item--danger' : ''}`}
            data-active={idx === here ? 'true' : undefined}
            onMouseEnter={() => setIdx(here)}
            onClick={() => select(it)}
          >
            {it.icon && <i className={`ph ph-${it.icon}`} />}
            <span>{it.label}</span>
            {it.shortcut && <span className="menu__item-sub">{it.shortcut}</span>}
            {it.checked && <i className="ph ph-check menu__item-check" />}
          </button>
        );
      })}
    </React.Fragment>
  );
}

/* SplitButton: primary action + caret that opens a menu of secondary actions */
function SplitButton({
  children,
  onClick,
  items,
  variant = 'primary',
  size = 'md',
  icon,
  align = 'right',
}) {
  const [open, setOpen] = useState(false);
  const caretRef = useRef(null);
  return (
    <div
      className={`split split--${variant} ${size !== 'md' ? 'split--' + size : ''}`}
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      <Button variant={variant} size={size} icon={icon} onClick={onClick}>
        {children}
      </Button>
      <button
        ref={caretRef}
        className={`btn btn--${variant} ${size !== 'md' ? 'btn--' + size : ''} split__caret`}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <i className="ph ph-caret-down" aria-hidden="true" />
      </button>
      <Popover
        anchorRef={caretRef}
        open={open}
        onClose={() => setOpen(false)}
        align={align}
        width={210}
      >
        <Menu items={items} onClose={() => setOpen(false)} />
      </Popover>
    </div>
  );
}

/* MenuButton: a single button that opens a menu (no default action) */
function MenuButton({
  children,
  items,
  variant = 'secondary',
  size = 'md',
  icon = '',
  caret = true,
  align = 'left',
  iconBtn,
  iconBtnVariant,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return (
    <div ref={ref} style={{ display: 'inline-flex' }}>
      {iconBtn ? (
        <IconButton
          icon={iconBtn}
          variant={iconBtnVariant}
          active={open}
          label="Actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        />
      ) : (
        <Button
          variant={variant}
          size={size}
          icon={icon || undefined}
          iconRight={caret ? 'caret-down' : undefined}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {children}
        </Button>
      )}
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} align={align} width={210}>
        <Menu items={items} onClose={() => setOpen(false)} />
      </Popover>
    </div>
  );
}

Object.assign(window, { Button, IconButton, Menu, SplitButton, MenuButton });
