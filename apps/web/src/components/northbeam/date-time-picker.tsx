'use client';

// DateTimePicker — single input + single popover. The input box is typeable
// (accepts ISO, locale text, and "YYYY-MM-DD HH:MM" forms) and displays the
// formatted local datetime when not focused. The popover anchors a calendar
// + a compact time control so the user never sees two inputs side-by-side.
// Value is stored as ISO 8601 UTC; display + edits happen in the browser's
// local timezone.

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { CalendarIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DateTimePickerProps {
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Show the "(local time)" hint below the input. Default true. */
  showTimezoneHint?: boolean;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function parseLooseDateTime(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Accept "YYYY-MM-DD HH:MM" as well as ISO with the 'T' separator.
  const normalized = trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/, '$1T$2');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDisplay(d: Date): string {
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isoToDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function partsFromDate(d: Date): { time: string } {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return { time: `${hh}:${mm}` };
}

function combineLocalDateTime(date: Date, time: string): Date | null {
  const m = HHMM.exec(time);
  if (!m) return null;
  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = m[2] ? Number(m[2]) : 0;
  const out = new Date(date);
  out.setHours(hours, minutes, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  disabled,
  className,
  id,
  showTimezoneHint = true,
}: DateTimePickerProps) {
  const date = isoToDate(value);

  // Text shown in the input. When the input is focused we let the user edit
  // freely; on blur we either parse + emit, or revert to the canonical
  // formatted display.
  const [text, setText] = useState(date ? formatDisplay(date) : '');
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);

  // Time field inside the popover. Stays in sync with the current value while
  // the popover is closed; while open, it's owned by the popover.
  const [popoverTime, setPopoverTime] = useState<string>(date ? partsFromDate(date).time : '09:00');

  useEffect(() => {
    if (focused) return;
    setText(date ? formatDisplay(date) : '');
    if (date) setPopoverTime(partsFromDate(date).time);
  }, [date, focused]);

  const commitText = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      onChange(null);
      return;
    }
    const parsed = parseLooseDateTime(trimmed);
    if (!parsed) {
      setText(date ? formatDisplay(date) : '');
      return;
    }
    onChange(parsed.toISOString());
  };

  const commitFromCalendar = (picked: Date) => {
    const combined = combineLocalDateTime(picked, popoverTime);
    if (combined) onChange(combined.toISOString());
  };

  const commitFromTimeChange = (next: string) => {
    setPopoverTime(next);
    if (!date) return;
    const combined = combineLocalDateTime(date, next);
    if (combined) onChange(combined.toISOString());
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <div className="relative">
          <Input
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              commitText();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            className="pr-16"
          />
          {value && !disabled && (
            <button
              type="button"
              aria-label="Clear"
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
          <div className="flex flex-col">
            <Calendar
              mode="single"
              selected={date ?? undefined}
              onSelect={(d) => d && commitFromCalendar(d)}
              captionLayout="dropdown"
            />
            <div className="flex items-center gap-2 border-t px-3 py-2.5">
              <span className="text-muted-foreground text-xs">Time</span>
              <Input
                type="time"
                value={popoverTime}
                onChange={(e) => commitFromTimeChange(e.target.value)}
                className="h-8 w-28 tabular-nums"
                aria-label="Time"
              />
              <div className="flex-1" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const now = new Date();
                  setPopoverTime(partsFromDate(now).time);
                  onChange(now.toISOString());
                }}
              >
                Now
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {showTimezoneHint && (
        <p className="text-[10px] text-muted-foreground">
          {Intl.DateTimeFormat().resolvedOptions().timeZone} (local time)
        </p>
      )}
    </div>
  );
}
