/* app.jsx — shell, theme, scrollspy, global ⌘K, tweaks */

/* ---- brand palettes (hex → derived shades applied to :root) ---- */
function hexToRgb(h) {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(hex, with_, amt) {
  const a = hexToRgb(hex),
    b = with_ === 'black' ? [0, 0, 0] : [255, 255, 255];
  const r = a.map((c, i) => Math.round(c * (1 - amt) + b[i] * amt));
  return `rgb(${r.join(',')})`;
}
function ring(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

const BRANDS = ['#635bff', '#4f46e5', '#0284c7', '#0e9f6e', '#7c3aed', '#334155'];
const FONTS = {
  Inter: '"Inter", system-ui, sans-serif',
  Geist: '"Geist", system-ui, sans-serif',
  'Hanken Grotesk': '"Hanken Grotesk", system-ui, sans-serif',
  System: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'book-open' },
  { sec: 'Foundations' },
  { id: 'color', label: 'Color', icon: 'palette' },
  { id: 'type', label: 'Typography', icon: 'text-aa' },
  { id: 'scale', label: 'Spacing & elevation', icon: 'ruler' },
  { sec: 'Components' },
  { id: 'buttons', label: 'Buttons', icon: 'cursor-click' },
  { id: 'icon-buttons', label: 'Icon buttons', icon: 'squares-four' },
  { id: 'split-buttons', label: 'Split & menu buttons', icon: 'list-plus' },
  { id: 'inputs', label: 'Inputs', icon: 'textbox' },
  { id: 'dropdowns', label: 'Dropdowns', icon: 'caret-circle-down' },
  { id: 'sidebar', label: 'Sidebar', icon: 'sidebar-simple' },
  { id: 'command', label: 'Command palette', icon: 'command' },
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  font: 'Inter',
  brand: '#635bff',
  density: 'comfortable',
  radius: 6,
  lightTheme: 'Cool gray',
  darkTheme: 'Slate',
} /*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [theme, setTheme] = useState(() => localStorage.getItem('ds-theme') || 'light');
  const [active, setActive] = useState('overview');
  const [palette, setPalette] = useState(false);

  /* theme mode + neutral palette preset */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ds-theme', theme);
    window.applyTheme(theme, t.lightTheme, t.darkTheme);
  }, [theme, t.lightTheme, t.darkTheme]);

  /* tweaks → CSS vars */
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--font-sans', FONTS[t.font] || FONTS.Inter);
    r.setProperty('--brand', t.brand);
    r.setProperty('--brand-hover', mix(t.brand, 'black', 0.12));
    r.setProperty('--brand-active', mix(t.brand, 'black', 0.22));
    r.setProperty('--brand-ring', ring(t.brand, 0.4));
    document.documentElement.dataset.density = t.density;
    r.setProperty('--radius-base', t.radius + 'px');
  }, [t.font, t.brand, t.density, t.radius]);

  /* global ⌘K */
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  /* scrollspy */
  useEffect(() => {
    const ids = SECTIONS.filter((s) => s.id).map((s) => s.id);
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id);
        });
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const go = (id) => {
    const el = document.getElementById(id);
    if (el) {
      const top =
        el.getBoundingClientRect().top +
        (document.querySelector('.main')?.scrollTop || window.scrollY) -
        70;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  return (
    <div className="doc">
      <aside className="toc ds-scroll">
        <div className="toc__brand">
          <span className="toc__logo">N</span>
          <div>
            <div className="toc__brand-name">Northbeam DS</div>
            <div className="toc__brand-sub">Stripe-inspired · v0.1</div>
          </div>
        </div>
        {SECTIONS.map((s, i) =>
          s.sec ? (
            <div className="toc__sec" key={'sec' + i}>
              {s.sec}
            </div>
          ) : (
            <a
              key={s.id}
              className="toc__link"
              data-active={active === s.id ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(s.id);
              }}
              href={'#' + s.id}
            >
              <i className={`ph ph-${s.icon}`} />
              {s.label}
            </a>
          ),
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <span className="topbar__title">
            {SECTIONS.find((s) => s.id === active)?.label || 'Overview'}
          </span>
          <span className="topbar__spacer" />
          <Button variant="secondary" size="sm" icon="command" onClick={() => setPalette(true)}>
            Search
            <span className="kbd" style={{ marginLeft: 4 }}>
              ⌘K
            </span>
          </Button>
          <div className="theme-toggle" role="group" aria-label="Theme">
            <button
              data-active={theme === 'light' ? 'true' : undefined}
              onClick={() => setTheme('light')}
              aria-label="Light"
            >
              <i className="ph ph-sun" />
            </button>
            <button
              data-active={theme === 'dark' ? 'true' : undefined}
              onClick={() => setTheme('dark')}
              aria-label="Dark"
            >
              <i className="ph ph-moon" />
            </button>
          </div>
        </header>

        <div className="canvas">
          <IntroSection />
          <ColorSection dep={theme + t.brand + t.lightTheme + t.darkTheme} />
          <TypeSection />
          <ScaleSection />
          <ButtonsSection />
          <IconButtonsSection />
          <SplitButtonsSection />
          <InputsSection />
          <DropdownsSection />
          <SidebarSection onOpenPalette={() => setPalette(true)} />
          <CommandSection onOpenPalette={() => setPalette(true)} />
        </div>
      </main>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Appearance" />
        <TweakRadio label="Mode" value={theme} options={['light', 'dark']} onChange={setTheme} />
        <TweakSelect
          label="Light palette"
          value={t.lightTheme}
          options={window.DS_THEME_KEYS.light}
          onChange={(v) => setTweak('lightTheme', v)}
        />
        <TweakSelect
          label="Dark palette"
          value={t.darkTheme}
          options={window.DS_THEME_KEYS.dark}
          onChange={(v) => setTweak('darkTheme', v)}
        />
        <TweakSection label="Typeface" />
        <TweakRadio
          label="Font"
          value={t.font}
          options={['Inter', 'Geist', 'Hanken Grotesk', 'System']}
          onChange={(v) => setTweak('font', v)}
        />
        <TweakSection label="Brand color" />
        <TweakColor
          label="Primary"
          value={t.brand}
          options={BRANDS}
          onChange={(v) => setTweak('brand', v)}
        />
        <TweakSection label="Shape & density" />
        <TweakSlider
          label="Corner radius"
          value={t.radius}
          min={0}
          max={14}
          step={1}
          unit="px"
          onChange={(v) => setTweak('radius', v)}
        />
        <TweakRadio
          label="Density"
          value={t.density}
          options={['compact', 'comfortable', 'spacious']}
          onChange={(v) => setTweak('density', v)}
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
