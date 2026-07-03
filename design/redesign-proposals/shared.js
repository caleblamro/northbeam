/* Northbeam redesign proposals — shared behavior. Load with <script src> (no defer)
   right after <body> opens so theme applies before first paint of content. */

(() => {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  const saved = fromUrl || localStorage.getItem('nb-mock-theme');
  if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
})();

function nbToggleTheme() {
  const el = document.documentElement;
  const dark = el.getAttribute('data-theme') === 'dark';
  if (dark) el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', 'dark');
  localStorage.setItem('nb-mock-theme', dark ? 'light' : 'dark');
}

/* Lucide path data (24x24, stroke) — matches the app's icon set */
const NB_ICONS = {
  grip: '<circle cx="5" cy="5" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="19" cy="5" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="19" r="1"/><circle cx="12" cy="19" r="1"/><circle cx="19" cy="19" r="1"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54Z"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'arrow-up-right': '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  'trending-up': '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  note: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  dollar: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
  building: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
};

function nbHydrateIcons(root = document) {
  for (const el of root.querySelectorAll('svg[data-icon]')) {
    const paths = NB_ICONS[el.getAttribute('data-icon')];
    if (paths) {
      el.setAttribute('viewBox', '0 0 24 24');
      el.innerHTML = paths;
    }
  }
}

/* Sparkline: <svg class="spark" data-points="3,5,4,8,..." data-w="220" data-h="56"> */
function nbSparklines(root = document) {
  for (const el of root.querySelectorAll('svg.spark')) {
    const pts = (el.getAttribute('data-points') || '').split(',').map(Number);
    if (pts.length < 2) continue;
    const w = Number(el.getAttribute('data-w') || 220);
    const h = Number(el.getAttribute('data-h') || 56);
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const pad = 2;
    const step = (w - pad * 2) / (pts.length - 1);
    const y = (v) => pad + (h - pad * 2) * (1 - (v - min) / span);
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(pad + i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    el.setAttribute('viewBox', `0 0 ${w} ${h}`);
    el.setAttribute('width', w);
    el.setAttribute('height', h);
    const fill = el.hasAttribute('data-fill')
      ? `<path d="${d} L${w - pad} ${h - pad} L${pad} ${h - pad} Z" fill="currentColor" opacity="0.07" stroke="none"/>`
      : '';
    el.innerHTML = `${fill}<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  nbHydrateIcons();
  nbSparklines();
});

/* Shared topbar — every mockup calls nbTopbar('Deals') with the active tab */
function nbTopbar(active) {
  const tabs = ['Home', 'Accounts', 'Contacts', 'Deals', 'Activities', 'Pipeline'];
  document.write(`
  <header class="nb-topbar">
    <button class="nb-waffle" title="App launcher"><svg class="i" data-icon="grip"></svg></button>
    <a class="nb-brand" href="index.html">
      <svg viewBox="0 0 16 16"><path d="M3 13 V3 L13 13 V3"/></svg>
      <span class="word">northbeam</span>
    </a>
    <button class="nb-org">Lamro Industries <svg class="i" data-icon="chevron-down" style="width:11px;height:11px"></svg></button>
    <span class="sep"></span>
    <nav class="nb-tabs">
      ${tabs.map((t) => `<a class="nb-tab" ${t === active ? 'aria-current="page"' : ''} href="#">${t}</a>`).join('')}
    </nav>
    <span class="spacer"></span>
    <button class="nb-search"><svg class="i" data-icon="search" style="width:13px;height:13px"></svg> Search Northbeam… <kbd>⌘K</kbd></button>
    <button class="nb-iconbtn" title="Help"><svg class="i" data-icon="help"></svg></button>
    <button class="nb-iconbtn" title="Notifications"><svg class="i" data-icon="bell"></svg></button>
    <button class="nb-iconbtn" title="Toggle theme" onclick="nbToggleTheme()">
      <svg class="i icon-sun" data-icon="sun"></svg><svg class="i icon-moon" data-icon="moon"></svg>
    </button>
    <span class="nb-avatar">CL</span>
  </header>`);
}

function nbBadge(key, name) {
  document.write(`
  <div class="variant-badge">
    <span class="k">${key}</span><b>${name}</b><a href="index.html">All variants →</a>
  </div>`);
}
