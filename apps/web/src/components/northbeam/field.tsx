// Form-field wrapper that composes DiceUI Label + input slot + supporting hints.
// Three Directus-style hint slots, each surfacing different intent:
//
//   - `helpText`  — small (i) info icon next to the label. Tooltip on hover/focus.
//                   Use for short, "what is this for" guidance.
//   - `description` — muted line BELOW the input. Use for an extended explanation
//                     the user should read while filling the form in.
//   - `error` / `success` — validation state below the input. Override `description`
//                           when present (errors take precedence over both).

'use client';

import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';

export function Field({
  label,
  required,
  optional,
  helpText,
  description,
  error,
  success,
  htmlFor,
  className,
  children,
}: {
  label?: string;
  required?: boolean;
  optional?: boolean;
  /** Short tooltip text rendered behind an (i) icon next to the label. */
  helpText?: ReactNode;
  /** Longer explanation rendered as muted text below the input. */
  description?: ReactNode;
  error?: ReactNode;
  success?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <Label htmlFor={htmlFor} className="flex items-center gap-1.5">
          <span>{label}</span>
          {required && <span className="text-destructive">*</span>}
          {optional && <span className="text-muted-foreground text-xs">optional</span>}
          {helpText && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="More info"
                  className="text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{helpText}</TooltipContent>
            </Tooltip>
          )}
        </Label>
      )}
      {children}
      {error ? (
        <p className="flex items-center gap-1.5 text-destructive text-xs">
          <AlertCircle className="size-3.5" />
          {error}
        </p>
      ) : success ? (
        <p className="flex items-center gap-1.5 text-green-600 text-xs">
          <CheckCircle2 className="size-3.5" />
          {success}
        </p>
      ) : description ? (
        <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
      ) : null}
    </div>
  );
}
