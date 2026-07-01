/* app-sections-buttons.jsx — Buttons, Icon buttons, Split / menu buttons */

function SegToggle({ value, onChange, options }) {
  return (
    <div className="theme-toggle" style={{ borderRadius: 'var(--radius-md)' }}>
      {options.map((o) => (
        <button
          key={o.value}
          data-active={value === o.value ? 'true' : undefined}
          style={{
            width: 'auto',
            padding: '0 12px',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            fontFamily: 'inherit',
          }}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const MORE_ITEMS = [
  { icon: 'pencil-simple', label: 'Edit details' },
  { icon: 'copy', label: 'Duplicate', shortcut: '⌘D' },
  { icon: 'arrow-square-out', label: 'Open in new tab' },
  { separator: true },
  { icon: 'archive', label: 'Archive' },
  { icon: 'trash', label: 'Delete', danger: true },
];
const SAVE_ITEMS = [
  { icon: 'check', label: 'Save' },
  { icon: 'paper-plane-tilt', label: 'Save & send' },
  { icon: 'copy', label: 'Save as draft' },
];

function ButtonsSection() {
  const [treat, setTreat] = useState('flat');
  const [loading, setLoading] = useState(false);
  const fire = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1600);
  };
  const treatClass = treat === 'flat' ? '' : `treat-${treat}`;
  return (
    <section className="section" id="buttons">
      <div className="section__head">
        <div className="section__eyebrow">Components · variations to choose from</div>
        <h2 className="section__title">Buttons</h2>
        <p className="section__desc">
          Five variants across three sizes, with loading and disabled states. Use the switch to
          preview three styling directions — pick one to become the system default.
        </p>
      </div>

      <div className="frame">
        <div className="frame__bar">
          <h4>Styling direction</h4>
          <p>
            {treat === 'flat'
              ? 'Crisp, minimal shadow — closest to the modern Stripe dashboard.'
              : treat === 'elevated'
                ? 'Gradient highlight + colored shadow + lift on hover — marketing energy.'
                : 'Tinted low-contrast surfaces — gentle and understated.'}
          </p>
          <span className="frame__tag">
            <SegToggle
              value={treat}
              onChange={setTreat}
              options={[
                { value: 'flat', label: 'Flat' },
                { value: 'elevated', label: 'Elevated' },
                { value: 'soft', label: 'Soft' },
              ]}
            />
          </span>
        </div>
        <div className={`frame__body frame__body--col ${treatClass}`} style={{ gap: 22 }}>
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
            <Button variant="primary" size="sm">
              Small
            </Button>
            <Button variant="primary" size="md">
              Medium
            </Button>
            <Button variant="primary" size="lg">
              Large
            </Button>
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
            <Button variant="primary" loading={loading} onClick={fire}>
              {loading ? 'Saving' : 'Click to load'}
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
            <Button variant="primary" icon="check" iconRight="caret-down">
              With icons
            </Button>
          </div>
        </div>
      </div>

      <div className="subhead">Anatomy &amp; usage</div>
      <table className="spec">
        <thead>
          <tr>
            <th>Variant</th>
            <th>Class</th>
            <th>When to use</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <Button variant="primary" size="sm">
                Primary
              </Button>
            </td>
            <td>
              <span className="mono">.btn--primary</span>
            </td>
            <td>The single most important action on a view.</td>
          </tr>
          <tr>
            <td>
              <Button variant="secondary" size="sm">
                Secondary
              </Button>
            </td>
            <td>
              <span className="mono">.btn--secondary</span>
            </td>
            <td>Common neutral actions sitting beside a primary.</td>
          </tr>
          <tr>
            <td>
              <Button variant="ghost" size="sm">
                Ghost
              </Button>
            </td>
            <td>
              <span className="mono">.btn--ghost</span>
            </td>
            <td>Low-emphasis or toolbar actions; dense rows.</td>
          </tr>
          <tr>
            <td>
              <Button variant="danger" size="sm">
                Danger
              </Button>
            </td>
            <td>
              <span className="mono">.btn--danger</span>
            </td>
            <td>Destructive, irreversible actions only.</td>
          </tr>
          <tr>
            <td>
              <Button variant="link" size="sm">
                Link
              </Button>
            </td>
            <td>
              <span className="mono">.btn--link</span>
            </td>
            <td>Inline navigation inside body text or cards.</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function IconButtonsSection() {
  const [star, setStar] = useState(false);
  return (
    <section className="section" id="icon-buttons">
      <div className="section__head">
        <div className="section__eyebrow">Components</div>
        <h2 className="section__title">Icon buttons</h2>
        <p className="section__desc">
          Square, label-free actions for toolbars and dense table rows. Always carry an{' '}
          <span className="mono">aria-label</span> and tooltip. Three emphasis levels and three
          sizes.
        </p>
      </div>
      <div className="frame">
        <div className="frame__body frame__body--col" style={{ gap: 22 }}>
          <div className="row">
            <span className="cluster-label">Emphasis</span>
            <IconButton icon="dots-three" label="More" />
            <IconButton icon="pencil-simple" label="Edit" variant="bordered" />
            <IconButton icon="plus" label="Add" variant="solid" />
            <IconButton
              icon="star"
              weight={star ? 'fill' : undefined}
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
        </div>
      </div>
    </section>
  );
}

function SplitButtonsSection() {
  return (
    <section className="section" id="split-buttons">
      <div className="section__head">
        <div className="section__eyebrow">Components</div>
        <h2 className="section__title">Buttons with additional actions</h2>
        <p className="section__desc">
          When a control has one obvious action plus secondary ones, use a split button (primary
          action + caret menu) or a menu button (the whole button opens the menu).
        </p>
      </div>
      <div className="grid grid--2">
        <div className="frame">
          <div className="frame__bar">
            <h4>Split button</h4>
            <p>primary action + caret menu</p>
          </div>
          <div className="frame__body" style={{ gap: 18 }}>
            <SplitButton variant="primary" icon="check" items={SAVE_ITEMS} onClick={() => {}}>
              Save
            </SplitButton>
            <SplitButton variant="secondary" items={MORE_ITEMS} onClick={() => {}}>
              Export
            </SplitButton>
          </div>
        </div>
        <div className="frame">
          <div className="frame__bar">
            <h4>Menu button</h4>
            <p>whole trigger opens a menu</p>
          </div>
          <div className="frame__body" style={{ gap: 18 }}>
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
          </div>
        </div>
      </div>
      <div className="callout">
        <i className="ph ph-lightbulb" />
        <span>
          The same <span className="mono">Menu</span> primitive powers split buttons, the record-row
          “⋯” menu, dropdowns, and the command palette — one keyboard model, one look.
        </span>
      </div>
    </section>
  );
}

Object.assign(window, { ButtonsSection, IconButtonsSection, SplitButtonsSection, SegToggle });
