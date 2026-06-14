'use client';

// DurationInput — text input that accepts loose duration syntax ("1h3m",
// "90m", "2:30", "1.5h", "150") and stores integer minutes. Validates on
// every keystroke: an unparseable non-empty value shows a red border and an
// inline message explaining the accepted forms. On blur the canonical
// "1h 30m" form replaces the user's text so they see exactly what was saved.

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { formatDurationMinutes, parseDurationMinutes } from '@northbeam/db/field-types';
import { AlertCircle } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

interface DurationInputProps {
  value: number | null;
  onChange: (next: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  maxMinutes?: number;
}

const HINT = 'Try 1h 30m, 90m, 1:30, or 90.';

export function DurationInput({
  value,
  onChange,
  placeholder = 'e.g. 1h 30m',
  disabled,
  className,
  id,
  maxMinutes,
}: DurationInputProps) {
  const reactId = useId();
  const errorId = `${id ?? reactId}-error`;
  const [text, setText] = useState(formatDurationMinutes(value));
  const [error, setError] = useState<string | null>(null);

  // External value → refresh canonical text + clear any stale error state.
  useEffect(() => {
    setText(formatDurationMinutes(value));
    setError(null);
  }, [value]);

  const validate = (raw: string): { ok: boolean; minutes: number | null; message: string | null } => {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, minutes: null, message: null };
    const parsed = parseDurationMinutes(trimmed);
    if (parsed == null) return { ok: false, minutes: null, message: HINT };
    if (maxMinutes && parsed > maxMinutes) {
      return {
        ok: false,
        minutes: null,
        message: `Maximum is ${formatDurationMinutes(maxMinutes)}.`,
      };
    }
    return { ok: true, minutes: parsed, message: null };
  };

  const onTextChange = (next: string) => {
    setText(next);
    // Live validation, but only after the user starts typing — don't flash
    // an error on an empty initial value.
    const { ok, message } = validate(next);
    setError(ok ? null : message);
  };

  const commit = () => {
    const { ok, minutes, message } = validate(text);
    if (!ok) {
      // Bad input stays in the box so the user can fix it. The error caption
      // is already showing.
      setError(message);
      return;
    }
    onChange(minutes);
    setText(formatDurationMinutes(minutes));
    setError(null);
  };

  const invalid = error != null;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Input
        id={id}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'tabular-nums',
          invalid && 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30',
        )}
        inputMode="text"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
      />
      {invalid && (
        <p id={errorId} className="flex items-center gap-1 text-destructive text-xs">
          <AlertCircle className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}
