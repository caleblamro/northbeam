'use client';

// Theme + Tweak state. Mirrors brink's lib/theme.ts: a no-flash inline script
// applies the persisted values before paint, and useTheme() drives the runtime
// toggle with a circular View-Transition reveal. The handoff's floating
// "Tweaks" panel is replaced by these attribute-driven variants
// (theme / accent / density / palette / radius) + the small ThemeSwitcher.

import { useEffect, useState } from 'react';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const ACCENTS = ['indigo', 'iris', 'sky', 'emerald', 'violet', 'slate'] as const;
export type Accent = (typeof ACCENTS)[number];

export const DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
export type Density = (typeof DENSITIES)[number];

// Palette keys per theme (the default — empty attribute — is the tokens.css base).
export const LIGHT_PALETTES = ['cool-gray', 'pure-white', 'warm-sand'] as const;
export const DARK_PALETTES = ['navy', 'slate', 'carbon'] as const;
export type Palette = (typeof LIGHT_PALETTES)[number] | (typeof DARK_PALETTES)[number];

const KEY = {
  theme: 'nb.theme',
  accent: 'nb.accent',
  density: 'nb.density',
  palette: 'nb.palette',
  radius: 'nb.radius',
} as const;

// Inline script — runs before hydration to prevent FOUC. Reads localStorage
// and sets data-theme / data-accent / data-density / data-palette + --radius-base.
export const NO_FLASH_SCRIPT = `
(function(){
  try {
    var r = document.documentElement, ls = localStorage;
    var t = ls.getItem('${KEY.theme}') || 'light';
    var a = ls.getItem('${KEY.accent}') || 'indigo';
    var d = ls.getItem('${KEY.density}') || 'comfortable';
    var p = ls.getItem('${KEY.palette}') || '';
    var rad = ls.getItem('${KEY.radius}');
    r.setAttribute('data-theme', t);
    r.setAttribute('data-density', d);
    if (a !== 'indigo') r.setAttribute('data-accent', a);
    if (p) r.setAttribute('data-palette', p);
    if (rad) r.style.setProperty('--radius-base', rad + 'px');
  } catch (e) {}
})();
`.trim();

function read<T extends string>(attr: string, fallback: T): T {
  if (typeof document === 'undefined') return fallback;
  const v = document.documentElement.getAttribute(attr);
  return (v as T | null) ?? fallback;
}

type Point = { x: number; y: number };

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('light');
  const [accent, setAccentState] = useState<Accent>('indigo');
  const [density, setDensityState] = useState<Density>('comfortable');
  const [palette, setPaletteState] = useState<Palette | ''>('');
  const [radius, setRadiusState] = useState(6);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setThemeState(read('data-theme', 'light'));
    setAccentState((document.documentElement.getAttribute('data-accent') as Accent) ?? 'indigo');
    setDensityState(read('data-density', 'comfortable'));
    setPaletteState((document.documentElement.getAttribute('data-palette') as Palette) ?? '');
    const rad = getComputedStyle(document.documentElement).getPropertyValue('--radius-base').trim();
    if (rad) setRadiusState(Number.parseInt(rad, 10) || 6);
    setMounted(true);
  }, []);

  const applyTheme = (t: Theme) => {
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem(KEY.theme, t);
    } catch {}
    setThemeState(t);
  };

  const setTheme = (t: Theme, origin?: Point) => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || !origin || reduced) {
      applyTheme(t);
      return;
    }
    const { x, y } = origin;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    const transition = document.startViewTransition(() => applyTheme(t));
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
          },
          {
            duration: 520,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        );
      })
      .catch(() => {});
  };

  const setAccent = (a: Accent) => {
    if (a === 'indigo') document.documentElement.removeAttribute('data-accent');
    else document.documentElement.setAttribute('data-accent', a);
    try {
      localStorage.setItem(KEY.accent, a);
    } catch {}
    setAccentState(a);
  };

  const setDensity = (d: Density) => {
    document.documentElement.setAttribute('data-density', d);
    try {
      localStorage.setItem(KEY.density, d);
    } catch {}
    setDensityState(d);
  };

  const setPalette = (p: Palette | '') => {
    if (!p) document.documentElement.removeAttribute('data-palette');
    else document.documentElement.setAttribute('data-palette', p);
    try {
      localStorage.setItem(KEY.palette, p);
    } catch {}
    setPaletteState(p);
  };

  const setRadius = (px: number) => {
    document.documentElement.style.setProperty('--radius-base', `${px}px`);
    try {
      localStorage.setItem(KEY.radius, String(px));
    } catch {}
    setRadiusState(px);
  };

  return {
    theme,
    accent,
    density,
    palette,
    radius,
    mounted,
    setTheme,
    setAccent,
    setDensity,
    setPalette,
    setRadius,
  };
}
