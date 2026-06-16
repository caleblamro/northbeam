'use client';

// AddressInput — Mapbox Search Box autocomplete + manual fallback. Storage
// is JSONB matching the AddressValue shape (line1/line2/city/region/postal
// _code/country/formatted/coordinates/mapbox_id). The autocomplete is
// optional: if NEXT_PUBLIC_MAPBOX_TOKEN is missing or empty, we silently
// fall back to manual-only entry — never crash, never block input.

import { Field } from '@/components/northbeam/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import type { AddressValue } from '@northbeam/db/field-types';
import { Loader2, MapPin, Pencil, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface AddressInputProps {
  value: AddressValue | null;
  onChange: (next: AddressValue | null) => void;
  /** Limit Mapbox suggestions to one or more ISO 3166-1 alpha-2 codes. */
  countries?: string[];
  disabled?: boolean;
  className?: string;
}

type MapboxSuggestion = {
  name: string;
  mapbox_id: string;
  full_address?: string;
  place_formatted?: string;
};

type MapboxFeature = {
  geometry?: { coordinates?: [number, number] };
  properties: {
    name?: string;
    full_address?: string;
    place_formatted?: string;
    coordinates?: { latitude: number; longitude: number };
    mapbox_id?: string;
    context?: {
      address?: { name?: string };
      place?: { name?: string };
      region?: { name?: string; region_code?: string };
      postcode?: { name?: string };
      country?: { name?: string; country_code?: string };
    };
  };
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
const MAPBOX_BASE = 'https://api.mapbox.com/search/searchbox/v1';

function normalizeFeature(f: MapboxFeature): AddressValue {
  const p = f.properties;
  const ctx = p.context ?? {};
  return {
    line1: ctx.address?.name ?? p.name ?? undefined,
    city: ctx.place?.name,
    region: ctx.region?.region_code ?? ctx.region?.name,
    postal_code: ctx.postcode?.name,
    country: ctx.country?.country_code,
    formatted: p.full_address ?? p.place_formatted,
    coordinates: p.coordinates
      ? { lat: p.coordinates.latitude, lng: p.coordinates.longitude }
      : undefined,
    mapbox_id: p.mapbox_id,
  };
}

async function suggest(
  q: string,
  sessionToken: string,
  countries?: string[],
): Promise<MapboxSuggestion[]> {
  if (!MAPBOX_TOKEN || !q.trim()) return [];
  const url = new URL(`${MAPBOX_BASE}/suggest`);
  url.searchParams.set('q', q);
  url.searchParams.set('access_token', MAPBOX_TOKEN);
  url.searchParams.set('session_token', sessionToken);
  url.searchParams.set('types', 'address');
  url.searchParams.set('limit', '6');
  if (countries?.length) url.searchParams.set('country', countries.join(',').toLowerCase());
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { suggestions?: MapboxSuggestion[] };
  return data.suggestions ?? [];
}

async function retrieve(mapboxId: string, sessionToken: string): Promise<AddressValue | null> {
  if (!MAPBOX_TOKEN) return null;
  const url = new URL(`${MAPBOX_BASE}/retrieve/${mapboxId}`);
  url.searchParams.set('access_token', MAPBOX_TOKEN);
  url.searchParams.set('session_token', sessionToken);
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { features?: MapboxFeature[] };
  const f = data.features?.[0];
  return f ? normalizeFeature(f) : null;
}

function hasAnyAddressData(v: AddressValue | null): boolean {
  if (!v) return false;
  return Boolean(
    v.line1 || v.line2 || v.city || v.region || v.postal_code || v.country || v.formatted,
  );
}

export function AddressInput({
  value,
  onChange,
  countries,
  disabled,
  className,
}: AddressInputProps) {
  const tokenAvailable = Boolean(MAPBOX_TOKEN);
  const hasData = hasAnyAddressData(value);

  // Mode toggles between Mapbox autocomplete and the manual form. Default to
  // search when the field is empty and the token is wired; otherwise manual.
  const [mode, setMode] = useState<'search' | 'manual'>(
    tokenAvailable && !hasData ? 'search' : 'manual',
  );

  // Bias toward search → manual once any data lands, so the user can refine.
  useEffect(() => {
    if (hasData && mode === 'search') setMode('manual');
  }, [hasData, mode]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {mode === 'search' && tokenAvailable ? (
        <AddressSearch
          countries={countries}
          disabled={disabled}
          onPick={(addr) => {
            onChange(addr);
            setMode('manual');
          }}
          onManual={() => setMode('manual')}
        />
      ) : (
        <AddressManual
          value={value}
          onChange={onChange}
          disabled={disabled}
          onSwitchToSearch={
            tokenAvailable ? () => setMode('search') : undefined
          }
        />
      )}
    </div>
  );
}

/* ── Autocomplete dropdown ──────────────────────────────────────────────── */

function AddressSearch({
  countries,
  disabled,
  onPick,
  onManual,
}: {
  countries?: string[];
  disabled?: boolean;
  onPick: (addr: AddressValue) => void;
  onManual: () => void;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<MapboxSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  // Mapbox sessions reduce billing — one token covers the suggest→retrieve
  // pair for this input's lifetime.
  const sessionToken = useMemo(() => crypto.randomUUID(), []);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await suggest(query, sessionToken, countries);
        if (!ac.signal.aborted) setSuggestions(list);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(handle);
      ac.abort();
    };
  }, [query, sessionToken, countries]);

  const pick = async (s: MapboxSuggestion) => {
    setRetrieving(true);
    const addr = await retrieve(s.mapbox_id, sessionToken).catch(() => null);
    setRetrieving(false);
    if (addr) onPick(addr);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search an address…"
          disabled={disabled || retrieving}
          className="pl-8"
        />
        {(loading || retrieving) && (
          <Loader2 className="-translate-y-1/2 absolute top-1/2 right-2.5 size-4 animate-spin text-muted-foreground" />
        )}
      </div>
      {suggestions.length > 0 && (
        <ul className="rounded-md border bg-popover shadow-sm">
          {suggestions.map((s) => (
            <li key={s.mapbox_id}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => pick(s)}
                disabled={retrieving}
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block font-medium">{s.name}</span>
                  {(s.full_address || s.place_formatted) && (
                    <span className="block truncate text-muted-foreground text-xs">
                      {s.full_address ?? s.place_formatted}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="self-start text-muted-foreground text-xs hover:text-foreground"
        onClick={onManual}
      >
        <Pencil className="mr-1 inline size-3" />
        Enter manually
      </button>
    </div>
  );
}

/* ── Manual fields ──────────────────────────────────────────────────────── */

function AddressManual({
  value,
  onChange,
  disabled,
  onSwitchToSearch,
}: {
  value: AddressValue | null;
  onChange: (next: AddressValue | null) => void;
  disabled?: boolean;
  onSwitchToSearch?: () => void;
}) {
  const id = useId();
  const v = value ?? {};
  const update = (patch: Partial<AddressValue>) => {
    const next: AddressValue = { ...v, ...patch };
    // Drop empty strings so the JSONB stays tidy.
    for (const k of Object.keys(next) as (keyof AddressValue)[]) {
      if (next[k] === '') delete next[k];
    }
    onChange(hasAnyAddressData(next) ? next : null);
  };

  return (
    <div className="grid gap-2 sm:grid-cols-6">
      <div className="sm:col-span-6">
        <Field label="Street" htmlFor={`${id}-line1`}>
          <Input
            id={`${id}-line1`}
            value={v.line1 ?? ''}
            onChange={(e) => update({ line1: e.target.value })}
            placeholder="123 Main St"
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="sm:col-span-6">
        <Field label="Apt, suite, etc." htmlFor={`${id}-line2`} optional>
          <Input
            id={`${id}-line2`}
            value={v.line2 ?? ''}
            onChange={(e) => update({ line2: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="sm:col-span-3">
        <Field label="City" htmlFor={`${id}-city`}>
          <Input
            id={`${id}-city`}
            value={v.city ?? ''}
            onChange={(e) => update({ city: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="State / region" htmlFor={`${id}-region`}>
          <Input
            id={`${id}-region`}
            value={v.region ?? ''}
            onChange={(e) => update({ region: e.target.value })}
            placeholder="CA"
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="sm:col-span-1">
        <Field label="ZIP" htmlFor={`${id}-postal`}>
          <Input
            id={`${id}-postal`}
            value={v.postal_code ?? ''}
            onChange={(e) => update({ postal_code: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="sm:col-span-6">
        <Field label="Country" htmlFor={`${id}-country`}>
          <Input
            id={`${id}-country`}
            value={v.country ?? ''}
            onChange={(e) => update({ country: e.target.value.toUpperCase() })}
            placeholder="US"
            maxLength={2}
            disabled={disabled}
            className="w-20 tabular-nums"
          />
        </Field>
      </div>
      {onSwitchToSearch && (
        <div className="sm:col-span-6">
          <button
            type="button"
            className="text-muted-foreground text-xs hover:text-foreground"
            onClick={onSwitchToSearch}
          >
            <Search className="mr-1 inline size-3" />
            Search instead
          </button>
        </div>
      )}
    </div>
  );
}

/** Single-line display for the read view. Falls back to a join of available
 *  parts when no `formatted` was stored. */
export function formatAddressOneLine(v: AddressValue | null | undefined): string {
  if (!v) return '';
  if (v.formatted) return v.formatted;
  return [v.line1, v.line2, v.city, v.region, v.postal_code, v.country]
    .filter(Boolean)
    .join(', ');
}
