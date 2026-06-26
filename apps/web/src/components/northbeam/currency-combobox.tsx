'use client';

// CurrencyCombobox — picker for an ISO 4217 currency code. Compose with an
// amount input to form a full currency control (see field-render currency
// case). Used standalone in the field-config editor (#15) and the workspace
// "default currency" setting (#16). The list of currencies is curated — the
// 40 most-common codes — so the dropdown stays usable. Pass `currencies` to
// override.

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';

export type CurrencyDef = {
  code: string;
  label: string;
  symbol: string;
};

// Top ~40 ISO 4217 codes by transaction volume + most-used in SF orgs. Extend
// as needed; the picker copes with a much larger list because it filters.
export const COMMON_CURRENCIES: CurrencyDef[] = [
  { code: 'USD', label: 'US Dollar', symbol: '$' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'GBP', label: 'British Pound', symbol: '£' },
  { code: 'JPY', label: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', label: 'Chinese Yuan', symbol: '¥' },
  { code: 'CAD', label: 'Canadian Dollar', symbol: 'CA$' },
  { code: 'AUD', label: 'Australian Dollar', symbol: 'A$' },
  { code: 'CHF', label: 'Swiss Franc', symbol: 'Fr.' },
  { code: 'HKD', label: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'SGD', label: 'Singapore Dollar', symbol: 'S$' },
  { code: 'SEK', label: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', label: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', label: 'Danish Krone', symbol: 'kr' },
  { code: 'NZD', label: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'INR', label: 'Indian Rupee', symbol: '₹' },
  { code: 'BRL', label: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', label: 'Mexican Peso', symbol: 'Mex$' },
  { code: 'ZAR', label: 'South African Rand', symbol: 'R' },
  { code: 'KRW', label: 'South Korean Won', symbol: '₩' },
  { code: 'TRY', label: 'Turkish Lira', symbol: '₺' },
  { code: 'RUB', label: 'Russian Ruble', symbol: '₽' },
  { code: 'PLN', label: 'Polish Złoty', symbol: 'zł' },
  { code: 'AED', label: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'SAR', label: 'Saudi Riyal', symbol: '﷼' },
  { code: 'ILS', label: 'Israeli Shekel', symbol: '₪' },
  { code: 'THB', label: 'Thai Baht', symbol: '฿' },
  { code: 'IDR', label: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'MYR', label: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'PHP', label: 'Philippine Peso', symbol: '₱' },
  { code: 'VND', label: 'Vietnamese Đồng', symbol: '₫' },
  { code: 'CZK', label: 'Czech Koruna', symbol: 'Kč' },
  { code: 'HUF', label: 'Hungarian Forint', symbol: 'Ft' },
  { code: 'CLP', label: 'Chilean Peso', symbol: 'CLP$' },
  { code: 'COP', label: 'Colombian Peso', symbol: 'COL$' },
  { code: 'ARS', label: 'Argentine Peso', symbol: 'AR$' },
  { code: 'PEN', label: 'Peruvian Sol', symbol: 'S/' },
  { code: 'EGP', label: 'Egyptian Pound', symbol: 'E£' },
  { code: 'NGN', label: 'Nigerian Naira', symbol: '₦' },
  { code: 'KES', label: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'TWD', label: 'Taiwan Dollar', symbol: 'NT$' },
];

interface CurrencyComboboxProps {
  value: string;
  onValueChange: (code: string) => void;
  currencies?: CurrencyDef[];
  /** Render as a compact addon (e.g. inside an InputGroupAddon). */
  variant?: 'default' | 'addon';
  disabled?: boolean;
  className?: string;
}

export function CurrencyCombobox({
  value,
  onValueChange,
  currencies = COMMON_CURRENCIES,
  variant = 'default',
  disabled,
  className,
}: CurrencyComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = currencies.find((c) => c.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={variant === 'addon' ? 'ghost' : 'outline'}
          size={variant === 'addon' ? 'sm' : 'default'}
          aria-expanded={open}
          aria-label="Select currency"
          disabled={disabled}
          className={cn(
            'justify-between gap-1.5',
            variant === 'addon' && 'h-7 px-2 font-medium text-muted-foreground',
            className,
          )}
        >
          {selected ? (
            <span className="flex items-center gap-1.5">
              <span className="tabular-nums">{selected.code}</span>
              {variant === 'default' && (
                <span className="text-muted-foreground">{selected.label}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Currency</span>
          )}
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search currencies…" />
          <CommandList>
            <CommandEmpty>No currency found.</CommandEmpty>
            <CommandGroup>
              {currencies.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.code} ${c.label} ${c.symbol}`}
                  onSelect={() => {
                    onValueChange(c.code);
                    setOpen(false);
                  }}
                >
                  <span className="flex flex-1 items-center gap-2">
                    <span className="w-12 font-mono text-xs tabular-nums">{c.code}</span>
                    <span>{c.label}</span>
                  </span>
                  <span className="text-muted-foreground text-xs">{c.symbol}</span>
                  <Check
                    className={cn('ml-2 size-4', value === c.code ? 'opacity-100' : 'opacity-0')}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
