// Deal-stage / record-status → muted pastel chip tones (Meetalo-style).
// CSS-var driven so tones follow the theme.

export type Tone = { label: string; fg: string; bg: string };

export type DealStage = 'new' | 'qualified' | 'negotiation' | 'won' | 'lost';

export const DEAL_STAGE_TONE: Record<DealStage, Tone> = {
  new: { label: 'New', fg: 'var(--lilac)', bg: 'var(--lilac-bg)' },
  qualified: { label: 'Qualified', fg: 'var(--info)', bg: 'var(--info-bg)' },
  negotiation: { label: 'Negotiation', fg: 'var(--warning)', bg: 'var(--warning-bg)' },
  won: { label: 'Closed won', fg: 'var(--success)', bg: 'var(--success-bg)' },
  lost: { label: 'Closed lost', fg: 'var(--danger)', bg: 'var(--danger-bg)' },
};

export const DEAL_STAGE_OPTIONS = (Object.keys(DEAL_STAGE_TONE) as DealStage[]).map((value) => ({
  value,
  label: DEAL_STAGE_TONE[value].label,
  color: DEAL_STAGE_TONE[value].fg,
}));
