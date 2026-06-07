'use client';

// The living design-system gallery. Direct port of the doc shell in
// design_handoff_northbeam/app.jsx — TOC, scrollspy, topbar (theme + tweaks +
// ⌘K), and the stacked component sections.

import { Icon, type IconName } from '@/components/northbeam/icons';
import { BrandChip } from '@/components/northbeam/primitives';
import {
  ButtonsSection,
  ColorSection,
  CommandSection,
  DropdownsSection,
  IconButtonsSection,
  InputsSection,
  IntroSection,
  ScaleSection,
  SidebarShowcaseSection,
  SplitButtonsSection,
  TypeSection,
} from '@/components/northbeam/sections';
import { ThemeToggle, TweaksButton } from '@/components/northbeam/theme-switcher';
import { Button, type ButtonVariant } from '@/components/ui/button';
import { CommandPalette } from '@/components/ui/command';
import { useTheme } from '@/lib/theme';
import { useEffect, useState } from 'react';

type TocEntry = { id: string; label: string; icon: IconName } | { sec: string };

const SECTIONS: TocEntry[] = [
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

export default function SystemGalleryPage() {
  const { theme, accent, palette, mounted } = useTheme();
  const [active, setActive] = useState('overview');
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global ⌘K.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((p) => !p);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Scrollspy.
  useEffect(() => {
    const ids = SECTIONS.filter((s): s is Extract<TocEntry, { id: string }> => 'id' in s).map(
      (s) => s.id,
    );
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  const activeLabel =
    SECTIONS.find((s): s is Extract<TocEntry, { id: string }> => 'id' in s && s.id === active)
      ?.label ?? 'Overview';

  return (
    <div className="doc">
      <aside className="toc ds-scroll">
        <div className="toc__brand">
          <BrandChip size={34} />
          <div>
            <div className="toc__brand-name">Northbeam DS</div>
            <div className="toc__brand-sub">Stripe-inspired · v0.1</div>
          </div>
        </div>
        {SECTIONS.map((s, i) =>
          'sec' in s ? (
            <div className="toc__sec" key={`sec${i}`}>
              {s.sec}
            </div>
          ) : (
            <a
              key={s.id}
              className="toc__link"
              data-active={active === s.id ? 'true' : undefined}
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                go(s.id);
              }}
            >
              <Icon name={s.icon} size={17} />
              {s.label}
            </a>
          ),
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <span className="topbar__title">{activeLabel}</span>
          <span className="topbar__spacer" />
          <Button
            variant={'secondary' as ButtonVariant}
            size="sm"
            icon="command"
            onClick={() => setPaletteOpen(true)}
          >
            Search
          </Button>
          <TweaksButton />
          <ThemeToggle />
        </header>

        <div className="canvas">
          <IntroSection />
          <ColorSection dep={mounted ? `${theme}${accent}${palette}` : ''} />
          <TypeSection />
          <ScaleSection />
          <ButtonsSection />
          <IconButtonsSection />
          <SplitButtonsSection />
          <InputsSection />
          <DropdownsSection />
          <SidebarShowcaseSection onOpenPalette={() => setPaletteOpen(true)} />
          <CommandSection />
        </div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
