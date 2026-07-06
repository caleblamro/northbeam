'use client';

// Input/Textarea with a {} addon that opens a Command popover of merge-field
// paths ({{record.field}}, {{vars.x}}, …) and inserts at the caret. The
// cursor-insertion technique is ported from formula-editor-panel.tsx; the
// grammar is core's flow-template {{scope.path}} syntax — dot-walk only,
// interpolated by the engine at run time, never evaluated here.

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Braces } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

/** A path offered by the picker — e.g. { path: 'record.amount',
 *  label: 'Amount', group: 'Record' }. The host builds these from org
 *  metadata + the flow's variables. */
export type MergeFieldPath = {
  path: string;
  label: string;
  group: string;
};

function MergeFieldMenu({
  paths,
  onPick,
}: {
  paths: MergeFieldPath[];
  onPick: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const byGroup = new Map<string, MergeFieldPath[]>();
    for (const p of paths) {
      const list = byGroup.get(p.group);
      if (list) list.push(p);
      else byGroup.set(p.group, [p]);
    }
    return [...byGroup.entries()];
  }, [paths]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <InputGroupButton size="icon-xs" aria-label="Insert merge field">
          <Braces />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search merge fields…" autoFocus />
          <CommandList>
            <CommandEmpty>No matching fields.</CommandEmpty>
            {groups.map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((item) => (
                  <CommandItem
                    key={item.path}
                    value={`${item.label} ${item.path}`}
                    onSelect={() => {
                      setOpen(false);
                      onPick(item.path);
                    }}
                  >
                    <span className="truncate">{item.label}</span>
                    <code className="ml-auto shrink-0 font-mono text-muted-foreground text-xs">
                      {`{{${item.path}}}`}
                    </code>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Insert at the caret, keeping focus + placing the caret after the insert
 *  (same technique as FormulaEditorPanel). */
function insertAtCaret(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
  text: string,
  onChange: (next: string) => void,
) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  onChange(value.slice(0, start) + text + value.slice(end));
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    const caret = start + text.length;
    el.setSelectionRange(caret, caret);
  });
}

export function MergeFieldInput({
  value,
  onChange,
  paths,
  placeholder,
  disabled,
  id,
  'aria-label': ariaLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  paths: MergeFieldPath[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <InputGroup className={className}>
      <InputGroupInput
        ref={inputRef}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        spellCheck={false}
      />
      <InputGroupAddon align="inline-end">
        <MergeFieldMenu
          paths={paths}
          onPick={(path) => insertAtCaret(inputRef.current, value, `{{${path}}}`, onChange)}
        />
      </InputGroupAddon>
    </InputGroup>
  );
}

export function MergeFieldTextarea({
  value,
  onChange,
  paths,
  placeholder,
  disabled,
  id,
  rows,
  'aria-label': ariaLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  paths: MergeFieldPath[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  rows?: number;
  'aria-label'?: string;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <InputGroup className={className}>
      <InputGroupTextarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        aria-label={ariaLabel}
        spellCheck={false}
      />
      <InputGroupAddon align="block-end" className="justify-end border-t">
        <MergeFieldMenu
          paths={paths}
          onPick={(path) => insertAtCaret(textareaRef.current, value, `{{${path}}}`, onChange)}
        />
      </InputGroupAddon>
    </InputGroup>
  );
}
