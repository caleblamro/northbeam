/* lib-inputs.jsx — Field wrapper + Text/Email/Phone/Currency/Masked inputs */

/* ---- mask engine: 9 = digit, A = letter, * = alnum; other chars are literals ---- */
function applyMask(raw, mask) {
  const v = (raw || '').toString();
  let out = '',
    vi = 0;
  const isOk = (c, t) =>
    t === '9' ? /\d/.test(c) : t === 'A' ? /[a-z]/i.test(c) : /[a-z0-9]/i.test(c);
  for (let mi = 0; mi < mask.length && vi < v.length; mi++) {
    const m = mask[mi];
    if (m === '9' || m === 'A' || m === '*') {
      while (vi < v.length && !isOk(v[vi], m)) vi++;
      if (vi < v.length) {
        out += v[vi];
        vi++;
      }
    } else {
      out += m;
      if (v[vi] === m) vi++;
    }
  }
  return out;
}

/* ---- Field: label + control + hint/error scaffolding ---- */
function Field({ label, required, optional, hint, error, success, htmlFor, children, style }) {
  return (
    <div className="field" style={style}>
      {label && (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
          {required && <span className="field__req">*</span>}
          {optional && <span className="field__optional">optional</span>}
        </label>
      )}
      {children}
      {error ? (
        <div className="field__error">
          <i className="ph ph-warning-circle" />
          {error}
        </div>
      ) : success ? (
        <div className="field__success">
          <i className="ph ph-check-circle" />
          {success}
        </div>
      ) : hint ? (
        <div className="field__hint">{hint}</div>
      ) : null}
    </div>
  );
}

/* ---- generic styled input row ---- */
function InputBox({
  size = 'md',
  variant,
  state,
  disabled,
  leadIcon,
  trailIcon,
  leadAffix,
  trailAffix,
  children,
  onClickTrail,
}) {
  const cls = [
    'input-wrap',
    size !== 'md' && `input-wrap--${size}`,
    variant && `input-wrap--${variant}`,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} data-state={state} data-disabled={disabled ? 'true' : undefined}>
      {leadIcon && (
        <span className="input-wrap__icon">
          <i className={`ph ph-${leadIcon}`} />
        </span>
      )}
      {leadAffix && <span className="input-wrap__affix input-wrap__affix--lead">{leadAffix}</span>}
      {children}
      {trailAffix && <span className="input-wrap__affix">{trailAffix}</span>}
      {trailIcon &&
        (onClickTrail ? (
          <button
            type="button"
            className="input-wrap__icon"
            style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }}
            onClick={onClickTrail}
          >
            <i className={`ph ph-${trailIcon}`} />
          </button>
        ) : (
          <span className="input-wrap__icon">
            <i className={`ph ph-${trailIcon}`} />
          </span>
        ))}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  size,
  variant,
  state,
  disabled,
  leadIcon,
  trailIcon,
  leadAffix,
  trailAffix,
  onClickTrail,
  inputMode,
  maxLength,
  ...rest
}) {
  return (
    <InputBox
      size={size}
      variant={variant}
      state={state}
      disabled={disabled}
      leadIcon={leadIcon}
      trailIcon={trailIcon}
      leadAffix={leadAffix}
      trailAffix={trailAffix}
      onClickTrail={onClickTrail}
    >
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        maxLength={maxLength}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      />
    </InputBox>
  );
}

/* ---- Email with light validation ---- */
function EmailInput({ value, onChange, ...rest }) {
  return (
    <TextInput
      type="email"
      inputMode="email"
      leadIcon="envelope-simple"
      placeholder="you@company.com"
      value={value}
      onChange={onChange}
      {...rest}
    />
  );
}

/* ---- Phone (US format) ---- */
function PhoneInput({ value, onChange, ...rest }) {
  const fmt = (v) => applyMask(v.replace(/\D/g, ''), '(999) 999-9999');
  return (
    <TextInput
      type="tel"
      inputMode="tel"
      leadIcon="phone"
      placeholder="(555) 000-0000"
      value={value}
      onChange={(v) => onChange?.(fmt(v))}
      {...rest}
    />
  );
}

/* ---- Currency: $ prefix, grouped, normalized on blur ---- */
function CurrencyInput({ value, onChange, currency = 'USD', symbol = '$', code = 'USD', ...rest }) {
  const group = (v) => {
    const cleaned = v.replace(/[^\d.]/g, '');
    const [int, dec] = cleaned.split('.');
    const gi = (int || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return dec != null ? `${gi}.${dec.slice(0, 2)}` : gi;
  };
  return (
    <InputBox leadAffix={symbol} trailAffix={code} {...rest}>
      <input
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        style={{ textAlign: 'left' }}
        onChange={(e) => onChange?.(group(e.target.value))}
        onBlur={(e) => {
          const n = Number.parseFloat(e.target.value.replace(/,/g, ''));
          if (!isNaN(n)) onChange?.(group(n.toFixed(2)));
        }}
      />
    </InputBox>
  );
}

/* ---- Masked (card / date / ssn / custom) ---- */
function MaskedInput({
  value,
  onChange,
  mask = '9999 9999 9999 9999',
  leadIcon,
  placeholder,
  ...rest
}) {
  return (
    <TextInput
      inputMode="numeric"
      leadIcon={leadIcon}
      placeholder={placeholder || mask.replace(/9/g, '0').replace(/A/g, 'X')}
      value={value}
      onChange={(v) => onChange?.(applyMask(v, mask))}
      {...rest}
    />
  );
}

Object.assign(window, {
  applyMask,
  Field,
  InputBox,
  TextInput,
  EmailInput,
  PhoneInput,
  CurrencyInput,
  MaskedInput,
});
