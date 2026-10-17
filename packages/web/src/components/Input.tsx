import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * The one field look (DESIGN.md, "Inputs") for native `<input>`, `<select>` and `<textarea>`:
 * 34px tall for one line, a hairline border, the accent border and a soft accent ring on focus,
 * the danger border for an invalid value (`aria-invalid`). No width: add `w-full` or a fixed width.
 * Features use this string on their native elements, or the wrappers below.
 */
export const fieldClass =
  'min-w-0 rounded-control border border-line-strong bg-panel px-2.5 py-1.5 text-ink shadow-card transition-[border-color,box-shadow] duration-150 placeholder:text-dim/70 hover:border-[color-mix(in_srgb,var(--color-line-strong)_70%,var(--color-dim))] focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:focus:ring-danger/20';

/** `fieldClass` at full width, plus extra classes. */
export function inputClass(extra = ''): string {
  return `w-full ${fieldClass} ${extra}`;
}

/** Labels above a field, hints in caption text below (DESIGN.md, "Inputs"). */
export const labelClass = 'text-caption font-medium text-ink';
export const hintClass = 'text-caption text-dim';

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass(className)} {...rest} />;
}

export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClass(`pr-8 ${className}`)} {...rest} />;
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={inputClass(className)} {...rest} />;
}
