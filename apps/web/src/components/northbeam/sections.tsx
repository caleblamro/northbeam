// Gallery sections. Direct port of design_handoff_northbeam/app-sections-*.jsx
// onto the React component library. Each is a <Section> the /system page stacks.

'use client';

import { DEAL_STAGE_OPTIONS } from '@/lib/tones';
import { useState } from 'react';
import { Button, IconButton, MenuButton, type MenuItem, SplitButton } from '../ui/button';
import { CommandPalette } from '../ui/command';
import { CurrencyInput, EmailInput, Field, MaskedInput, PhoneInput, TextInput } from '../ui/input';
import { Combobox, NativeSelect, type Option, Select } from '../ui/select';
import { Frame, Section, SegToggle, Swatch } from './doc';
import { Badge, Kbd } from './primitives';
import { Sidebar } from './sidebar';

/* ── Foundations ─────────────────────────────────────────────────────────── */

export function IntroSection() {
  return (
    <section className="section" id="overview">
      <div className="intro-card">
        <Badge variant="brand" dot>
          Design System · v0.1
        </Badge>
        <h1 style={{ marginTop: 14 }}>Foundations &amp; core building blocks</h1>
        <p>
          A clean, professional component language for the Northbeam CRM — built to feel calm and
          trustworthy at data-heavy scale, in the spirit of Stripe's dashboard. Every token below is
          theme-aware (light / dark) and tunable from the <b>Tweaks</b> control: try a different
          brand hue, density, palette, or corner radius.
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
            <b>lucide</b>
            <span>icon set</span>
          </div>
        </div>
      </div>
      <div className="callout">
        <span>
          Variations are offered for <b>buttons</b>, <b>inputs</b>, and the <b>sidebar</b> — each
          shows distinct directions side by side so you can pick a default.
        </span>
      </div>
    </section>
  );
}

const COLOR_GROUPS: [string, [string, string][]][] = [
  [
    'Brand',
    [
      ['--brand', 'Brand'],
      ['--brand-hover', 'Brand hover'],
      ['--brand-active', 'Brand active'],
    ],
  ],
  [
    'Ink / text',
    [
      ['--ink', 'Ink'],
      ['--ink-secondary', 'Ink secondary'],
      ['--ink-muted', 'Ink muted'],
      ['--ink-subtle', 'Ink subtle'],
      ['--ink-disabled', 'Ink disabled'],
    ],
  ],
  [
    'Surfaces & borders',
    [
      ['--bg-page', 'Page'],
      ['--surface', 'Surface'],
      ['--surface-sunken', 'Sunken'],
      ['--surface-hover', 'Hover'],
      ['--border', 'Border'],
      ['--border-strong', 'Border strong'],
    ],
  ],
  [
    'Semantic',
    [
      ['--success', 'Success'],
      ['--warning', 'Warning'],
      ['--danger', 'Danger'],
      ['--info', 'Info'],
    ],
  ],
];

export function ColorSection({ dep }: { dep: unknown }) {
  return (
    <Section
      id="color"
      eyebrow="Foundations"
      title="Color"
      desc="A cool neutral ramp anchored by navy ink, with a single confident brand hue and restrained semantic accents. Values update live with the theme and the brand-color tweak."
    >
      {COLOR_GROUPS.map(([title, list]) => (
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
    </Section>
  );
}

const TYPE_SPECS: [string, string, number, string][] = [
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

export function TypeSection() {
  return (
    <Section
      id="type"
      eyebrow="Foundations"
      title="Typography"
      desc="One sans family carries the whole system. The scale is tight and purposeful for dense interfaces."
    >
      <Frame title="Type scale" hint="line-height & weight tuned per step">
        <div className="frame__body--col" style={{ width: '100%', padding: 0 }}>
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
      </Frame>
    </Section>
  );
}

const SP_TOKENS: [string, number][] = [
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
const RADII: [string, string][] = [
  ['--radius-xs', 'xs'],
  ['--radius-sm', 'sm'],
  ['--radius-md', 'base'],
  ['--radius-lg', 'lg'],
  ['--radius-xl', 'xl'],
  ['--radius-full', 'full'],
];
const SHADOWS: [string, string][] = [
  ['--shadow-xs', 'xs'],
  ['--shadow-sm', 'sm'],
  ['--shadow-md', 'md'],
  ['--shadow-lg', 'lg'],
  ['--shadow-pop', 'pop'],
];

export function ScaleSection() {
  return (
    <Section
      id="scale"
      eyebrow="Foundations"
      title="Spacing, radius & elevation"
      desc="A 4px spacing base keeps rhythm consistent. Corner radius is tunable in one place and flows to every component. Shadows are soft and layered."
    >
      <div className="grid grid--2">
        <Frame
          title="Spacing scale"
          hint="4px base"
          bodyClass="frame__body--col"
          bodyStyle={{ gap: 2 }}
        >
          {SP_TOKENS.map(([token, px]) => (
            <div className="sp-row" key={token}>
              <span className="sp-name">{token.replace('--sp-', 'sp-')}</span>
              <div className="sp-bar" style={{ width: `var(${token})` }} />
              <span className="sp-val">{px}px</span>
            </div>
          ))}
        </Frame>
        <Frame title="Radius" hint="tunable base" bodyStyle={{ gap: 18 }}>
          {RADII.map(([token, name]) => (
            <div key={token} style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: 56,
                  height: 56,
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
          {SHADOWS.map(([token, name]) => (
            <div key={token} style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: 56,
                  height: 56,
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
        </Frame>
      </div>
    </Section>
  );
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */

const MORE_ITEMS: MenuItem[] = [
  { icon: 'pencil-simple', label: 'Edit details' },
  { icon: 'copy', label: 'Duplicate', shortcut: '⌘D' },
  { icon: 'arrow-square-out', label: 'Open in new tab' },
  { separator: true },
  { icon: 'archive', label: 'Archive' },
  { icon: 'trash', label: 'Delete', danger: true },
];
const SAVE_ITEMS: MenuItem[] = [
  { icon: 'check', label: 'Save' },
  { icon: 'paper-plane-tilt', label: 'Save & send' },
  { icon: 'copy', label: 'Save as draft' },
];

export function ButtonsSection() {
  const [treat, setTreat] = useState<'flat' | 'elevated' | 'soft'>('flat');
  const [loading, setLoading] = useState(false);
  const fire = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1600);
  };
  const treatClass = treat === 'flat' ? '' : `treat-${treat}`;
  return (
    <Section
      id="buttons"
      eyebrow="Components · variations to choose from"
      title="Buttons"
      desc="Five variants across three sizes, with loading and disabled states. Use the switch to preview three styling directions."
    >
      <Frame
        title="Styling direction"
        hint={
          treat === 'flat'
            ? 'Crisp, minimal shadow — closest to the modern Stripe dashboard.'
            : treat === 'elevated'
              ? 'Gradient highlight + colored shadow + lift on hover.'
              : 'Tinted low-contrast surfaces — gentle and understated.'
        }
        tag={
          <SegToggle
            value={treat}
            onChange={setTreat}
            options={[
              { value: 'flat', label: 'Flat' },
              { value: 'elevated', label: 'Elevated' },
              { value: 'soft', label: 'Soft' },
            ]}
          />
        }
        bodyClass={`frame__body--col ${treatClass}`}
        bodyStyle={{ gap: 22 }}
      >
        <div className="row">
          <span className="cluster-label">Variants</span>
          <Button variant="primary" icon="plus">
            Create contact
          </Button>
          <Button variant="secondary" icon="funnel">
            Filter
          </Button>
          <Button variant="ghost" icon="arrows-clockwise">
            Refresh
          </Button>
          <Button variant="danger" icon="trash">
            Delete
          </Button>
          <Button variant="link" iconRight="arrow-right">
            View all
          </Button>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <span className="cluster-label">Sizes</span>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button variant="secondary" size="sm">
            Small
          </Button>
          <Button variant="secondary" size="md">
            Medium
          </Button>
          <Button variant="secondary" size="lg">
            Large
          </Button>
        </div>
        <div className="row">
          <span className="cluster-label">States</span>
          <Button loading={loading} onClick={fire}>
            {loading ? 'Saving' : 'Click to load'}
          </Button>
          <Button disabled>Disabled</Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button icon="check" iconRight="caret-down">
            With icons
          </Button>
        </div>
      </Frame>
    </Section>
  );
}

export function IconButtonsSection() {
  const [star, setStar] = useState(false);
  return (
    <Section
      id="icon-buttons"
      eyebrow="Components"
      title="Icon buttons"
      desc="Square, label-free actions for toolbars and dense table rows. Always carry an aria-label and tooltip."
    >
      <Frame bodyClass="frame__body--col" bodyStyle={{ gap: 22 }}>
        <div className="row">
          <span className="cluster-label">Emphasis</span>
          <IconButton icon="dots-three" label="More" />
          <IconButton icon="pencil-simple" label="Edit" variant="bordered" />
          <IconButton icon="plus" label="Add" variant="solid" />
          <IconButton
            icon="star"
            fill={star}
            label="Star"
            active={star}
            onClick={() => setStar(!star)}
          />
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="cluster-label">Sizes</span>
          <IconButton icon="gear-six" label="Settings" size="sm" variant="bordered" />
          <IconButton icon="gear-six" label="Settings" size="md" variant="bordered" />
          <IconButton icon="gear-six" label="Settings" size="lg" variant="bordered" />
        </div>
        <div className="row">
          <span className="cluster-label">In a toolbar</span>
          <div
            className="row row--tight"
            style={{
              padding: 6,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface)',
            }}
          >
            <IconButton icon="text-b" label="Bold" size="sm" />
            <IconButton icon="text-italic" label="Italic" size="sm" />
            <IconButton icon="link-simple" label="Link" size="sm" />
            <span
              style={{
                width: 1,
                alignSelf: 'stretch',
                background: 'var(--divider)',
                margin: '4px 2px',
              }}
            />
            <IconButton icon="list-bullets" label="List" size="sm" />
            <IconButton icon="paperclip" label="Attach" size="sm" />
          </div>
        </div>
      </Frame>
    </Section>
  );
}

export function SplitButtonsSection() {
  return (
    <Section
      id="split-buttons"
      eyebrow="Components"
      title="Buttons with additional actions"
      desc="When a control has one obvious action plus secondary ones, use a split button (primary action + caret menu) or a menu button (the whole button opens the menu)."
    >
      <div className="grid grid--2">
        <Frame title="Split button" hint="primary action + caret menu" bodyStyle={{ gap: 18 }}>
          <SplitButton variant="primary" icon="check" items={SAVE_ITEMS}>
            Save
          </SplitButton>
          <SplitButton variant="secondary" items={MORE_ITEMS}>
            Export
          </SplitButton>
        </Frame>
        <Frame title="Menu button" hint="whole trigger opens a menu" bodyStyle={{ gap: 18 }}>
          <MenuButton
            variant="secondary"
            icon="plus"
            items={[
              { heading: 'Create' },
              { icon: 'user-plus', label: 'Contact' },
              { icon: 'buildings', label: 'Account' },
              { icon: 'currency-circle-dollar', label: 'Deal' },
            ]}
          >
            New
          </MenuButton>
          <MenuButton variant="ghost" items={MORE_ITEMS}>
            Actions
          </MenuButton>
          <MenuButton
            iconBtn="dots-three-vertical"
            iconBtnVariant="bordered"
            align="right"
            items={MORE_ITEMS}
          />
        </Frame>
      </div>
      <div className="callout">
        <span>
          The same <span className="mono">Menu</span> primitive powers split buttons, the record-row
          “⋯” menu, dropdowns, and the command palette — one keyboard model, one look.
        </span>
      </div>
    </Section>
  );
}

/* ── Inputs ──────────────────────────────────────────────────────────────── */

export function InputsSection() {
  const [variant, setVariant] = useState<'' | 'filled' | 'underline'>('');
  const [text, setText] = useState('Vertex Industries');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('48,000.00');
  const [card, setCard] = useState('');
  const [date, setDate] = useState('');
  const [search, setSearch] = useState('');
  const emailErr = email !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  return (
    <Section
      id="inputs"
      eyebrow="Components · variations to choose from"
      title="Inputs"
      desc="Text, email, phone, currency, and masked fields share one wrapper — with icons, affixes, and validation states. Switch the field style to compare three directions."
    >
      <Frame
        title="Field style"
        hint={
          variant === ''
            ? 'Bordered with soft shadow — the dependable default.'
            : variant === 'filled'
              ? 'Filled grey wells — quiet until focused.'
              : 'Underline only — minimal, good for in-place editing.'
        }
        tag={
          <SegToggle
            value={variant}
            onChange={setVariant}
            options={[
              { value: '', label: 'Bordered' },
              { value: 'filled', label: 'Filled' },
              { value: 'underline', label: 'Underline' },
            ]}
          />
        }
        bodyClass="frame__body--col"
        bodyStyle={{ gap: 'var(--row-gap)' }}
      >
        <div className="grid grid--2" style={{ width: '100%' }}>
          <Field label="Company name" required>
            <TextInput variant={variant} value={text} onChange={setText} leadIcon="buildings" />
          </Field>
          <Field
            label="Work email"
            required
            error={emailErr ? 'Enter a valid email address' : undefined}
          >
            <EmailInput
              variant={variant}
              value={email}
              onChange={setEmail}
              state={emailErr ? 'error' : undefined}
            />
          </Field>
          <Field label="Phone" optional hint="Formats as you type">
            <PhoneInput variant={variant} value={phone} onChange={setPhone} />
          </Field>
          <Field label="Deal amount" hint="Normalizes on blur">
            <CurrencyInput variant={variant} value={amount} onChange={setAmount} />
          </Field>
          <Field label="Card number" hint="Masked · 4-4-4-4">
            <MaskedInput
              variant={variant}
              value={card}
              onChange={setCard}
              mask="9999 9999 9999 9999"
              leadIcon="credit-card"
            />
          </Field>
          <Field label="Close date" hint="Masked · MM / DD / YYYY">
            <MaskedInput
              variant={variant}
              value={date}
              onChange={setDate}
              mask="99/99/9999"
              leadIcon="calendar-blank"
              placeholder="MM/DD/YYYY"
            />
          </Field>
        </div>
      </Frame>

      <div className="subhead">States</div>
      <Frame bodyClass="frame__body--col" bodyStyle={{ gap: 'var(--row-gap)' }}>
        <div className="grid grid--3" style={{ width: '100%' }}>
          <Field label="Default">
            <TextInput variant={variant} value="" placeholder="Placeholder" />
          </Field>
          <Field label="With value">
            <TextInput variant={variant} value="Marcus Chen" />
          </Field>
          <Field label="Error" error="This field is required">
            <TextInput variant={variant} value="" state="error" placeholder="Required" />
          </Field>
          <Field label="Success" success="Looks good">
            <TextInput
              variant={variant}
              value="marcus@vertex.io"
              state="success"
              trailIcon="check-circle"
            />
          </Field>
          <Field label="Disabled">
            <TextInput variant={variant} value="Read only" disabled />
          </Field>
          <Field label="Search (clearable)">
            <TextInput
              variant={variant}
              value={search}
              onChange={setSearch}
              leadIcon="magnifying-glass"
              trailIcon={search ? 'x-circle' : undefined}
              onClickTrail={() => setSearch('')}
              placeholder="Search records"
            />
          </Field>
        </div>
      </Frame>
    </Section>
  );
}

/* ── Dropdowns ───────────────────────────────────────────────────────────── */

const PEOPLE: [string, string][] = [
  ['Marcus Chen', 'VP Sales · Vertex Industries'],
  ['Priya Anand', 'CTO · Lumen Labs'],
  ['Sofia Reyes', 'Procurement · Northwind'],
  ['David Okafor', 'Founder · Brightpath'],
  ['Hannah Müller', 'Ops Lead · Vertex Industries'],
  ['Liam Walsh', 'CFO · Lumen Labs'],
  ['Yuki Tanaka', 'Designer · Brightpath'],
  ['Amara Singh', 'RevOps · Northwind'],
];

function fakeLoad(q: string): Promise<Option[]> {
  return new Promise((res) => {
    setTimeout(() => {
      const s = q.toLowerCase();
      res(
        PEOPLE.filter(([n, r]) => (n + r).toLowerCase().includes(s)).map(([n, r]) => ({
          value: n,
          label: n,
          sublabel: r,
          avatar: true,
        })),
      );
    }, 650);
  });
}

const OWNER_OPTS: Option[] = [
  { value: 'jm', label: 'Jordan Mills', sublabel: 'jordan@acme.com' },
  { value: 'ak', label: 'Aisha Khan', sublabel: 'aisha@acme.com' },
  { value: 'rt', label: 'Ravi Teja', sublabel: 'ravi@acme.com' },
];

export function DropdownsSection() {
  const [stage, setStage] = useState('qualified');
  const [owner, setOwner] = useState('jm');
  const [region, setRegion] = useState('us');
  const [contact, setContact] = useState<Option | null>(null);
  return (
    <Section
      id="dropdowns"
      eyebrow="Components"
      title="Dropdowns"
      desc="Static selects for fixed option sets, and an async combobox that searches your records with debounced loading — the kind you'll use mapping Salesforce fields."
    >
      <div className="grid grid--2">
        <Frame
          title="Static"
          hint="fixed options"
          bodyClass="frame__body--col"
          bodyStyle={{ gap: 'var(--row-gap)' }}
        >
          <Field label="Deal stage">
            <Select value={stage} onChange={setStage} options={DEAL_STAGE_OPTIONS} />
          </Field>
          <Field label="Owner">
            <Select value={owner} onChange={setOwner} options={OWNER_OPTS} leadIcon="user" />
          </Field>
          <Field label="Region (native)" hint="Native select, fully styled">
            <NativeSelect
              value={region}
              onChange={setRegion}
              options={[
                { value: 'us', label: 'United States' },
                { value: 'eu', label: 'Europe' },
                { value: 'apac', label: 'Asia-Pacific' },
              ]}
            />
          </Field>
        </Frame>
        <Frame
          title="Async combobox"
          hint="debounced search · 650ms"
          bodyClass="frame__body--col"
          bodyStyle={{ gap: 'var(--row-gap)' }}
        >
          <Field
            label="Link a contact"
            hint={contact ? `Selected: ${contact.label}` : 'Try “lumen”, “vertex”, or a name'}
          >
            <Combobox
              value={contact}
              onChange={setContact}
              loadOptions={fakeLoad}
              placeholder="Search contacts…"
              emptyText="No contacts found"
            />
          </Field>
          <div className="callout" style={{ margin: 0 }}>
            <span>
              Loading state while fetching, empty state with no matches, clear button once chosen.
            </span>
          </div>
        </Frame>
      </div>
    </Section>
  );
}

/* ── Navigation ──────────────────────────────────────────────────────────── */

export function SidebarShowcaseSection({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <Section
      id="sidebar"
      eyebrow="Components · variations to choose from"
      title="Sidebar"
      desc="The primary navigation rail: workspace switcher, search trigger, grouped nav with counts, and a user footer. Three directions — pick the active-state treatment and width that fit."
    >
      <div className="grid grid--3">
        <div>
          <div className="subhead" style={{ fontSize: 'var(--text-base)', margin: '0 0 12px' }}>
            Classic <Badge variant="brand">Recommended</Badge>
          </div>
          <p className="note">Tinted pill marks the active item.</p>
          <Sidebar variant="classic" active="Contacts" onPalette={onOpenPalette} />
        </div>
        <div>
          <div className="subhead" style={{ fontSize: 'var(--text-base)', margin: '0 0 12px' }}>
            Accent bar
          </div>
          <p className="note">A left accent bar instead of a fill.</p>
          <Sidebar variant="bar" active="Deals" onPalette={onOpenPalette} />
        </div>
        <div>
          <div className="subhead" style={{ fontSize: 'var(--text-base)', margin: '0 0 12px' }}>
            Icon rail
          </div>
          <p className="note">Collapsed to 64px with hover labels — maximizes canvas.</p>
          <Sidebar variant="rail" active="Contacts" />
        </div>
      </div>
    </Section>
  );
}

export function CommandSection() {
  const [localOpen, setLocalOpen] = useState(false);
  return (
    <Section
      id="command"
      eyebrow="Components"
      title="Command palette"
      desc={
        <>
          A keyboard-first launcher (<Kbd>⌘K</Kbd>) that unifies quick actions, navigation, and
          search across records. Arrow keys move, Enter selects, Esc closes — try it.
        </>
      }
    >
      <Frame
        title="Live preview"
        hint="opens inside this frame"
        tag={
          <Button icon="command" onClick={() => setLocalOpen(true)}>
            Open palette
          </Button>
        }
        bodyClass="frame__body--center"
        bodyStyle={{
          position: 'relative',
          minHeight: 460,
          padding: 0,
          overflow: 'hidden',
          background: 'var(--surface-sunken)',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            opacity: 0.5,
          }}
        >
          <div
            style={{
              height: 40,
              background: 'var(--surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
            }}
          />
          <div className="grid grid--3" style={{ gap: 14 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  height: 96,
                  background: 'var(--surface)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                }}
              />
            ))}
          </div>
          <div
            style={{
              flex: 1,
              background: 'var(--surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
            }}
          />
        </div>
        {!localOpen && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setLocalOpen(true)}
            style={{ position: 'relative', zIndex: 2 }}
          >
            Press to open · <Kbd style={{ marginLeft: 4 }}>⌘K</Kbd>
          </button>
        )}
        <CommandPalette open={localOpen} onClose={() => setLocalOpen(false)} contained />
      </Frame>
    </Section>
  );
}
