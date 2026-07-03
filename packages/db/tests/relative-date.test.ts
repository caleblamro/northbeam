// resolveRelativeDate is the single implementation both the SQL builder and
// the web matcher share — every token resolves against a FIXED `now` here so
// the grammar can't drift silently.

import { describe, expect, it } from 'vitest';
import {
  RELATIVE_DATE_PRESETS,
  isRelativeDateToken,
  relativeDateLabel,
  resolveRelativeDate,
} from '../src/relative-date.js';

// Wednesday 2026-07-15T17:30:00Z — mid-week, mid-month, Q3.
const NOW = new Date('2026-07-15T17:30:00.000Z');

const iso = (token: string) => resolveRelativeDate(token, NOW)?.toISOString();

describe('resolveRelativeDate', () => {
  it('resolves anchors', () => {
    expect(iso('@today')).toBe('2026-07-15T00:00:00.000Z');
    expect(iso('@startOfWeek')).toBe('2026-07-13T00:00:00.000Z'); // Monday
    expect(iso('@startOfMonth')).toBe('2026-07-01T00:00:00.000Z');
    expect(iso('@startOfQuarter')).toBe('2026-07-01T00:00:00.000Z');
    expect(iso('@startOfYear')).toBe('2026-01-01T00:00:00.000Z');
  });

  it('startOfWeek treats Sunday as end of the ISO week', () => {
    const sunday = new Date('2026-07-19T08:00:00.000Z');
    expect(resolveRelativeDate('@startOfWeek', sunday)?.toISOString()).toBe(
      '2026-07-13T00:00:00.000Z',
    );
  });

  it('resolves day/week offsets from the start of today', () => {
    expect(iso('@-30d')).toBe('2026-06-15T00:00:00.000Z');
    expect(iso('@-7d')).toBe('2026-07-08T00:00:00.000Z');
    expect(iso('@+7d')).toBe('2026-07-22T00:00:00.000Z');
    expect(iso('@-2w')).toBe('2026-07-01T00:00:00.000Z');
  });

  it('resolves month/quarter/year offsets', () => {
    expect(iso('@-1m')).toBe('2026-06-15T00:00:00.000Z');
    expect(iso('@-1q')).toBe('2026-04-15T00:00:00.000Z');
    expect(iso('@-1y')).toBe('2025-07-15T00:00:00.000Z');
  });

  it('clamps month-ish offsets so they never skid into the next month', () => {
    const jan31 = new Date('2026-01-31T12:00:00.000Z');
    // Jan 31 − 1m would be "Feb 31" without clamping; the grammar clamps the
    // day-of-month to 28 for m/q offsets.
    expect(resolveRelativeDate('@-1m', jan31)?.toISOString()).toBe('2025-12-28T00:00:00.000Z');
  });

  it('rejects garbage', () => {
    for (const bad of ['@yesterday', '@-30x', '@30d', '@--3d', 'today', '', '@']) {
      expect(resolveRelativeDate(bad, NOW)).toBeNull();
    }
  });

  it('every curated preset resolves', () => {
    for (const p of RELATIVE_DATE_PRESETS) {
      expect(resolveRelativeDate(p.token, NOW), p.token).not.toBeNull();
    }
  });
});

describe('token helpers', () => {
  it('isRelativeDateToken is a one-char sniff', () => {
    expect(isRelativeDateToken('@today')).toBe(true);
    expect(isRelativeDateToken('2026-01-01')).toBe(false);
    expect(isRelativeDateToken(42)).toBe(false);
    expect(isRelativeDateToken(null)).toBe(false);
  });

  it('relativeDateLabel prefers preset labels, falls back to the token', () => {
    expect(relativeDateLabel('@-30d')).toBe('Last 30 days');
    expect(relativeDateLabel('@-14d')).toBe('@-14d');
    expect(relativeDateLabel('2026-01-01')).toBeNull();
  });
});
