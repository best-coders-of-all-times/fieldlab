import React, { useEffect, useId, useState } from 'react';
import { formatSci, parseNumber } from '../engine/units';

export function PanelSection({
  title,
  children,
  right,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'is-open' : ''}`}>
      <div
        className="section-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className={`chev ${open ? 'open' : ''}`} aria-hidden>▸</span>
        <span>{title}</span>
        {right && <span className="section-right" onClick={(e) => e.stopPropagation()}>{right}</span>}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  inline,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <div className={`field ${inline ? 'field-inline' : ''}`} role="group" aria-label={label}>
      <span className="field-label">
        {label}
        {hint && <span className="field-hint" title={hint}>?</span>}
      </span>
      <span className="field-control">{children}</span>
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <div className={`slider ${disabled ? 'disabled' : ''}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : min}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      />
      <span className="slider-value">{format ? format(value) : formatSci(value)}</span>
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  unit,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatSci(value, 6));
  }, [value, focused]);
  return (
    <span className="number-input">
      <input
        type="text"
        value={text}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const n = parseNumber(text, value);
          let v = n;
          if (min !== undefined) v = Math.max(min, v);
          if (max !== undefined) v = Math.min(max, v);
          onChange(v);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            const n = parseNumber(text, value) + dir * step;
            setText(formatSci(n, 6));
            onChange(n);
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

export function Vec3Input({
  value,
  onChange,
  step = 0.01,
  unit,
}: {
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  step?: number;
  unit?: string;
}) {
  const id = useId();
  return (
    <div className="vec3">
      {(['x', 'y', 'z'] as const).map((axis, i) => (
        <label key={axis} htmlFor={`${id}-${axis}`} className="vec3-part">
          <span>{axis}</span>
          <input
            id={`${id}-${axis}`}
            type="number"
            step={step}
            value={Number.isFinite(value[i]) ? value[i] : 0}
            onChange={(e) => {
              const next = [...value] as [number, number, number];
              next[i] = parseNumber(e.target.value, value[i]);
              onChange(next);
            }}
          />
        </label>
      ))}
      {unit && <span className="unit vec3-unit">{unit}</span>}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)} disabled={disabled}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      {label && <span className="toggle-label">{label}</span>}
    </button>
  );
}

export function CheckRow({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="check-row">
      <span className="check-label" title={hint}>{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  disabled = false,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: React.ReactNode; title?: string }>;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  return (
    <div className={`segmented segmented-${size}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
          title={o.title}
          disabled={disabled}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  title,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'ghost' | 'primary' | 'danger' | 'soft';
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <div className="empty-mark">∿</div>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
