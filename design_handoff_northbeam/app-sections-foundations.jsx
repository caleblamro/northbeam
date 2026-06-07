/* app-sections-foundations.jsx — intro + color + type + spacing/radii/shadows */

function useVarValue(name, dep) {
  const [v, setV] = useState('');
  useLayoutEffect(() => {
    const read = () =>
      setV(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    read();
    const t = setTimeout(read, 40);
    return () => clearTimeout(t);
  }, [name, dep]);
  return v;
}

function Swatch({ token, name, dep, dark }) {
  const val = useVarValue(token, dep);
  return (
    <div className="swatch">
      <div
        className="swatch__chip"
        style={{ background: `var(${token})`, borderBottom: '1px solid var(--border)' }}
      />
      <div className="swatch__meta">
        <div className="swatch__name">{name}</div>
        <div className="swatch__val">{val || token}</div>
      </div>
    </div>
  );
}

function IntroSection() {
  return (
    <section className="section" id="overview">
      <div className="intro-card">
        <span className="badge badge--brand" style={{ marginBottom: 14 }}>
          <span className="dot" />
          Design System · v0.1
        </span>
        <h1>Foundations &amp; core building blocks</h1>
        <p>
          A clean, professional component language for the CRM platform — built to feel calm and
          trustworthy at data-heavy scale, in the spirit of Stripe's dashboard. Every token below is
          theme-aware (light / dark) and tunable from the <b>Tweaks</b> panel: try a different brand
          hue, typeface, density, or corner radius.
        </p>
        <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}>
          This page is the living spec. Toggle the theme top-right, open the command palette with
          the buttons in the Navigation section, and interact with every control — they are real,
          not screenshots.
        </p>
        <div className="intro-meta">
          <div>
            <b>8</b>
            <span>component families</span>
          </div>
          <div>
            <b>Light + Dark</b>
            <span>full theming</span>
          </div>
          <div>
            <b>4px</b>
            <span>spacing base unit</span>
          </div>
          <div>
            <b>Phosphor</b>
            <span>icon set</span>
          </div>
        </div>
      </div>
      <div className="callout">
        <i className="ph ph-info" />
        <span>
          Variations are offered for the components you flagged — <b>buttons</b>, <b>inputs</b>, and
          the <b>sidebar</b>. Each shows distinct directions side by side so you can pick what
          becomes the default.
        </span>
      </div>
    </section>
  );
}

const COLOR_BRAND = [
  ['--brand', 'Brand'],
  ['--brand-hover', 'Brand hover'],
  ['--brand-active', 'Brand active'],
];
const COLOR_INK = [
  ['--ink', 'Ink'],
  ['--ink-secondary', 'Ink secondary'],
  ['--ink-muted', 'Ink muted'],
  ['--ink-subtle', 'Ink subtle'],
  ['--ink-disabled', 'Ink disabled'],
];
const COLOR_SURFACE = [
  ['--bg-page', 'Page'],
  ['--surface', 'Surface'],
  ['--surface-sunken', 'Sunken'],
  ['--surface-hover', 'Hover'],
  ['--border', 'Border'],
  ['--border-strong', 'Border strong'],
];
const COLOR_SEMANTIC = [
  ['--success', 'Success'],
  ['--success-bg', 'Success bg'],
  ['--warning', 'Warning'],
  ['--warning-bg', 'Warning bg'],
  ['--danger', 'Danger'],
  ['--danger-bg', 'Danger bg'],
  ['--info', 'Info'],
  ['--info-bg', 'Info bg'],
];

function ColorSection({ dep }) {
  const groups = [
    ['Brand', COLOR_BRAND],
    ['Ink / text', COLOR_INK],
    ['Surfaces & borders', COLOR_SURFACE],
    ['Semantic', COLOR_SEMANTIC],
  ];
  return (
    <section className="section" id="color">
      <div className="section__head">
        <div className="section__eyebrow">Foundations</div>
        <h2 className="section__title">Color</h2>
        <p className="section__desc">
          A cool neutral ramp anchored by navy ink, with a single confident brand hue and restrained
          semantic accents. Values shown update live with the theme and the brand-color Tweak.
        </p>
      </div>
      {groups.map(([title, list]) => (
        <div key={title}>
          <div className="subhead" style={{ fontSize: 'var(--text-base)' }}>
            {title}
          </div>
          <div className="grid grid--auto" style={{ marginBottom: 24 }}>
            {list.map(([token, name]) => (
              <Swatch key={token} token={token} name={name} dep={dep} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

const TYPE_SPECS = [
  ['Display', '--text-display', 700, 'Migrate your CRM in one click'],
  ['Title / H1', '--text-3xl', 600, 'Pipeline overview'],
  ['Heading / H2', '--text-2xl', 600, 'Open opportunities'],
  ['Subheading', '--text-xl', 600, 'Recent activity'],
  ['Body large', '--text-lg', 400, 'Accounts synced from Salesforce appear here automatically.'],
  [
    'Body',
    '--text-base',
    400,
    'Marcus Chen updated the Vertex Industries deal stage to Negotiation.',
  ],
  ['Small / label', '--text-sm', 500, 'Last contacted 3 days ago'],
  ['Caption / micro', '--text-xs', 500, 'UPDATED 12:04 PM'],
];

function TypeSection() {
  return (
    <section className="section" id="type">
      <div className="section__head">
        <div className="section__eyebrow">Foundations</div>
        <h2 className="section__title">Typography</h2>
        <p className="section__desc">
          One sans family carries the whole system. The scale is tight and purposeful for dense
          interfaces. Switch the typeface from the Tweaks panel to compare Inter, Geist, Hanken
          Grotesk, or the native system stack.
        </p>
      </div>
      <div className="frame">
        <div className="frame__bar">
          <h4>Type scale</h4>
          <p>line-height &amp; weight tuned per step</p>
        </div>
        <div style={{ padding: '8px 28px' }}>
          {TYPE_SPECS.map(([name, token, weight, sample]) => (
            <div className="type-row" key={name}>
              <div className="type-meta">
                <b>{name}</b>
                <span>
                  {token.replace('--text-', '')} · {weight}
                </span>
              </div>
              <div
                className="type-sample"
                style={{
                  fontSize: `var(${token})`,
                  fontWeight: weight,
                  lineHeight: 1.2,
                  letterSpacing:
                    token === '--text-display' || token === '--text-3xl' ? '-0.02em' : '0',
                }}
              >
                {sample}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SP_TOKENS = [
  ['--sp-1', 4],
  ['--sp-2', 8],
  ['--sp-3', 12],
  ['--sp-4', 16],
  ['--sp-5', 20],
  ['--sp-6', 24],
  ['--sp-8', 32],
  ['--sp-10', 40],
  ['--sp-12', 48],
  ['--sp-16', 64],
];
const RADII = [
  ['--radius-xs', 'xs'],
  ['--radius-sm', 'sm'],
  ['--radius-md', 'base'],
  ['--radius-lg', 'lg'],
  ['--radius-xl', 'xl'],
  ['--radius-full', 'full'],
];
const SHADOWS = [
  ['--shadow-xs', 'xs'],
  ['--shadow-sm', 'sm'],
  ['--shadow-md', 'md'],
  ['--shadow-lg', 'lg'],
  ['--shadow-pop', 'pop'],
];

function ScaleSection() {
  return (
    <section className="section" id="scale">
      <div className="section__head">
        <div className="section__eyebrow">Foundations</div>
        <h2 className="section__title">Spacing, radius &amp; elevation</h2>
        <p className="section__desc">
          A 4px spacing base keeps rhythm consistent. Corner radius is tunable in one place (Tweaks
          → Corner radius) and flows to every component. Shadows are soft and layered, never harsh.
        </p>
      </div>
      <div className="grid grid--2">
        <div className="frame">
          <div className="frame__bar">
            <h4>Spacing scale</h4>
            <p>4px base</p>
          </div>
          <div className="frame__body frame__body--col" style={{ gap: 2 }}>
            {SP_TOKENS.map(([token, px]) => (
              <div className="sp-row" key={token}>
                <span className="sp-name">{token.replace('--sp-', 'sp-')}</span>
                <div className="sp-bar" style={{ width: `var(${token})` }} />
                <span className="sp-val">{px}px</span>
              </div>
            ))}
          </div>
        </div>
        <div className="frame">
          <div className="frame__bar">
            <h4>Radius</h4>
            <p>tunable base</p>
          </div>
          <div className="frame__body" style={{ gap: 18 }}>
            {RADII.map(([token, name]) => (
              <div key={token} style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    background: 'color-mix(in srgb, var(--brand) 14%, var(--surface))',
                    border: '1.5px solid var(--brand)',
                    borderRadius: `var(${token})`,
                  }}
                />
                <div className="sp-val" style={{ marginTop: 7 }}>
                  {name}
                </div>
              </div>
            ))}
          </div>
          <div
            className="frame__bar"
            style={{ borderTop: '1px solid var(--divider)', borderBottom: 'none' }}
          >
            <h4>Elevation</h4>
            <p>soft, layered</p>
          </div>
          <div className="frame__body" style={{ gap: 22, padding: '32px 28px' }}>
            {SHADOWS.map(([token, name]) => (
              <div key={token} style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: 60,
                    height: 60,
                    background: 'var(--surface)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: `var(${token})`,
                  }}
                />
                <div className="sp-val" style={{ marginTop: 10 }}>
                  {name}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { IntroSection, ColorSection, TypeSection, ScaleSection });
