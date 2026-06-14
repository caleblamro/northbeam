// Theme + Tweaks controls. Replaces the handoff's floating Tweaks panel with a
// brink-style topbar toggle (light/dark, with the View-Transition reveal) plus
// a small popover for the remaining "tweak" directions: accent, density,
// palette, corner radius — all driven by the [data-*] variants in globals.css.

'use client';

import {
  ACCENTS,
  type Accent,
  DARK_PALETTES,
  DENSITIES,
  type Density,
  LIGHT_PALETTES,
  type Palette,
  useTheme,
} from '@/lib/theme';
import { Button } from '@/components/ui/button';
import { Palette as PaletteIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { Icon } from './icons';
import { Popover } from './primitives';

const ACCENT_HEX: Record<Accent, string> = {
  indigo: '#4f46e5',
  iris: '#4f46e5',
  sky: '#0284c7',
  emerald: '#0e9f6e',
  violet: '#7c3aed',
  slate: '#334155',
};

export function ThemeToggle() {
  const { theme, setTheme, mounted } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      <button
        type="button"
        data-active={mounted && theme === 'light' ? 'true' : undefined}
        aria-label="Light"
        onClick={(e) => setTheme('light', { x: e.clientX, y: e.clientY })}
      >
        <Icon name="sun" size={16} />
      </button>
      <button
        type="button"
        data-active={mounted && theme === 'dark' ? 'true' : undefined}
        aria-label="Dark"
        onClick={(e) => setTheme('dark', { x: e.clientX, y: e.clientY })}
      >
        <Icon name="moon" size={16} />
      </button>
    </div>
  );
}

export function TweaksButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const { theme, accent, density, palette, radius, setAccent, setDensity, setPalette, setRadius } =
    useTheme();
  const palettes = theme === 'dark' ? DARK_PALETTES : LIGHT_PALETTES;

  return (
    <div style={{ display: 'inline-flex' }}>
      <span ref={ref} style={{ display: 'inline-flex' }}>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Tweaks"
          data-state={open ? 'open' : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <PaletteIcon />
        </Button>
      </span>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} align="right" width={244}>
        <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Accent */}
          <div>
            <div className="menu__label" style={{ padding: '4px 4px 8px' }}>
              Brand color
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '0 4px' }}>
              {ACCENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-label={a}
                  title={a}
                  onClick={() => setAccent(a)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 99,
                    border: '2px solid',
                    borderColor: accent === a ? 'var(--ink)' : 'transparent',
                    background: ACCENT_HEX[a],
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Density */}
          <div>
            <div className="menu__label" style={{ padding: '4px 4px 8px' }}>
              Density
            </div>
            <div
              className="theme-toggle"
              style={{ borderRadius: 'var(--radius-md)', width: '100%' }}
            >
              {DENSITIES.map((d: Density) => (
                <button
                  key={d}
                  type="button"
                  data-active={density === d ? 'true' : undefined}
                  style={{
                    width: 'auto',
                    flex: 1,
                    fontSize: 'var(--text-sm)',
                    textTransform: 'capitalize',
                  }}
                  onClick={() => setDensity(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Palette */}
          <div>
            <div className="menu__label" style={{ padding: '4px 4px 8px' }}>
              {theme === 'dark' ? 'Dark palette' : 'Light palette'}
            </div>
            <div className="select-wrap" style={{ padding: '0 4px' }}>
              <select value={palette} onChange={(e) => setPalette(e.target.value as Palette | '')}>
                <option value="">Default</option>
                {palettes.map((p) => (
                  <option key={p} value={p}>
                    {p.replace('-', ' ')}
                  </option>
                ))}
              </select>
              <span className="select-wrap__chevron">
                <Icon name="caret-down" size={16} />
              </span>
            </div>
          </div>

          {/* Corner radius */}
          <div style={{ padding: '0 4px' }}>
            <div
              className="menu__label"
              style={{ padding: '4px 0 8px', display: 'flex', justifyContent: 'space-between' }}
            >
              <span>Corner radius</span>
              <span style={{ color: 'var(--ink-muted)' }}>{radius}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={14}
              step={1}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </Popover>
    </div>
  );
}
