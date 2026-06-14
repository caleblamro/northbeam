'use client';

// DatePicker — single-date input with a calendar popover and manual ISO text
// entry. Value is an ISO date string (YYYY-MM-DD) with no time / tz — date is
// a calendar-day concept, not a moment.

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { CalendarIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DatePickerProps {
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toDate(iso: string | null): Date | undefined {
  if (!iso || !ISO_DATE.test(iso)) return undefined;
  // Construct in local time at midnight — calendar selection works against
  // local days regardless of where the user is.
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatLong(iso: string | null): string {
  const date = toDate(iso);
  if (!date) return iso ?? '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  disabled,
  className,
  id,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? '');

  // Keep the visible text in sync when the controlled value changes from
  // outside the component (calendar pick, form reset, etc.).
  useEffect(() => {
    setText(value ?? '');
  }, [value]);

  const commitText = () => {
    const t = text.trim();
    if (!t) {
      onChange(null);
      return;
    }
    // Accept ISO directly; for everything else, fall back to Date parsing
    // (handles "Jun 14, 2026", "6/14/2026", etc.).
    if (ISO_DATE.test(t)) {
      onChange(t);
      return;
    }
    const parsed = new Date(t);
    if (Number.isNaN(parsed.getTime())) {
      // Revert to last good value rather than emit garbage.
      setText(value ?? '');
      return;
    }
    onChange(toIso(parsed));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('relative flex items-center', className)}>
        <Input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitText();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-16"
        />
        {value && !disabled && (
          <button
            type="button"
            aria-label="Clear date"
            className="-translate-y-1/2 absolute top-1/2 right-9 text-muted-foreground hover:text-foreground"
            onClick={() => onChange(null)}
          >
            <X className="size-4" />
          </button>
        )}
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Open calendar"
            disabled={disabled}
            className="-translate-y-1/2 absolute top-1/2 right-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <CalendarIcon className="size-4" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={toDate(value)}
          onSelect={(d) => {
            if (d) {
              onChange(toIso(d));
              setOpen(false);
            }
          }}
          captionLayout="dropdown"
        />
      </PopoverContent>
    </Popover>
  );
}

export { formatLong as formatLongDate };
