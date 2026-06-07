// Single source of truth for deal-stage / record-status → color mapping.
// CSS-var driven so tones follow the active theme + accent (brink convention).

export type Tone = { label: string; color: string; badge: string };

export type DealStage = 'new' | 'qualified' | 'negotiation' | 'won' | 'lost';

export const DEAL_STAGE_TONE: Record<DealStage, Tone> = {
  new: { label: 'New', color: 'var(--ink-subtle)', badge: 'badge' },
  qualified: { label: 'Qualified', color: 'var(--info)', badge: 'badge--brand' },
  negotiation: { label: 'Negotiation', color: 'var(--warning)', badge: 'badge--warning' },
  won: { label: 'Closed won', color: 'var(--success)', badge: 'badge--success' },
  lost: { label: 'Closed lost', color: 'var(--danger)', badge: 'badge--danger' },
};

// Option list shape used by the Select/Combobox demos.
export const DEAL_STAGE_OPTIONS = (Object.keys(DEAL_STAGE_TONE) as DealStage[]).map((value) => ({
  value,
  label: DEAL_STAGE_TONE[value].label,
  color: DEAL_STAGE_TONE[value].color,
}));
