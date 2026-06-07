// Inputs. Direct port of design_handoff_northbeam/lib-inputs.jsx — Field +
// InputBox wrapper and the Text/Email/Phone/Currency/Masked family — onto the
// ported .field / .input-wrap CSS. Formatting helpers live in @/lib/mask.

'use client';

import { cn } from '@/lib/cn';
import { applyMask, formatPhone, groupCurrency } from '@/lib/mask';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../northbeam/icons';

export type FieldState = 'error' | 'success' | undefined;
export type InputSize = 'sm' | 'md' | 'lg';
export type InputVariant = '' | 'filled' | 'underline';

export function Field({
  label,
  required,
  optional,
  hint,
  error,
  success,
  htmlFor,
  children,
  style,
}: {
  label?: string;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  success?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="field" style={style}>
      {label && (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
          {required && <span className="field__req">*</span>}
          {optional && <span className="field__optional">optional</span>}
        </label>
      )}
      {children}
      {error ? (
        <div className="field__error">
          <Icon name="warning-circle" size={14} />
          {error}
        </div>
      ) : success ? (
        <div className="field__success">
          <Icon name="check-circle" size={14} />
          {success}
        </div>
      ) : hint ? (
        <div className="field__hint">{hint}</div>
      ) : null}
    </div>
  );
}

type InputBoxProps = {
  size?: InputSize;
  variant?: InputVariant;
  state?: FieldState;
  disabled?: boolean;
  leadIcon?: IconName;
  trailIcon?: IconName;
  leadAffix?: ReactNode;
  trailAffix?: ReactNode;
  onClickTrail?: () => void;
  children: ReactNode;
};

export function InputBox({
  size = 'md',
  variant = '',
  state,
  disabled,
  leadIcon,
  trailIcon,
  leadAffix,
  trailAffix,
  onClickTrail,
  children,
}: InputBoxProps) {
  return (
    <div
      className={cn(
        'input-wrap',
        size !== 'md' && `input-wrap--${size}`,
        variant && `input-wrap--${variant}`,
      )}
      data-state={state}
      data-disabled={disabled ? 'true' : undefined}
    >
      {leadIcon && (
        <span className="input-wrap__icon">
          <Icon name={leadIcon} size={16} />
        </span>
      )}
      {leadAffix && <span className="input-wrap__affix input-wrap__affix--lead">{leadAffix}</span>}
      {children}
      {trailAffix && <span className="input-wrap__affix">{trailAffix}</span>}
      {trailIcon &&
        (onClickTrail ? (
          <button
            type="button"
            className="input-wrap__icon"
            style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }}
            onClick={onClickTrail}
          >
            <Icon name={trailIcon} size={16} />
          </button>
        ) : (
          <span className="input-wrap__icon">
            <Icon name={trailIcon} size={16} />
          </span>
        ))}
    </div>
  );
}

type TextInputProps = {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  type?: string;
  size?: InputSize;
  variant?: InputVariant;
  state?: FieldState;
  disabled?: boolean;
  leadIcon?: IconName;
  trailIcon?: IconName;
  leadAffix?: ReactNode;
  trailAffix?: ReactNode;
  onClickTrail?: () => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
};

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  size,
  variant,
  state,
  disabled,
  leadIcon,
  trailIcon,
  leadAffix,
  trailAffix,
  onClickTrail,
  inputMode,
  maxLength,
}: TextInputProps) {
  return (
    <InputBox
      size={size}
      variant={variant}
      state={state}
      disabled={disabled}
      leadIcon={leadIcon}
      trailIcon={trailIcon}
      leadAffix={leadAffix}
      trailAffix={trailAffix}
      onClickTrail={onClickTrail}
    >
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        maxLength={maxLength}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </InputBox>
  );
}

type WrappedProps = Omit<TextInputProps, 'type' | 'leadIcon'> & { leadIcon?: IconName };

export function EmailInput(props: WrappedProps) {
  return (
    <TextInput
      type="email"
      inputMode="email"
      leadIcon="envelope-simple"
      placeholder="you@company.com"
      {...props}
    />
  );
}

export function PhoneInput({ value, onChange, ...rest }: WrappedProps) {
  return (
    <TextInput
      type="tel"
      inputMode="tel"
      leadIcon="phone"
      placeholder="(555) 000-0000"
      value={value}
      onChange={(v) => onChange?.(formatPhone(v))}
      {...rest}
    />
  );
}

export function CurrencyInput({
  value,
  onChange,
  symbol = '$',
  code = 'USD',
  ...rest
}: WrappedProps & { symbol?: string; code?: string }) {
  return (
    <InputBox leadAffix={symbol} trailAffix={code} {...rest}>
      <input
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        style={{ textAlign: 'left' }}
        onChange={(e) => onChange?.(groupCurrency(e.target.value))}
        onBlur={(e) => {
          const n = Number.parseFloat(e.target.value.replace(/,/g, ''));
          if (!Number.isNaN(n)) onChange?.(groupCurrency(n.toFixed(2)));
        }}
      />
    </InputBox>
  );
}

export function MaskedInput({
  value,
  onChange,
  mask = '9999 9999 9999 9999',
  leadIcon,
  placeholder,
  ...rest
}: WrappedProps & { mask?: string }) {
  return (
    <TextInput
      inputMode="numeric"
      leadIcon={leadIcon}
      placeholder={placeholder || mask.replace(/9/g, '0').replace(/A/g, 'X')}
      value={value}
      onChange={(v) => onChange?.(applyMask(v, mask))}
      {...rest}
    />
  );
}
