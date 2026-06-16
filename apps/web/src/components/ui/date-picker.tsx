'use client';

// DatePicker — Stripe/Linear-style date input.
//
// A Button trigger opens a Popover containing a shadcn Calendar. The default
// react-day-picker month/year dropdowns (which delegate to native `<select>`)
// are replaced by a custom caption that exposes:
//   - Prev / Next month chevrons
//   - A Month button → Popover with a 3×4 grid of months
//   - A Year button → Popover with a scrollable grid of years (±50 from current)
//
// `withTime` mode adds a time input below the calendar and emits `YYYY-MM-DDTHH:mm`
// strings (compatible with `<input type="datetime-local">`). Without it, the
// value is `YYYY-MM-DD`.

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/cn';
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import * as React from 'react';
import { useDayPicker } from 'react-day-picker';

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface DatePickerProps {
  value?: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  /** When true, the picker emits ISO local datetime strings and shows a time input. */
  withTime?: boolean;
  /** When true, the input takes the available width of its container. */
  fullWidth?: boolean;
  /** Optional id for the trigger button (for `<label htmlFor>`). */
  id?: string;
  /** Optional className applied to the trigger Button. */
  className?: string;
  disabled?: boolean;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function parseValue(value: string | null | undefined, withTime: boolean): Date | undefined {
  if (!value) return undefined;
  // Accept both 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:mm[:ss]' inputs.
  const [d, t = '00:00'] = value.split('T');
  const [yy, mm, dd] = d.split('-').map((s) => Number(s));
  const [hh, mi] = t.split(':').map((s) => Number(s));
  if (!yy || !mm || !dd) return undefined;
  return new Date(yy, mm - 1, dd, hh || 0, mi || 0);
}

function formatValue(date: Date, withTime: boolean): string {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (!withTime) return d;
  return `${d}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDisplay(date: Date, withTime: boolean): string {
  if (withTime) {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  withTime = false,
  fullWidth = true,
  id,
  className,
  disabled,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const date = parseValue(value, withTime);

  const handleSelect = (d: Date | undefined) => {
    if (!d) {
      onChange(null);
      return;
    }
    // Preserve current time when only the day is being changed.
    if (withTime && date) {
      d.setHours(date.getHours(), date.getMinutes(), 0, 0);
    }
    onChange(formatValue(d, withTime));
    if (!withTime) setOpen(false);
  };

  const handleTimeChange = (timeStr: string) => {
    if (!timeStr) return;
    const [hh, mi] = timeStr.split(':').map((s) => Number(s));
    const base = date ?? new Date();
    base.setHours(hh || 0, mi || 0, 0, 0);
    onChange(formatValue(base, true));
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'justify-start font-normal',
            fullWidth && 'w-full',
            !date && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="size-3.5 shrink-0" />
          <span className="flex-1 truncate text-left">
            {date ? formatDisplay(date, withTime) : placeholder}
          </span>
          {date && !disabled && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date"
              onClick={handleClear}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleClear(e as unknown as React.MouseEvent);
                }
              }}
              className="ml-1 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <span aria-hidden="true">×</span>
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" sideOffset={6}>
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          onSelect={handleSelect}
          captionLayout="label"
          components={{
            MonthCaption: GridMonthYearCaption,
          }}
        />
        {withTime && (
          <div className="flex items-center justify-between gap-2 border-border border-t px-3 py-2">
            <label
              htmlFor={`${id ?? 'datepicker'}-time`}
              className="text-muted-foreground text-xs"
            >
              Time
            </label>
            <Input
              id={`${id ?? 'datepicker'}-time`}
              type="time"
              value={date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : ''}
              onChange={(e) => handleTimeChange(e.target.value)}
              className="h-8 w-28"
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ── Calendar custom caption: chevrons + grid pickers ───────────────────── */

function GridMonthYearCaption({
  calendarMonth,
}: {
  calendarMonth: { date: Date };
}) {
  const { goToMonth } = useDayPicker();
  const date = calendarMonth.date;

  const shift = (months: number) => {
    const next = new Date(date);
    next.setMonth(date.getMonth() + months);
    goToMonth(next);
  };
  const setMonth = (m: number) => {
    const next = new Date(date);
    next.setMonth(m);
    goToMonth(next);
  };
  const setYear = (y: number) => {
    const next = new Date(date);
    next.setFullYear(y);
    goToMonth(next);
  };

  return (
    <div className="flex items-center justify-between gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Previous month"
        onClick={() => shift(-1)}
      >
        <ChevronLeft />
      </Button>
      <div className="flex items-center gap-0.5">
        <MonthPicker value={date.getMonth()} onChange={setMonth} />
        <YearPicker value={date.getFullYear()} onChange={setYear} />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Next month"
        onClick={() => shift(1)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

function MonthPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (m: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 font-medium"
          aria-label="Change month"
        >
          {MONTHS_LONG[value]}
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start" sideOffset={4}>
        <div className="grid grid-cols-3 gap-1">
          {MONTHS_SHORT.map((m, i) => (
            <Button
              key={m}
              type="button"
              variant={i === value ? 'default' : 'ghost'}
              size="sm"
              className="h-8"
              onClick={() => {
                onChange(i);
                setOpen(false);
              }}
            >
              {m}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function YearPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (y: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  // Show 50 years before and after the current value — covers 1976→2076 by
  // default; the user can scroll through the grid to find any year.
  const years = React.useMemo(
    () => Array.from({ length: 101 }, (_, i) => value - 50 + i),
    [value],
  );
  const selectedRef = React.useRef<HTMLButtonElement>(null);

  // Scroll the selected year into view when the popover opens.
  React.useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => {
        selectedRef.current?.scrollIntoView({ block: 'center' });
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 font-medium tabular-nums"
          aria-label="Change year"
        >
          {value}
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start" sideOffset={4}>
        <ScrollArea className="h-64">
          <div className="grid grid-cols-3 gap-1 pr-1">
            {years.map((y) => {
              const isSelected = y === value;
              return (
                <Button
                  key={y}
                  ref={isSelected ? selectedRef : undefined}
                  type="button"
                  variant={isSelected ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 tabular-nums"
                  onClick={() => {
                    onChange(y);
                    setOpen(false);
                  }}
                >
                  {y}
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
