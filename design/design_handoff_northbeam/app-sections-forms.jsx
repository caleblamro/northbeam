/* app-sections-forms.jsx — Inputs + Dropdowns */

function InputsSection() {
  const [variant, setVariant] = useState('');
  const [text, setText] = useState('Vertex Industries');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('48,000.00');
  const [card, setCard] = useState('');
  const [date, setDate] = useState('');
  const [search, setSearch] = useState('');
  const v = variant || undefined;
  const emailErr = email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  return (
    <section className="section" id="inputs">
      <div className="section__head">
        <div className="section__eyebrow">Components · variations to choose from</div>
        <h2 className="section__title">Inputs</h2>
        <p className="section__desc">
          Text, email, phone, currency, and masked fields share one wrapper — with icons, affixes,
          and validation states. Switch the field style to compare three directions.
        </p>
      </div>

      <div className="frame">
        <div className="frame__bar">
          <h4>Field style</h4>
          <p>
            {variant === ''
              ? 'Bordered with soft shadow — the dependable default.'
              : variant === 'filled'
                ? 'Filled grey wells — quiet until focused.'
                : 'Underline only — minimal, good for in-place editing.'}
          </p>
          <span className="frame__tag">
            <SegToggle
              value={variant}
              onChange={setVariant}
              options={[
                { value: '', label: 'Bordered' },
                { value: 'filled', label: 'Filled' },
                { value: 'underline', label: 'Underline' },
              ]}
            />
          </span>
        </div>
        <div
          className="frame__body frame__body--col"
          style={{ gap: 'var(--row-gap)', padding: 28 }}
        >
          <div className="grid grid--2">
            <Field label="Company name" required htmlFor="f-text">
              <TextInput
                variant={v}
                value={text}
                onChange={setText}
                leadIcon="buildings"
                placeholder="Acme Corp"
              />
            </Field>
            <Field
              label="Work email"
              required
              error={emailErr ? 'Enter a valid email address' : undefined}
              htmlFor="f-email"
            >
              <EmailInput
                variant={v}
                value={email}
                onChange={setEmail}
                state={emailErr ? 'error' : undefined}
              />
            </Field>
            <Field label="Phone" optional hint="Formats as you type">
              <PhoneInput variant={v} value={phone} onChange={setPhone} />
            </Field>
            <Field label="Deal amount" hint="Normalizes on blur">
              <CurrencyInput variant={v} value={amount} onChange={setAmount} />
            </Field>
            <Field label="Card number" hint="Masked · 4-4-4-4">
              <MaskedInput
                variant={v}
                value={card}
                onChange={setCard}
                mask="9999 9999 9999 9999"
                leadIcon="credit-card"
              />
            </Field>
            <Field label="Close date" hint="Masked · MM / DD / YYYY">
              <MaskedInput
                variant={v}
                value={date}
                onChange={setDate}
                mask="99/99/9999"
                leadIcon="calendar-blank"
                placeholder="MM/DD/YYYY"
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="subhead">States</div>
      <div className="frame">
        <div className="frame__body frame__body--col" style={{ gap: 'var(--row-gap)' }}>
          <div className="grid grid--3">
            <Field label="Default">
              <TextInput variant={v} value="" onChange={() => {}} placeholder="Placeholder" />
            </Field>
            <Field label="With value">
              <TextInput variant={v} value="Marcus Chen" onChange={() => {}} />
            </Field>
            <Field label="Focused" hint="Click to focus">
              <TextInput
                variant={v}
                value=""
                onChange={() => {}}
                placeholder="Click me"
                leadIcon="magnifying-glass"
              />
            </Field>
            <Field label="Error" error="This field is required">
              <TextInput
                variant={v}
                value=""
                onChange={() => {}}
                state="error"
                placeholder="Required"
              />
            </Field>
            <Field label="Success" success="Looks good">
              <TextInput
                variant={v}
                value="marcus@vertex.io"
                onChange={() => {}}
                state="success"
                trailIcon="check-circle"
              />
            </Field>
            <Field label="Disabled">
              <TextInput variant={v} value="Read only" onChange={() => {}} disabled />
            </Field>
          </div>
          <div className="grid grid--3">
            <Field label="Search (clearable)">
              <TextInput
                variant={v}
                value={search}
                onChange={setSearch}
                leadIcon="magnifying-glass"
                trailIcon={search ? 'x-circle' : undefined}
                onClickTrail={() => setSearch('')}
                placeholder="Search records"
              />
            </Field>
            <Field label="Password">
              <TextInput
                variant={v}
                type="password"
                value="hunter2hunter"
                onChange={() => {}}
                trailIcon="eye"
              />
            </Field>
            <Field label="Sizes" hint="sm · md · lg">
              <div className="stack" style={{ gap: 8 }}>
                <TextInput variant={v} size="sm" value="" onChange={() => {}} placeholder="Small" />
                <TextInput variant={v} size="lg" value="" onChange={() => {}} placeholder="Large" />
              </div>
            </Field>
          </div>
        </div>
      </div>
    </section>
  );
}

/* fake async record search */
const PEOPLE = [
  ['Marcus Chen', 'VP Sales · Vertex Industries'],
  ['Priya Anand', 'CTO · Lumen Labs'],
  ['Sofia Reyes', 'Procurement · Northwind'],
  ['David Okafor', 'Founder · Brightpath'],
  ['Hannah Müller', 'Ops Lead · Vertex Industries'],
  ['Liam Walsh', 'CFO · Lumen Labs'],
  ['Yuki Tanaka', 'Designer · Brightpath'],
  ['Amara Singh', 'RevOps · Northwind'],
];
function fakeLoad(q) {
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

const STATUS_OPTS = [
  { value: 'new', label: 'New', color: '#8792a2' },
  { value: 'qualified', label: 'Qualified', color: '#3d5afe' },
  { value: 'negotiation', label: 'Negotiation', color: '#9a6800' },
  { value: 'won', label: 'Closed won', color: '#117a52' },
  { value: 'lost', label: 'Closed lost', color: '#df1b41' },
];
const OWNER_OPTS = [
  { value: 'jm', label: 'Jordan Mills', sublabel: 'jordan@acme.com' },
  { value: 'ak', label: 'Aisha Khan', sublabel: 'aisha@acme.com' },
  { value: 'rt', label: 'Ravi Teja', sublabel: 'ravi@acme.com' },
];

function DropdownsSection() {
  const [status, setStatus] = useState('qualified');
  const [owner, setOwner] = useState('jm');
  const [region, setRegion] = useState('us');
  const [contact, setContact] = useState(null);
  return (
    <section className="section" id="dropdowns">
      <div className="section__head">
        <div className="section__eyebrow">Components</div>
        <h2 className="section__title">Dropdowns</h2>
        <p className="section__desc">
          Static selects for fixed option sets, and an async combobox that searches your records
          (contacts, accounts) with debounced loading — the kind you'll use everywhere mapping
          Salesforce fields.
        </p>
      </div>
      <div className="grid grid--2">
        <div className="frame">
          <div className="frame__bar">
            <h4>Static</h4>
            <p>fixed options</p>
          </div>
          <div className="frame__body frame__body--col" style={{ gap: 'var(--row-gap)' }}>
            <Field label="Deal stage">
              <Select value={status} onChange={setStatus} options={STATUS_OPTS} />
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
          </div>
        </div>
        <div className="frame">
          <div className="frame__bar">
            <h4>Async combobox</h4>
            <p>debounced search · 650ms</p>
          </div>
          <div className="frame__body frame__body--col" style={{ gap: 'var(--row-gap)' }}>
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
              <i className="ph ph-spinner-gap" />
              <span>
                Shows a loading state while fetching, an empty state with no matches, and a clear
                button once a record is chosen.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { InputsSection, DropdownsSection });
