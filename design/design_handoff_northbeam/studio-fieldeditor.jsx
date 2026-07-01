/* studio-fieldeditor.jsx — right drawer to create/edit a field */

function inferType(label) {
  const t = label.toLowerCase();
  if (/date|when|deadline|renew|expir/.test(t)) return 'date';
  if (/score|health|risk|likelihood|sentiment|predict/.test(t)) return 'ai';
  if (/amount|arr|revenue|price|cost|\$|dollar|value/.test(t)) return 'currency';
  if (/percent|rate|%/.test(t)) return 'percent';
  if (/email/.test(t)) return 'email';
  if (/phone|mobile/.test(t)) return 'phone';
  if (/owner|rep|user|assigned/.test(t)) return 'user';
  if (/account|contact|company|champion|competitor/.test(t)) return 'lookup';
  if (/stage|status|type|category|source|tier/.test(t)) return 'picklist';
  return 'text';
}
function toApi(label, source) {
  const base = label
    .trim()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_|_$/g, '');
  return (base || 'New_Field') + (source === 'salesforce' ? '' : '__c');
}

function FieldEditor({ open, intent, seed, onClose }) {
  const [step, setStep] = useState('type');
  const [type, setType] = useState('text');
  const [label, setLabel] = useState('');
  const [api, setApi] = useState('');
  const [desc, setDesc] = useState('');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState(['Option A', 'Option B']);
  const [related, setRelated] = useState('account');
  const [formula, setFormula] = useState('');
  const [fdesc, setFdesc] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');

  useEffect(() => {
    if (!open) return;
    const f = seed || {};
    if (intent === 'edit' && f.id) {
      setStep('config');
      setType(f.type);
      setLabel(f.label);
      setApi(f.api);
      setDesc(f.desc || '');
      setRequired(!!f.required);
      setOptions(f.options || ['Option A', 'Option B']);
      setFormula(f.formula || '');
      setAiNote('');
    } else if (intent === 'describe' || intent === 'suggest') {
      const lab = (f.label || '').replace(/^create.*field:\s*/i, '').trim() || 'New field';
      const ty = f.type || inferType(lab);
      setStep('config');
      setType(ty);
      setLabel(lab.charAt(0).toUpperCase() + lab.slice(1));
      setApi(toApi(lab, 'native'));
      setDesc(f.reason || '');
      setRequired(false);
      setFormula('');
      setAiNote(`Copilot read “${lab}” as a ${typeMeta(ty).label} field. Adjust anything below.`);
    } else if (intent === 'formula') {
      setStep('config');
      setType('formula');
      setLabel('');
      setApi('');
      setDesc('');
      setFormula('');
      setAiNote('');
    } else {
      setStep('type');
      setType('text');
      setLabel('');
      setApi('');
      setDesc('');
      setRequired(false);
      setFormula('');
      setAiNote('');
    }
  }, [open, intent, seed]);

  if (!open) return null;
  const groups = [...new Set(window.STUDIO.FIELD_TYPES.map((t) => t.group))];
  const pickType = (t) => {
    setType(t);
    setStep('config');
    if (!label) setApi(toApi('New field', 'native'));
  };
  const onLabel = (v) => {
    setLabel(v);
    setApi(toApi(v, 'native'));
  };

  const genFormula = () => {
    setGenBusy(true);
    setTimeout(() => {
      const t = fdesc.toLowerCase();
      let f = 'TODAY() - DATEVALUE(CreatedDate)';
      if (/win|probab/.test(t)) f = 'IF(ISPICKVAL(Stage,"Closed Won"), 1, Probability / 100)';
      else if (/days.*stage|stage.*days/.test(t)) f = 'TODAY() - Stage_Entered__c';
      else if (/discount/.test(t)) f = '(List_Price__c - Amount) / List_Price__c';
      else if (/expected|weighted/.test(t)) f = 'Amount * (Probability / 100)';
      setFormula(f);
      setGenBusy(false);
    }, 1000);
  };

  return (
    <div
      className="drawer-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer">
        <div className="drawer__head">
          {step === 'config' && intent !== 'edit' && (
            <IconButton icon="arrow-left" label="Back to types" onClick={() => setStep('type')} />
          )}
          <div style={{ flex: 1 }}>
            <h2>
              {intent === 'edit'
                ? `Edit ${seed.label}`
                : step === 'type'
                  ? 'Add a field'
                  : `New ${typeMeta(type).label} field`}
            </h2>
            <p>
              {step === 'type'
                ? 'Choose what kind of data this field holds'
                : 'Configure the field, then save'}
            </p>
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>

        <div className="drawer__body ds-scroll">
          {step === 'type' ? (
            <React.Fragment>
              <div className="input-wrap" style={{ borderColor: 'var(--ai-border)' }}>
                <span className="input-wrap__icon">
                  <i className="ph ph-sparkle ai-spark" />
                </span>
                <input
                  placeholder="Or describe it: “health score from 0 to 100”"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      const v = e.target.value;
                      setType(inferType(v));
                      onLabel(v.charAt(0).toUpperCase() + v.slice(1));
                      setAiNote(`Copilot read “${v}” as a ${typeMeta(inferType(v)).label} field.`);
                      setStep('config');
                    }
                  }}
                />
              </div>
              {groups.map((g) => (
                <div key={g}>
                  <div className="tp-group-label">{g}</div>
                  <div className="tp-grid">
                    {window.STUDIO.FIELD_TYPES.filter((t) => t.group === g).map((t) => (
                      <button
                        key={t.id}
                        className="tp-card"
                        data-ai={t.group === 'AI' ? 'true' : undefined}
                        onClick={() => pickType(t.id)}
                      >
                        <span className="tp-card__ic">
                          <i className={`ph ph-${t.icon}`} />
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <b>{t.label}</b>
                          <small>{t.desc}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </React.Fragment>
          ) : (
            <React.Fragment>
              {aiNote && (
                <div className="ai-panel" style={{ padding: '11px 14px' }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: 9,
                      alignItems: 'center',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--ink-secondary)',
                    }}
                  >
                    <i className="ph ph-sparkle ai-spark" />
                    {aiNote}
                  </div>
                </div>
              )}

              <button
                className="tp-card"
                data-active="true"
                style={{ cursor: 'default' }}
                data-ai={type === 'ai' ? 'true' : undefined}
              >
                <span className="tp-card__ic">
                  <i className={`ph ph-${typeMeta(type).icon}`} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <b>{typeMeta(type).label}</b>
                  <small>{typeMeta(type).desc}</small>
                </span>
                {intent !== 'edit' && (
                  <button
                    className="btn btn--link btn--sm"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => setStep('type')}
                  >
                    Change
                  </button>
                )}
              </button>

              <Field label="Field label" required>
                <TextInput value={label} onChange={onLabel} placeholder="e.g. Renewal Date" />
              </Field>
              <Field label="API name" hint="Used in formulas, automations, and the API">
                <TextInput value={api} onChange={setApi} leadIcon="code" />
              </Field>
              <Field label="Description" optional>
                <textarea
                  className="bare"
                  rows={2}
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="Help text shown to users"
                />
              </Field>

              {(type === 'picklist' || type === 'multipicklist') && (
                <Field label="Choices">
                  <div className="stack" style={{ gap: 8 }}>
                    {options.map((o, i) => (
                      <div key={i} className="row row--tight" style={{ flexWrap: 'nowrap' }}>
                        <div className="input-wrap" style={{ flex: 1 }}>
                          <input
                            value={o}
                            onChange={(e) =>
                              setOptions(options.map((x, j) => (j === i ? e.target.value : x)))
                            }
                          />
                        </div>
                        <IconButton
                          icon="x"
                          label="Remove"
                          onClick={() => setOptions(options.filter((_, j) => j !== i))}
                        />
                      </div>
                    ))}
                    <div className="row" style={{ gap: 8 }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="plus"
                        onClick={() => setOptions([...options, 'New option'])}
                      >
                        Add choice
                      </Button>
                      <button
                        className="chip-ai"
                        onClick={() =>
                          setOptions(['Inbound', 'Outbound', 'Referral', 'Partner', 'Event'])
                        }
                      >
                        <i className="ph ph-sparkle" />
                        Suggest values
                      </button>
                    </div>
                  </div>
                </Field>
              )}

              {(type === 'lookup' || type === 'masterdetail') && (
                <Field label="Related object" hint="Records will link to this object">
                  <Select
                    value={related}
                    onChange={setRelated}
                    options={window.STUDIO.OBJECTS.map((o) => ({
                      value: o.id,
                      label: o.plural,
                      icon: o.icon,
                    }))}
                    leadIcon="tree-structure"
                  />
                </Field>
              )}

              {type === 'formula' && (
                <Field label="Formula" hint="Returns a computed value on every record">
                  <div
                    className="input-wrap"
                    style={{ borderColor: 'var(--ai-border)', marginBottom: 8 }}
                  >
                    <span className="input-wrap__icon">
                      <i className="ph ph-sparkle ai-spark" />
                    </span>
                    <input
                      placeholder="Describe it: “days a deal has sat in its stage”"
                      value={fdesc}
                      onChange={(e) => setFdesc(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') genFormula();
                      }}
                    />
                    <Button size="sm" variant="primary" loading={genBusy} onClick={genFormula}>
                      Generate
                    </Button>
                  </div>
                  <textarea
                    className="bare"
                    rows={3}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
                    value={formula}
                    onChange={(e) => setFormula(e.target.value)}
                    placeholder="Amount * (Probability / 100)"
                  />
                </Field>
              )}

              {type === 'ai' && (
                <React.Fragment>
                  <Field
                    label="What should the AI compute?"
                    hint="Plain-English instruction, evaluated per record"
                  >
                    <textarea
                      className="bare"
                      rows={3}
                      defaultValue={
                        desc ||
                        'Score 0–100 for how likely this deal is to close, using stage, age, activity, and amount vs. similar won deals.'
                      }
                    />
                  </Field>
                  <div className="row" style={{ gap: 12 }}>
                    <Field label="Output" style={{ flex: 1 }}>
                      <Select
                        value="num"
                        onChange={() => {}}
                        options={[
                          { value: 'num', label: 'Number (0–100)' },
                          { value: 'cat', label: 'Category' },
                          { value: 'text', label: 'Text summary' },
                        ]}
                      />
                    </Field>
                    <Field label="Recompute" style={{ flex: 1 }}>
                      <Select
                        value="hourly"
                        onChange={() => {}}
                        options={[
                          { value: 'live', label: 'On every change' },
                          { value: 'hourly', label: 'Hourly' },
                          { value: 'daily', label: 'Daily' },
                        ]}
                      />
                    </Field>
                  </div>
                </React.Fragment>
              )}

              <label
                className="ai-sugg"
                style={{ cursor: 'pointer', alignItems: 'center' }}
                onClick={() => setRequired(!required)}
              >
                <span
                  className="ai-sugg__ic"
                  style={{
                    background: 'var(--surface-sunken)',
                    color: required ? 'var(--brand)' : 'var(--ink-subtle)',
                  }}
                >
                  <i className={`ph ph-${required ? 'check-square' : 'square'}`} />
                </span>
                <div className="ai-sugg__body">
                  <b>Required</b>
                  <p>Records can't be saved without this field.</p>
                </div>
              </label>
            </React.Fragment>
          )}
        </div>

        {step === 'config' && (
          <div className="drawer__foot">
            <Prov source={intent === 'edit' ? seed.source : type === 'ai' ? 'ai' : 'native'} />
            <div className="spacer" />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" onClick={onClose}>
              {intent === 'edit' ? 'Save changes' : 'Create field'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { FieldEditor });
